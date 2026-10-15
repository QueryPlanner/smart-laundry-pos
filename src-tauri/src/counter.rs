use base64::Engine;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Column, Row, SqlitePool, TypeInfo, ValueRef};
use std::sync::Mutex;
use uuid::Uuid;

use crate::storage::DatabaseState;

#[derive(Debug, Clone)]
pub struct SessionActor {
    pub id: String,
    pub role: String,
}
#[derive(Default)]
pub struct CounterSession {
    actor: Mutex<Option<SessionActor>>,
}
impl CounterSession {
    pub fn lock(&self) {
        if let Ok(mut actor) = self.actor.lock() {
            *actor = None;
        }
    }
    pub fn actor(&self) -> Result<SessionActor, String> {
        self.actor
            .lock()
            .map_err(|_| "Counter session is unavailable.".to_string())?
            .clone()
            .ok_or_else(|| "Log in before using the local counter.".to_string())
    }
    pub(crate) fn set(&self, actor: SessionActor) -> Result<(), String> {
        *self
            .actor
            .lock()
            .map_err(|_| "Counter session is unavailable.".to_string())? = Some(actor);
        Ok(())
    }
}
pub async fn authorize_sql(db: &DatabaseState, session: &CounterSession) -> Result<(), String> {
    let actor = session.actor()?;
    if actor.role != "admin" {
        return Err("Direct database access is restricted to administrators.".into());
    }
    let authorized: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM counter_accounts WHERE id=? AND role='admin' AND active=1",
    )
    .bind(&actor.id)
    .fetch_one(db.writer_pool()?)
    .await
    .map_err(db_err)?;
    if authorized != 1 {
        return Err("The administrator session is no longer valid.".into());
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub full_name: String,
    pub role: String,
    pub active: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub setup_required: bool,
    pub authenticated: bool,
    pub account: Option<Account>,
    pub accounts: Vec<Account>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub full_name: String,
    pub pin: String,
}

fn hash_pin(pin: &str, salt: &str) -> String {
    let mut hash = Sha256::digest(format!("{salt}:{pin}").as_bytes()).to_vec();
    for round in 0..150_000u32 {
        let mut h = Sha256::new();
        h.update(&hash);
        h.update(salt.as_bytes());
        h.update(round.to_le_bytes());
        hash = h.finalize().to_vec();
    }
    hex(&hash)
}
fn legacy_hash(pin: &str, salt: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .encode(Sha256::digest(format!("{salt}:{pin}").as_bytes()))
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn validate_account(input: &AccountInput) -> Result<(), String> {
    if input.full_name.trim().is_empty() || input.full_name.trim().chars().count() > 100 {
        return Err("Enter a staff name under 100 characters.".into());
    }
    if !(4..=8).contains(&input.pin.len()) || !input.pin.bytes().all(|b| b.is_ascii_digit()) {
        return Err("PIN must contain 4 to 8 digits.".into());
    }
    Ok(())
}
fn account(row: &sqlx::sqlite::SqliteRow) -> Result<Account, String> {
    Ok(Account {
        id: row.try_get("id").map_err(db_err)?,
        full_name: row.try_get("full_name").map_err(db_err)?,
        role: row.try_get("role").map_err(db_err)?,
        active: row.try_get::<i64, _>("active").map_err(db_err)? == 1,
    })
}
fn db_err(e: sqlx::Error) -> String {
    format!("Local counter database error: {e}")
}

pub async fn bootstrap(db: &DatabaseState, session: &CounterSession) -> Result<Bootstrap, String> {
    let pool = db.writer_pool()?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM counter_accounts")
        .fetch_one(pool)
        .await
        .map_err(db_err)?;
    let actor = session.actor().ok();
    let current = if let Some(a) = actor {
        sqlx::query("SELECT id,full_name,role,active FROM counter_accounts WHERE id=?")
            .bind(a.id)
            .fetch_optional(pool)
            .await
            .map_err(db_err)?
            .map(|r| account(&r))
            .transpose()?
    } else {
        None
    };
    let rows=sqlx::query("SELECT id,full_name,role,active FROM counter_accounts WHERE active=1 ORDER BY role,full_name").fetch_all(pool).await.map_err(db_err)?;
    let accounts = rows.iter().map(account).collect::<Result<Vec<_>, _>>()?;
    Ok(Bootstrap {
        setup_required: count == 0,
        authenticated: current.is_some(),
        account: current,
        accounts,
    })
}
pub async fn setup_admin(
    db: &DatabaseState,
    session: &CounterSession,
    input: AccountInput,
) -> Result<Account, String> {
    validate_account(&input)?;
    let pool = db.writer_pool()?;
    let mut tx = pool.begin().await.map_err(db_err)?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM counter_accounts")
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    if count > 0 {
        return Err("The local administrator is already configured.".into());
    }
    let id: String = sqlx::query_scalar("SELECT id FROM local_users ORDER BY created_at LIMIT 1")
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let salt = Uuid::new_v4().to_string();
    let pin_hash = hash_pin(&input.pin, &salt);
    let legacy_salt = base64::engine::general_purpose::STANDARD.encode(Uuid::new_v4().as_bytes());
    let old_hash = legacy_hash(&input.pin, &legacy_salt);
    let now = Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO counter_accounts(id,full_name,pin_hash,pin_salt,role,active,created_at,updated_at) VALUES(?,?,?,?, 'admin',1,?,?)")
        .bind(&id).bind(input.full_name.trim()).bind(&pin_hash).bind(&salt).bind(&now).bind(&now).execute(&mut *tx).await.map_err(db_err)?;
    sqlx::query("INSERT INTO local_users(id,full_name,pin_hash,pin_salt,role,created_at,updated_at) VALUES(?,?,?,?,'admin',?,?) ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name,pin_hash=excluded.pin_hash,pin_salt=excluded.pin_salt,updated_at=excluded.updated_at")
        .bind(&id).bind(input.full_name.trim()).bind(old_hash).bind(legacy_salt).bind(&now).bind(&now).execute(&mut *tx).await.map_err(db_err)?;
    sqlx::query("INSERT INTO counter_audit(id,actor_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?, 'created','account',?,'{}',?)")
        .bind(Uuid::new_v4().to_string()).bind(&id).bind(&id).bind(&now).execute(&mut *tx).await.map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    session.set(SessionActor {
        id: id.clone(),
        role: "admin".into(),
    })?;
    Ok(Account {
        id,
        full_name: input.full_name.trim().into(),
        role: "admin".into(),
        active: true,
    })
}
pub async fn login(
    db: &DatabaseState,
    session: &CounterSession,
    user_id: String,
    pin: String,
) -> Result<Account, String> {
    if pin.len() > 8 || !pin.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Incorrect name or PIN.".into());
    }
    let pool = db.writer_pool()?;
    let row=sqlx::query("SELECT id,full_name,pin_hash,pin_salt,role,active,failed_attempts,locked_until FROM counter_accounts WHERE id=?").bind(&user_id).fetch_optional(pool).await.map_err(db_err)?.ok_or("Incorrect name or PIN.")?;
    if row.try_get::<i64, _>("active").map_err(db_err)? != 1 {
        return Err("This account is inactive.".into());
    }
    let locked: Option<String> = row.try_get("locked_until").map_err(db_err)?;
    if locked
        .as_deref()
        .is_some_and(|s| s > Utc::now().to_rfc3339().as_str())
    {
        return Err("This account is temporarily locked. Ask an administrator.".into());
    }
    let salt: String = row.try_get("pin_salt").map_err(db_err)?;
    let expected: String = row.try_get("pin_hash").map_err(db_err)?;
    if hash_pin(&pin, &salt) != expected {
        let failed: i64 = row.try_get::<i64, _>("failed_attempts").map_err(db_err)? + 1;
        let until = if failed >= 5 {
            Some((Utc::now() + Duration::minutes(5)).to_rfc3339())
        } else {
            None
        };
        sqlx::query("UPDATE counter_accounts SET failed_attempts=?,locked_until=? WHERE id=?")
            .bind(if until.is_some() { 0 } else { failed })
            .bind(until)
            .bind(&user_id)
            .execute(pool)
            .await
            .map_err(db_err)?;
        return Err("Incorrect name or PIN.".into());
    }
    sqlx::query("UPDATE counter_accounts SET failed_attempts=0,locked_until=NULL WHERE id=?")
        .bind(&user_id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    let a = Account {
        id: row.try_get("id").map_err(db_err)?,
        full_name: row.try_get("full_name").map_err(db_err)?,
        role: row.try_get("role").map_err(db_err)?,
        active: true,
    };
    session.set(SessionActor {
        id: a.id.clone(),
        role: a.role.clone(),
    })?;
    Ok(a)
}
pub async fn list_staff(
    db: &DatabaseState,
    session: &CounterSession,
) -> Result<Vec<Account>, String> {
    if session.actor()?.role != "admin" {
        return Err("Administrator access is required.".into());
    }
    let rows = sqlx::query(
        "SELECT id,full_name,role,active FROM counter_accounts ORDER BY role,full_name",
    )
    .fetch_all(db.writer_pool()?)
    .await
    .map_err(db_err)?;
    rows.iter().map(account).collect()
}
pub async fn create_staff(
    db: &DatabaseState,
    session: &CounterSession,
    input: AccountInput,
) -> Result<Account, String> {
    let actor = session.actor()?;
    if actor.role != "admin" {
        return Err("Administrator access is required.".into());
    }
    validate_account(&input)?;
    let pool = db.writer_pool()?;
    let id = Uuid::new_v4().to_string();
    let salt = Uuid::new_v4().to_string();
    let hash = hash_pin(&input.pin, &salt);
    let old_salt = base64::engine::general_purpose::STANDARD.encode(Uuid::new_v4().as_bytes());
    let old_hash = legacy_hash(&input.pin, &old_salt);
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await.map_err(db_err)?;
    sqlx::query("INSERT INTO counter_accounts(id,full_name,pin_hash,pin_salt,role,active,created_at,updated_at) VALUES(?,?,?,?,'staff',1,?,?)").bind(&id).bind(input.full_name.trim()).bind(hash).bind(salt).bind(&now).bind(&now).execute(&mut *tx).await.map_err(db_err)?;
    sqlx::query("INSERT INTO local_users(id,full_name,pin_hash,pin_salt,role,created_at,updated_at) VALUES(?,?,?,?,'admin',?,?)").bind(&id).bind(input.full_name.trim()).bind(old_hash).bind(old_salt).bind(&now).bind(&now).execute(&mut *tx).await.map_err(db_err)?;
    audit(&mut tx, &actor.id, "staff_created", "account", &id, &now).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Account {
        id,
        full_name: input.full_name.trim().into(),
        role: "staff".into(),
        active: true,
    })
}
pub async fn update_staff(
    db: &DatabaseState,
    session: &CounterSession,
    user_id: &str,
    active: Option<bool>,
    pin: Option<&str>,
) -> Result<(), String> {
    let actor = session.actor()?;
    if actor.role != "admin" {
        return Err("Administrator access is required.".into());
    }
    if actor.id == user_id {
        return Err(
            "The current administrator cannot deactivate or reset their own account.".into(),
        );
    }
    let pool = db.writer_pool()?;
    let role: Option<String> = sqlx::query_scalar("SELECT role FROM counter_accounts WHERE id=?")
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(db_err)?;
    if role.as_deref() != Some("staff") {
        return Err("Staff account not found.".into());
    }
    let now = Utc::now().to_rfc3339();
    let mut tx = pool.begin().await.map_err(db_err)?;
    if let Some(active) = active {
        sqlx::query("UPDATE counter_accounts SET active=?,updated_at=? WHERE id=?")
            .bind(active as i64)
            .bind(&now)
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    if let Some(pin) = pin {
        let inp = AccountInput {
            full_name: "staff".into(),
            pin: pin.into(),
        };
        validate_account(&inp)?;
        let salt = Uuid::new_v4().to_string();
        let hash = hash_pin(pin, &salt);
        let legacy_salt =
            base64::engine::general_purpose::STANDARD.encode(Uuid::new_v4().as_bytes());
        let old_hash = legacy_hash(pin, &legacy_salt);
        sqlx::query("UPDATE counter_accounts SET pin_hash=?,pin_salt=?,failed_attempts=0,locked_until=NULL,updated_at=? WHERE id=?").bind(hash).bind(salt).bind(&now).bind(user_id).execute(&mut *tx).await.map_err(db_err)?;
        sqlx::query("UPDATE local_users SET pin_hash=?,pin_salt=?,updated_at=? WHERE id=?")
            .bind(old_hash)
            .bind(legacy_salt)
            .bind(&now)
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    audit(
        &mut tx,
        &actor.id,
        if pin.is_some() {
            "pin_reset"
        } else {
            "staff_updated"
        },
        "account",
        user_id,
        &now,
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    Ok(())
}
async fn audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    actor: &str,
    action: &str,
    kind: &str,
    entity: &str,
    now: &str,
) -> Result<(), String> {
    sqlx::query("INSERT INTO counter_audit(id,actor_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,?,?,'{}',?)").bind(Uuid::new_v4().to_string()).bind(actor).bind(action).bind(kind).bind(entity).bind(now).execute(&mut **tx).await.map_err(db_err)?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerInput {
    pub name: String,
    pub phone: String,
    pub customer_id: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineInput {
    pub garment_id: String,
    pub service_id: String,
    pub quantity: u32,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderInput {
    pub customer: CustomerInput,
    pub items: Vec<LineInput>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInput {
    pub amount_minor: i64,
    pub method: String,
    pub reference: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveInput {
    #[serde(flatten)]
    pub order: OrderInput,
    pub idempotency_key: String,
    pub payment: Option<PaymentInput>,
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QuoteLine {
    pub garment_id: String,
    pub service_id: String,
    pub garment: String,
    pub service: String,
    pub quantity: u32,
    pub unit_price_minor: i64,
    pub line_total_minor: i64,
    pub rate_version: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub lines: Vec<QuoteLine>,
    pub subtotal_minor: i64,
    pub total_minor: i64,
    pub piece_count: u32,
    pub promised_at: String,
    pub catalogue_version: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Piece {
    pub id: String,
    pub short_id: String,
    pub garment_id: String,
    pub garment: String,
    pub service: String,
    pub position: u32,
    pub total: u32,
    pub matched: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintJob {
    pub id: String,
    pub kind: String,
    pub state: String,
    pub printer_id: Option<String>,
    pub os_job_id: Option<String>,
    pub last_error: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedOrder {
    pub order_id: String,
    pub order_number: String,
    pub received_at: String,
    pub promised_at: String,
    pub total_minor: i64,
    pub paid_minor: i64,
    pub balance_minor: i64,
    pub pieces: Vec<Piece>,
    pub print_jobs: Vec<PrintJob>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalogue {
    pub garments: Vec<serde_json::Value>,
    pub services: Vec<serde_json::Value>,
    pub rates: Vec<serde_json::Value>,
}

fn actor(session: &CounterSession) -> Result<SessionActor, String> {
    session.actor()
}
fn due_time(instant: chrono::DateTime<Utc>) -> String {
    let shop = instant + Duration::minutes(330);
    let local = shop.date_naive() + Duration::days(2);
    let utc = local.and_hms_opt(11, 30, 0).unwrap().and_utc();
    utc.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn ist_time(instant: chrono::DateTime<Utc>) -> String {
    (instant + Duration::minutes(330))
        .format("%d %b %Y %I:%M %p")
        .to_string()
}
pub async fn catalogue(db: &DatabaseState, session: &CounterSession) -> Result<Catalogue, String> {
    let _ = actor(session)?;
    let p = db.writer_pool()?;
    let g=sqlx::query("SELECT id,garment_key AS key,name_en AS nameEn,name_mr AS nameMr,category,image_key AS imageKey,billing_unit AS billingUnit,active FROM garments ORDER BY sort_order").fetch_all(p).await.map_err(db_err)?;
    let sv=sqlx::query("SELECT id,service_key AS key,name,active FROM service_methods ORDER BY CASE service_key WHEN 'wash' THEN 1 WHEN 'iron' THEN 2 WHEN 'wash_iron' THEN 3 ELSE 4 END").fetch_all(p).await.map_err(db_err)?;
    let r=sqlx::query("SELECT garment_id AS garmentId,service_id AS serviceId,price_minor AS priceMinor,configured,available,version FROM garment_service_rates ORDER BY garment_id,service_id").fetch_all(p).await.map_err(db_err)?;
    Ok(Catalogue {
        garments: g.iter().map(row_value).collect(),
        services: sv.iter().map(|x| row_value(x)).collect(),
        rates: r.iter().map(|x| row_value(x)).collect(),
    })
}
fn row_value(row: &sqlx::sqlite::SqliteRow) -> serde_json::Value {
    let mut m = serde_json::Map::new();
    for c in row.columns() {
        let k = c.name();
        let v = match row.try_get_raw(k) {
            Ok(raw) if raw.is_null() => serde_json::Value::Null,
            _ => match c.type_info().name() {
                "TEXT" | "VARCHAR" => row
                    .try_get::<String, _>(k)
                    .map(serde_json::Value::String)
                    .unwrap_or_default(),
                _ => row
                    .try_get::<i64, _>(k)
                    .map(serde_json::Value::from)
                    .unwrap_or_default(),
            },
        };
        m.insert(k.into(), v);
    }
    serde_json::Value::Object(m)
}
pub async fn quote(
    db: &DatabaseState,
    session: &CounterSession,
    input: &OrderInput,
) -> Result<Quote, String> {
    let _ = actor(session)?;
    let pool = db.writer_pool()?;
    quote_at(pool, input, Utc::now()).await
}
async fn quote_at(
    pool: &SqlitePool,
    input: &OrderInput,
    now: chrono::DateTime<Utc>,
) -> Result<Quote, String> {
    if input.items.is_empty() {
        return Err("Add at least one garment.".into());
    }
    if input.customer.name.trim().is_empty() {
        return Err("Enter the customer name.".into());
    }
    if input.customer.phone.trim().is_empty() {
        return Err("Enter the customer phone number.".into());
    }
    let mut lines = Vec::new();
    let mut count = 0u32;
    let mut total = 0i64;
    for item in &input.items {
        if item.quantity == 0 || item.quantity > 200 {
            return Err("Garment quantities must be whole numbers from 1 to 200.".into());
        }
        let row=sqlx::query("SELECT g.name_en,s.name,r.price_minor,r.configured,r.available,r.version,g.garment_key,s.service_key FROM garment_service_rates r JOIN garments g ON g.id=r.garment_id JOIN service_methods s ON s.id=r.service_id WHERE g.id=? AND s.id=? AND g.active=1 AND s.active=1")
     .bind(&item.garment_id).bind(&item.service_id).fetch_optional(pool).await.map_err(db_err)?.ok_or("This garment and service combination is unavailable.")?;
        if row.try_get::<i64, _>("available").map_err(db_err)? != 1 {
            return Err("This garment and service combination is unavailable.".into());
        }
        if row.try_get::<i64, _>("configured").map_err(db_err)? != 1 {
            return Err("A rate has not been configured for this garment and service.".into());
        }
        let g: String = row.try_get("name_en").map_err(db_err)?;
        let s: String = row.try_get("name").map_err(db_err)?;
        let rate: i64 = row
            .try_get::<Option<i64>, _>("price_minor")
            .map_err(db_err)?
            .ok_or("A rate has not been configured for this garment and service.")?;
        let line = rate
            .checked_mul(item.quantity as i64)
            .ok_or("Order amount is too large.")?;
        total = total
            .checked_add(line)
            .ok_or("Order amount is too large.")?;
        count = count.checked_add(item.quantity).ok_or("Too many pieces.")?;
        lines.push(QuoteLine {
            garment_id: item.garment_id.clone(),
            service_id: item.service_id.clone(),
            garment: g,
            service: s,
            quantity: item.quantity,
            unit_price_minor: rate,
            line_total_minor: line,
            rate_version: row.try_get("version").map_err(db_err)?,
        });
    }
    Ok(Quote {
        lines,
        subtotal_minor: total,
        total_minor: total,
        piece_count: count,
        promised_at: due_time(now),
        catalogue_version: "2".into(),
    })
}
pub async fn set_rate(
    db: &DatabaseState,
    session: &CounterSession,
    garment: &str,
    service: &str,
    price: Option<i64>,
    available: bool,
) -> Result<(), String> {
    let actor = actor(session)?;
    if actor.role != "admin" {
        return Err("Administrator access is required to change rates.".into());
    }
    if price.is_some_and(|x| x < 0) {
        return Err("Rates cannot be negative.".into());
    }
    let p = db.writer_pool()?;
    if available {
        let keys = sqlx::query("SELECT g.garment_key,s.service_key FROM garment_service_rates r JOIN garments g ON g.id=r.garment_id JOIN service_methods s ON s.id=r.service_id WHERE r.garment_id=? AND r.service_id=?")
            .bind(garment).bind(service).fetch_optional(p).await.map_err(db_err)?
            .ok_or("Garment or service not found.")?;
        let garment_key: String = keys.try_get("garment_key").map_err(db_err)?;
        let service_key: String = keys.try_get("service_key").map_err(db_err)?;
        if garment_key == "shoes" && matches!(service_key.as_str(), "iron" | "wash_iron") {
            return Err("Ironing services are unavailable for shoes.".into());
        }
    }
    let result=sqlx::query("UPDATE garment_service_rates SET price_minor=?,configured=?,available=?,version=version+1,updated_at=?,updated_by=? WHERE garment_id=? AND service_id=?")
 .bind(price).bind(price.is_some() as i64).bind(available as i64).bind(Utc::now().to_rfc3339()).bind(&actor.id).bind(garment).bind(service).execute(p).await.map_err(db_err)?;
    if result.rows_affected() != 1 {
        return Err("Garment or service not found.".into());
    }
    Ok(())
}
pub async fn save_order(
    db: &DatabaseState,
    session: &CounterSession,
    input: SaveInput,
) -> Result<SavedOrder, String> {
    let actor = actor(session)?;
    let pool = db.writer_pool()?;
    let now = Utc::now();
    let quote = quote_at(pool, &input.order, now).await?;
    let mut tx = pool.begin().await.map_err(db_err)?;
    if input.idempotency_key.trim().is_empty() || input.idempotency_key.len() > 100 {
        return Err("A valid order submission key is required.".into());
    }
    for line in &quote.lines {
        let current=sqlx::query("SELECT price_minor,configured,available,version FROM garment_service_rates WHERE garment_id=? AND service_id=?")
     .bind(&line.garment_id).bind(&line.service_id).fetch_optional(&mut *tx).await.map_err(db_err)?.ok_or("The rate changed; quote the order again.")?;
        let price = current
            .try_get::<Option<i64>, _>("price_minor")
            .map_err(db_err)?;
        let configured = current.try_get::<i64, _>("configured").map_err(db_err)? == 1;
        let available = current.try_get::<i64, _>("available").map_err(db_err)? == 1;
        let version = current.try_get::<i64, _>("version").map_err(db_err)?;
        if !configured
            || !available
            || price != Some(line.unit_price_minor)
            || version != line.rate_version
        {
            return Err(
                "Rates changed while the order was open. Review the refreshed total before saving."
                    .into(),
            );
        }
    }
    if let Some(existing) = sqlx::query("SELECT id FROM orders WHERE idempotency_key=?")
        .bind(&input.idempotency_key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?
    {
        let id: String = existing.try_get("id").map_err(db_err)?;
        tx.rollback().await.map_err(db_err)?;
        return get_saved(db, &id)
            .await?
            .ok_or("Saved order could not be loaded.".into());
    }
    let received = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let due = quote.promised_at.clone();
    let customer_id = if let Some(id) = input.order.customer.customer_id.as_deref() {
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM customers WHERE id=?")
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
        if exists == 0 {
            return Err("Selected customer no longer exists.".into());
        }
        Some(id.to_string())
    } else {
        let phone = input.order.customer.phone.trim();
        let found: Option<String> = sqlx::query_scalar(
            "SELECT id FROM customers WHERE phone=? ORDER BY created_at LIMIT 1",
        )
        .bind(phone)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
        if let Some(id) = found {
            Some(id)
        } else {
            let id = Uuid::new_v4().to_string();
            let code = format!("C-{}", &id[..8]);
            let device: String =
                sqlx::query_scalar("SELECT value FROM app_settings WHERE key='device_id'")
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(db_err)?
                    .unwrap_or_default();
            sqlx::query("INSERT INTO customers(id,customer_code,name,phone,customer_type,created_at,updated_at,origin_device_id) VALUES(?,?,?,?,'regular',?,?,?)").bind(&id).bind(code).bind(input.order.customer.name.trim()).bind(phone).bind(&received).bind(&received).bind(device).execute(&mut *tx).await.map_err(db_err)?;
            Some(id)
        }
    };
    let year = now.timestamp() + 19800;
    let year = chrono::DateTime::from_timestamp(year, 0)
        .ok_or("Could not create order timestamp.")?
        .format("%Y")
        .to_string();
    let prefix: String =
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key='order_prefix'")
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
            .unwrap_or("LA".into());
    sqlx::query("INSERT INTO order_sequences(year,next_number) VALUES(?,2) ON CONFLICT(year) DO UPDATE SET next_number=next_number+1").bind(year.parse::<i64>().unwrap_or(0)).execute(&mut *tx).await.map_err(db_err)?;
    let seq: i64 = sqlx::query_scalar("SELECT next_number-1 FROM order_sequences WHERE year=?")
        .bind(year.parse::<i64>().unwrap_or(0))
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    let order_no = format!("{}-{}-{:05}", prefix, year, seq);
    let oid = Uuid::new_v4().to_string();
    let device: String = sqlx::query_scalar("SELECT value FROM app_settings WHERE key='device_id'")
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?
        .unwrap_or_default();
    sqlx::query("INSERT INTO orders(id,order_number,customer_id,customer_name,customer_phone,order_type,received_at,expected_ready_at,status,subtotal,discount_type,discount_value,discount_amount,total_amount,payment_status,created_by,created_at,updated_at,origin_device_id,idempotency_key) VALUES(?,?,?,?,?,'piece',?,?,'received',?,'fixed',0,0,?,'unpaid',?,?,?,?,?)")
 .bind(&oid).bind(&order_no).bind(customer_id).bind(input.order.customer.name.trim()).bind(input.order.customer.phone.trim()).bind(&received).bind(&due).bind(quote.total_minor as f64/100.0).bind(quote.total_minor as f64/100.0).bind(&actor.id).bind(&received).bind(&received).bind(device).bind(&input.idempotency_key).execute(&mut *tx).await.map_err(db_err)?;
    let mut all_pieces = Vec::new();
    for line in &quote.lines {
        let src = input
            .order
            .items
            .iter()
            .find(|i| {
                i.garment_id == line.garment_id
                    && i.service_id == line.service_id
                    && i.quantity == line.quantity
            })
            .ok_or("Order line changed while saving.")?;
        let item_id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO order_items(id,order_id,service_id,item_name,service_name,service_type,quantity,weight_kg,rate,line_total,created_at,garment_id,service_method_id,unit_price_minor,line_total_minor,rate_version) VALUES(?,?,?,?,?,'piece',?,0,?,?,?,?,?,?,?,?)")
    .bind(&item_id).bind(&oid).bind(&src.service_id).bind(&line.garment).bind(&line.service).bind(src.quantity).bind(line.unit_price_minor as f64/100.0).bind(line.line_total_minor as f64/100.0).bind(&received).bind(&src.garment_id).bind(&src.service_id).bind(line.unit_price_minor).bind(line.line_total_minor).bind(line.rate_version).execute(&mut *tx).await.map_err(db_err)?;
        let key: String = sqlx::query_scalar("SELECT garment_key FROM garments WHERE id=?")
            .bind(&src.garment_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
        for _ in 0..src.quantity {
            let pid = Uuid::new_v4().to_string();
            let short = pid
                .chars()
                .filter(|c| *c != '-')
                .take(8)
                .collect::<String>();
            all_pieces.push(Piece {
                id: pid.clone(),
                short_id: short.clone(),
                garment_id: src.garment_id.clone(),
                garment: line.garment.clone(),
                service: line.service.clone(),
                position: all_pieces.len() as u32 + 1,
                total: quote.piece_count,
                matched: false,
            });
            sqlx::query("INSERT INTO order_pieces(id,short_id,order_id,order_item_id,garment_id,service_id,garment_snapshot,service_snapshot,position,total,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
       .bind(pid).bind(short).bind(&oid).bind(&item_id).bind(&src.garment_id).bind(&src.service_id).bind(&line.garment).bind(&line.service).bind(all_pieces.len() as u32).bind(quote.piece_count).bind(&received).execute(&mut *tx).await.map_err(db_err)?;
        }
        let _ = key;
    }
    let mut paid = 0i64;
    if let Some(payment) = &input.payment {
        if payment.amount_minor <= 0
            || !matches!(
                payment.method.as_str(),
                "cash" | "upi" | "card" | "bank_transfer" | "other"
            )
        {
            return Err("Enter a valid initial payment.".into());
        }
        paid = payment.amount_minor;
        let status = if paid > quote.total_minor {
            "overpaid"
        } else if paid == quote.total_minor {
            "paid"
        } else {
            "partially_paid"
        };
        sqlx::query("INSERT INTO payments(id,order_id,amount,method,reference_number,recorded_at,recorded_by,created_at,updated_at,origin_device_id) VALUES(?,?,?,?,?,?,?,?,?,?)")
   .bind(Uuid::new_v4().to_string()).bind(&oid).bind(paid as f64/100.0).bind(&payment.method).bind(&payment.reference).bind(&received).bind(&actor.id).bind(&received).bind(&received).bind("counter").execute(&mut *tx).await.map_err(db_err)?;
        sqlx::query("UPDATE orders SET payment_status=? WHERE id=?")
            .bind(status)
            .bind(&oid)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    let bill = crate::printing::BillDocument {
        order_number: order_no.clone(),
        created_at_ist: ist_time(now),
        promised_at_ist: ist_time(
            chrono::DateTime::parse_from_rfc3339(&due)
                .map_err(|e| e.to_string())?
                .with_timezone(&Utc),
        ),
        customer_name: input.order.customer.name.trim().into(),
        customer_phone: input.order.customer.phone.trim().into(),
        items: quote
            .lines
            .iter()
            .map(|x| crate::printing::BillItem {
                garment: x.garment.clone(),
                service: x.service.clone(),
                quantity: x.quantity,
                unit_price_minor: x.unit_price_minor,
                line_total_minor: x.line_total_minor,
            })
            .collect(),
        subtotal_minor: quote.total_minor,
        paid_minor: paid,
        balance_minor: quote.total_minor - paid,
        physical_piece_count: quote.piece_count,
    };
    let tags = crate::printing::TagDocument {
        order_number: order_no.clone(),
        pieces: all_pieces
            .iter()
            .map(|x| crate::printing::TagPiece {
                piece_id: x.short_id.clone(),
                garment: x.garment.clone(),
                service: x.service.clone(),
                position: x.position,
                total: x.total,
            })
            .collect(),
    };
    for (kind, doc) in [
        ("bill", crate::printing::PrintDocument::Bill(bill)),
        ("tags", crate::printing::PrintDocument::Tags(tags)),
    ] {
        sqlx::query("INSERT INTO print_jobs(id,order_id,kind,state,payload_json,created_at,updated_at) VALUES(?,?,?,'pending',?,?,?)")
      .bind(Uuid::new_v4().to_string()).bind(&oid).bind(kind).bind(serde_json::to_string(&doc).map_err(|e|e.to_string())?).bind(&received).bind(&received).execute(&mut *tx).await.map_err(db_err)?;
    }
    audit(&mut tx, &actor.id, "order_saved", "order", &oid, &received).await?;
    tx.commit().await.map_err(db_err)?;
    get_saved(db, &oid)
        .await?
        .ok_or("Saved order could not be loaded.".into())
}
pub async fn get_saved(db: &DatabaseState, id: &str) -> Result<Option<SavedOrder>, String> {
    let p = db.writer_pool()?;
    let o = sqlx::query(
        "SELECT id,order_number,received_at,expected_ready_at,total_amount FROM orders WHERE id=?",
    )
    .bind(id)
    .fetch_optional(p)
    .await
    .map_err(db_err)?;
    let Some(o) = o else { return Ok(None) };
    let id: String = o.try_get("id").map_err(db_err)?;
    let no: String = o.try_get("order_number").map_err(db_err)?;
    let received: String = o.try_get("received_at").map_err(db_err)?;
    let due: String = o.try_get("expected_ready_at").map_err(db_err)?;
    let total: f64 = o.try_get("total_amount").map_err(db_err)?;
    let paid: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount),0) FROM payments WHERE order_id=? AND voided_at IS NULL",
    )
    .bind(&id)
    .fetch_one(p)
    .await
    .map_err(db_err)?;
    let pieces = pieces_for(p, &id).await?;
    let jobs = jobs_for(p, Some(&id)).await?;
    Ok(Some(SavedOrder {
        order_id: id,
        order_number: no,
        received_at: received,
        promised_at: due,
        total_minor: (total * 100.0).round() as i64,
        paid_minor: (paid * 100.0).round() as i64,
        balance_minor: (total * 100.0).round() as i64 - (paid * 100.0).round() as i64,
        pieces,
        print_jobs: jobs,
    }))
}
async fn pieces_for(p: &SqlitePool, order: &str) -> Result<Vec<Piece>, String> {
    let rows=sqlx::query("SELECT p.id,p.short_id,p.garment_id,p.garment_snapshot,p.service_snapshot,p.position,p.total,EXISTS(SELECT 1 FROM piece_matches m WHERE m.piece_id=p.id) AS matched FROM order_pieces p WHERE p.order_id=? ORDER BY p.position").bind(order).fetch_all(p).await.map_err(db_err)?;
    rows.iter()
        .map(|r| {
            Ok(Piece {
                id: r.try_get("id").map_err(db_err)?,
                short_id: r.try_get("short_id").map_err(db_err)?,
                garment_id: r.try_get("garment_id").map_err(db_err)?,
                garment: r.try_get("garment_snapshot").map_err(db_err)?,
                service: r.try_get("service_snapshot").map_err(db_err)?,
                position: r.try_get("position").map_err(db_err)?,
                total: r.try_get("total").map_err(db_err)?,
                matched: r.try_get::<i64, _>("matched").map_err(db_err)? == 1,
            })
        })
        .collect()
}
async fn jobs_for(p: &SqlitePool, order: Option<&str>) -> Result<Vec<PrintJob>, String> {
    let rows = if let Some(id) = order {
        sqlx::query("SELECT id,kind,state,printer_id,os_job_id,last_error FROM print_jobs WHERE order_id=? ORDER BY created_at").bind(id).fetch_all(p).await.map_err(db_err)?
    } else {
        sqlx::query("SELECT id,kind,state,printer_id,os_job_id,last_error FROM print_jobs ORDER BY created_at DESC LIMIT 200").fetch_all(p).await.map_err(db_err)?
    };
    rows.iter()
        .map(|r| {
            Ok(PrintJob {
                id: r.try_get("id").map_err(db_err)?,
                kind: r.try_get("kind").map_err(db_err)?,
                state: r.try_get("state").map_err(db_err)?,
                printer_id: r.try_get("printer_id").map_err(db_err)?,
                os_job_id: r.try_get("os_job_id").map_err(db_err)?,
                last_error: r.try_get("last_error").map_err(db_err)?,
            })
        })
        .collect()
}
pub async fn pieces(
    db: &DatabaseState,
    session: &CounterSession,
    order: &str,
) -> Result<Vec<Piece>, String> {
    let _ = actor(session)?;
    pieces_for(db.writer_pool()?, order).await
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchResult {
    pub matched_count: usize,
    pub expected_count: usize,
    pub missing_ids: Vec<String>,
    pub duplicate_ids: Vec<String>,
    pub wrong_order_ids: Vec<String>,
    pub complete: bool,
}
pub async fn match_pieces(
    db: &DatabaseState,
    session: &CounterSession,
    order: &str,
    ids: Vec<String>,
) -> Result<MatchResult, String> {
    let a = actor(session)?;
    let p = db.writer_pool()?;
    let expected = pieces_for(p, order).await?;
    if expected.is_empty() {
        return Err("Order has no individually tracked pieces.".into());
    }
    let mut duplicates = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for id in &ids {
        if !seen.insert(id.clone()) {
            duplicates.push(id.clone())
        }
    }
    let valid: std::collections::HashSet<String> = expected.iter().map(|x| x.id.clone()).collect();
    let wrong: Vec<String> = ids
        .iter()
        .filter(|x| !valid.contains(*x))
        .cloned()
        .collect();
    let mut tx = p.begin().await.map_err(db_err)?;
    let now = Utc::now().to_rfc3339();
    for id in ids
        .iter()
        .filter(|x| valid.contains(*x))
        .collect::<std::collections::HashSet<_>>()
    {
        sqlx::query("INSERT OR IGNORE INTO piece_matches(id,order_id,piece_id,matched_by,matched_at) VALUES(?,?,?,?,?)").bind(Uuid::new_v4().to_string()).bind(order).bind(id.clone()).bind(&a.id).bind(&now).execute(&mut *tx).await.map_err(db_err)?;
    }
    let matched: Vec<String> =
        sqlx::query_scalar("SELECT piece_id FROM piece_matches WHERE order_id=?")
            .bind(order)
            .fetch_all(&mut *tx)
            .await
            .map_err(db_err)?;
    let missing = expected
        .iter()
        .filter(|p| !matched.contains(&p.id))
        .map(|p| p.id.clone())
        .collect::<Vec<_>>();
    let complete = missing.is_empty() && wrong.is_empty() && duplicates.is_empty();
    audit(&mut tx, &a.id, "pieces_matched", "order", order, &now).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(MatchResult {
        matched_count: matched.len(),
        expected_count: expected.len(),
        missing_ids: missing,
        duplicate_ids: duplicates,
        wrong_order_ids: wrong,
        complete,
    })
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesInput {
    pub bill_printer_id: String,
    pub tag_printer_id: String,
}
pub async fn get_profiles(
    db: &DatabaseState,
    session: &CounterSession,
) -> Result<Option<ProfilesInput>, String> {
    let _ = actor(session)?;
    let rows = sqlx::query("SELECT kind,printer_id FROM printer_profiles")
        .fetch_all(db.writer_pool()?)
        .await
        .map_err(db_err)?;
    if rows.is_empty() {
        return Ok(None);
    }
    let mut bill = String::new();
    let mut tags = String::new();
    for r in rows {
        let k: String = r.try_get("kind").map_err(db_err)?;
        let v: String = r.try_get("printer_id").map_err(db_err)?;
        if k == "bill" {
            bill = v
        } else if k == "tags" {
            tags = v
        }
    }
    if bill.is_empty() || tags.is_empty() {
        return Ok(None);
    }
    Ok(Some(ProfilesInput {
        bill_printer_id: bill,
        tag_printer_id: tags,
    }))
}
pub async fn set_profiles(
    db: &DatabaseState,
    session: &CounterSession,
    input: ProfilesInput,
) -> Result<(), String> {
    let a = actor(session)?;
    if a.role != "admin" {
        return Err("Administrator access is required to configure printers.".into());
    }
    let available = crate::printing::enumerate_printers()
        .await
        .map_err(|e| e.to_string())?;
    for id in [&input.bill_printer_id, &input.tag_printer_id] {
        if !available.iter().any(|p| p.id == *id && p.is_available) {
            return Err(format!("Selected printer is not available: {id}"));
        }
    }
    let p = db.writer_pool()?;
    let now = Utc::now().to_rfc3339();
    let mut tx = p.begin().await.map_err(db_err)?;
    for (kind, id) in [
        ("bill", input.bill_printer_id),
        ("tags", input.tag_printer_id),
    ] {
        sqlx::query("INSERT INTO printer_profiles(kind,printer_id,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(kind) DO UPDATE SET printer_id=excluded.printer_id,updated_at=excluded.updated_at,updated_by=excluded.updated_by")
   .bind(kind).bind(id).bind(&now).bind(&a.id).execute(&mut *tx).await.map_err(db_err)?;
    }
    audit(
        &mut tx,
        &a.id,
        "printer_profiles_updated",
        "printer",
        "profiles",
        &now,
    )
    .await?;
    tx.commit().await.map_err(db_err)
}
pub async fn list_jobs(
    db: &DatabaseState,
    session: &CounterSession,
    order: Option<&str>,
) -> Result<Vec<PrintJob>, String> {
    let _ = actor(session)?;
    jobs_for(db.writer_pool()?, order).await
}
pub async fn enumerate_printers(
    session: &CounterSession,
) -> Result<Vec<crate::printing::PrinterInfo>, String> {
    let _ = actor(session)?;
    crate::printing::enumerate_printers()
        .await
        .map_err(|e| e.to_string())
}
pub async fn dispatch_jobs(
    db: &DatabaseState,
    session: &CounterSession,
    order: &str,
) -> Result<Vec<PrintJob>, String> {
    let a = actor(session)?;
    let p = db.writer_pool()?;
    let profiles = get_profiles(db, session)
        .await?
        .ok_or("Configure both bill and tag printers in Admin settings.")?;
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM print_jobs WHERE order_id=? AND state='pending' ORDER BY kind",
    )
    .bind(order)
    .fetch_all(p)
    .await
    .map_err(db_err)?;
    for id in ids {
        let now = Utc::now().to_rfc3339();
        let mut tx = p.begin().await.map_err(db_err)?;
        let row =
            sqlx::query("SELECT kind,payload_json FROM print_jobs WHERE id=? AND state='pending'")
                .bind(&id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db_err)?;
        let Some(row) = row else {
            tx.rollback().await.map_err(db_err)?;
            continue;
        };
        let kind: String = row.try_get("kind").map_err(db_err)?;
        let payload: String = row.try_get("payload_json").map_err(db_err)?;
        let printer = if kind == "bill" {
            profiles.bill_printer_id.clone()
        } else {
            profiles.tag_printer_id.clone()
        };
        let attempt = Uuid::new_v4().to_string();
        let updated=sqlx::query("UPDATE print_jobs SET state='submitting',printer_id=?,updated_at=? WHERE id=? AND state='pending'").bind(&printer).bind(&now).bind(&id).execute(&mut *tx).await.map_err(db_err)?;
        if updated.rows_affected() != 1 {
            tx.rollback().await.map_err(db_err)?;
            continue;
        }
        sqlx::query("INSERT INTO print_job_attempts(id,print_job_id,attempted_at,state) VALUES(?,?,?,'submitting')").bind(&attempt).bind(&id).bind(&now).execute(&mut *tx).await.map_err(db_err)?;
        audit(
            &mut tx,
            &a.id,
            "print_dispatch_started",
            "print_job",
            &id,
            &now,
        )
        .await?;
        tx.commit().await.map_err(db_err)?;
        let doc: crate::printing::PrintDocument = serde_json::from_str(&payload)
            .map_err(|e| format!("Saved print document is invalid: {e}"))?;
        let result = crate::printing::submit_document(crate::printing::SubmitDocumentRequest {
            printer_id: printer.clone(),
            document: doc,
        })
        .await;
        let (state, os, error) = match result {
            Ok(receipt) => {
                let state = match receipt.certainty {
                    crate::printing::SubmissionCertainty::Accepted => "submitted",
                    crate::printing::SubmissionCertainty::Uncertain => "uncertain",
                };
                let error = if state == "uncertain" {
                    receipt.detail.or_else(|| {
                        Some(
                            "Operating system accepted submission but paper output is uncertain."
                                .to_string(),
                        )
                    })
                } else {
                    receipt.detail
                };
                (state, receipt.os_job_id, error)
            }
            Err(e) => {
                let uncertain = matches!(e, crate::printing::PrintError::Uncertain(_));
                (
                    if uncertain { "uncertain" } else { "failed" },
                    None,
                    Some(e.to_string()),
                )
            }
        };
        let finished = Utc::now().to_rfc3339();
        let mut tx = p.begin().await.map_err(db_err)?;
        sqlx::query("UPDATE print_jobs SET state=?,os_job_id=?,last_error=?,updated_at=? WHERE id=? AND state='submitting'").bind(state).bind(os.clone()).bind(error.clone()).bind(&finished).bind(&id).execute(&mut *tx).await.map_err(db_err)?;
        sqlx::query(
            "UPDATE print_job_attempts SET state=?,os_job_id=?,error=?,finished_at=? WHERE id=?",
        )
        .bind(state)
        .bind(os)
        .bind(error)
        .bind(&finished)
        .bind(attempt)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
        audit(
            &mut tx,
            &a.id,
            "print_dispatch_finished",
            "print_job",
            &id,
            &finished,
        )
        .await?;
        tx.commit().await.map_err(db_err)?;
    }
    jobs_for(p, Some(order)).await
}
pub async fn retry_job(
    db: &DatabaseState,
    session: &CounterSession,
    job_id: &str,
    confirm_uncertain: bool,
) -> Result<PrintJob, String> {
    let a = actor(session)?;
    let p = db.writer_pool()?;
    let row = sqlx::query("SELECT state FROM print_jobs WHERE id=?")
        .bind(job_id)
        .fetch_optional(p)
        .await
        .map_err(db_err)?
        .ok_or("Print job not found.")?;
    let state: String = row.try_get("state").map_err(db_err)?;
    if state == "uncertain" && !confirm_uncertain {
        return Err(
            "Inspect the printer output, then explicitly confirm before retrying an uncertain job."
                .into(),
        );
    }
    if !matches!(state.as_str(), "failed" | "uncertain") {
        return Err("Only failed or explicitly confirmed uncertain jobs can be retried.".into());
    }
    let now = Utc::now().to_rfc3339();
    let mut tx = p.begin().await.map_err(db_err)?;
    sqlx::query("UPDATE print_jobs SET state='pending',last_error=NULL,os_job_id=NULL,updated_at=? WHERE id=?").bind(&now).bind(job_id).execute(&mut *tx).await.map_err(db_err)?;
    audit(
        &mut tx,
        &a.id,
        "print_retry_queued",
        "print_job",
        job_id,
        &now,
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    let row = sqlx::query(
        "SELECT id,kind,state,printer_id,os_job_id,last_error FROM print_jobs WHERE id=?",
    )
    .bind(job_id)
    .fetch_one(p)
    .await
    .map_err(db_err)?;
    Ok(PrintJob {
        id: row.try_get("id").map_err(db_err)?,
        kind: row.try_get("kind").map_err(db_err)?,
        state: row.try_get("state").map_err(db_err)?,
        printer_id: row.try_get("printer_id").map_err(db_err)?,
        os_job_id: row.try_get("os_job_id").map_err(db_err)?,
        last_error: row.try_get("last_error").map_err(db_err)?,
    })
}
pub async fn reprint_output(
    db: &DatabaseState,
    session: &CounterSession,
    order_id: &str,
    kind: &str,
    piece_ids: Vec<String>,
    request_id: &str,
) -> Result<PrintJob, String> {
    let a = actor(session)?;
    if !matches!(kind, "bill" | "tags") {
        return Err("Choose a bill or tags output.".into());
    }
    if request_id.trim().is_empty() || request_id.len() > 100 {
        return Err("A valid reprint request key is required.".into());
    }
    let p = db.writer_pool()?;
    if let Some(row) = sqlx::query("SELECT id,order_id,kind,state,printer_id,os_job_id,last_error FROM print_jobs WHERE reprint_request_id=?")
        .bind(request_id).fetch_optional(p).await.map_err(db_err)? {
        let existing_order: String = row.try_get("order_id").map_err(db_err)?;
        let existing_kind: String = row.try_get("kind").map_err(db_err)?;
        if existing_order != order_id || existing_kind != kind {
            return Err("Reprint request key is already used for another output.".into());
        }
        return Ok(PrintJob { id: row.try_get("id").map_err(db_err)?, kind: row.try_get("kind").map_err(db_err)?, state: row.try_get("state").map_err(db_err)?, printer_id: row.try_get("printer_id").map_err(db_err)?, os_job_id: row.try_get("os_job_id").map_err(db_err)?, last_error: row.try_get("last_error").map_err(db_err)? });
    }
    let source = sqlx::query("SELECT id,payload_json FROM print_jobs WHERE order_id=? AND kind=? AND source_job_id IS NULL ORDER BY created_at DESC LIMIT 1")
        .bind(order_id).bind(kind).fetch_optional(p).await.map_err(db_err)?.ok_or("Saved print document not found.")?;
    let source_id: String = source.try_get("id").map_err(db_err)?;
    let payload: String = source.try_get("payload_json").map_err(db_err)?;
    let mut document: crate::printing::PrintDocument = serde_json::from_str(&payload)
        .map_err(|e| format!("Saved print document is invalid: {e}"))?;
    if kind == "bill" {
        if !piece_ids.is_empty() {
            return Err("Bills are reprinted as a complete document.".into());
        }
    } else {
        if piece_ids.is_empty() {
            return Err("Select at least one garment tag to reprint.".into());
        }
        let crate::printing::PrintDocument::Tags(tags) = &mut document else {
            return Err("Saved tag document has the wrong format.".into());
        };
        let requested: std::collections::HashSet<&str> =
            piece_ids.iter().map(String::as_str).collect();
        if requested.len() != piece_ids.len()
            || tags
                .pieces
                .iter()
                .any(|p| requested.contains(p.piece_id.as_str()))
                == false
            || requested
                .iter()
                .any(|id| !tags.pieces.iter().any(|p| p.piece_id == **id))
        {
            return Err("Selected tag IDs must be unique pieces from this order.".into());
        }
        tags.pieces
            .retain(|p| requested.contains(p.piece_id.as_str()));
        let total = tags.pieces.len() as u32;
        for (index, piece) in tags.pieces.iter_mut().enumerate() {
            piece.position = index as u32 + 1;
            piece.total = total;
        }
    }
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    let mut tx = p.begin().await.map_err(db_err)?;
    sqlx::query("INSERT INTO print_jobs(id,order_id,kind,state,payload_json,created_at,updated_at,source_job_id,reprint_request_id) VALUES(?,?,?,'pending',?,?,?,?,?)")
        .bind(&id).bind(order_id).bind(kind).bind(serde_json::to_string(&document).map_err(|e| e.to_string())?).bind(&now).bind(&now).bind(&source_id).bind(request_id).execute(&mut *tx).await.map_err(db_err)?;
    audit(
        &mut tx,
        &a.id,
        "print_reprint_queued",
        "print_job",
        &id,
        &now,
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    Ok(PrintJob {
        id,
        kind: kind.into(),
        state: "pending".into(),
        printer_id: None,
        os_job_id: None,
        last_error: None,
    })
}

pub async fn recover_submitting(db: &DatabaseState) -> Result<(), String> {
    let p = db.writer_pool()?;
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE print_job_attempts SET state='uncertain',error='Application ended during submission; inspect output before retrying.',finished_at=? WHERE state='submitting'").bind(&now).execute(p).await.map_err(db_err)?;
    sqlx::query("UPDATE print_jobs SET state='uncertain',last_error='Application ended during submission; inspect output before retrying.',updated_at=? WHERE state='submitting'").bind(now).execute(p).await.map_err(db_err)?;
    Ok(())
}

pub async fn search_customers(
    db: &DatabaseState,
    session: &CounterSession,
    phone: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let _ = actor(session)?;
    let query = phone.trim();
    if query.len() < 2 {
        return Ok(Vec::new());
    }
    let rows = sqlx::query(
        "SELECT id,name,phone FROM customers WHERE phone LIKE ? ORDER BY name LIMIT 20",
    )
    .bind(format!("{}%", query))
    .fetch_all(db.writer_pool()?)
    .await
    .map_err(db_err)?;
    Ok(rows.iter().map(row_value).collect())
}

#[cfg(test)]
mod counter_tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);

    fn fixture_path() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "counter-domain-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        path.join("counter.db")
    }
    async fn admin_fixture(db: &DatabaseState) -> CounterSession {
        let p = db.writer_pool().unwrap();
        for (id, role) in [("fixture-admin", "admin"), ("fixture-staff", "staff")] {
            if role == "admin" {
                sqlx::query("INSERT INTO local_users(id,full_name,pin_hash,pin_salt,role,created_at,updated_at) VALUES(?,?,'x','x','admin',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
                    .bind(id).bind(id).execute(p).await.unwrap();
            }
            sqlx::query("INSERT INTO counter_accounts(id,full_name,pin_hash,pin_salt,role,active,created_at,updated_at) VALUES(?,?,'x','x',?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
                .bind(id).bind(id).bind(role).execute(p).await.unwrap();
        }
        let session = CounterSession::default();
        session
            .set(SessionActor {
                id: "fixture-admin".into(),
                role: "admin".into(),
            })
            .unwrap();
        session
    }
    fn order_input(quantity: u32) -> OrderInput {
        OrderInput {
            customer: CustomerInput {
                name: "Fixture Customer".into(),
                phone: "9990000000".into(),
                customer_id: None,
            },
            items: vec![LineInput {
                garment_id: "g-shirt".into(),
                service_id: "svc-wash".into(),
                quantity,
            }],
        }
    }
    #[test]
    fn promised_time_uses_ist_calendar_days_and_fixed_1700_cutoff() {
        let at = |s| {
            chrono::DateTime::parse_from_rfc3339(s)
                .unwrap()
                .with_timezone(&Utc)
        };
        assert_eq!(
            due_time(at("2026-10-15T18:29:59Z")),
            "2026-10-17T11:30:00.000Z"
        );
        assert_eq!(
            due_time(at("2026-10-15T18:30:00Z")),
            "2026-10-18T11:30:00.000Z"
        );
    }
    #[test]
    fn native_rates_orders_pieces_reprints_and_role_gate_are_consistent() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            assert_eq!(db.info().error, None);
            let admin = admin_fixture(&db).await;
            let staff = CounterSession::default();
            staff
                .set(SessionActor {
                    id: "fixture-staff".into(),
                    role: "staff".into(),
                })
                .unwrap();

            assert!(
                set_rate(&db, &staff, "g-shirt", "svc-wash", Some(275), true)
                    .await
                    .is_err()
            );
            assert!(authorize_sql(&db, &staff).await.is_err());
            let forged = CounterSession::default();
            forged
                .set(SessionActor {
                    id: "fixture-staff".into(),
                    role: "admin".into(),
                })
                .unwrap();
            assert!(
                authorize_sql(&db, &forged).await.is_err(),
                "database role, not session text, authorizes admin SQL"
            );
            assert!(quote(&db, &admin, &order_input(1))
                .await
                .unwrap_err()
                .contains("not been configured"));
            set_rate(&db, &admin, "g-shirt", "svc-wash", Some(275), true)
                .await
                .unwrap();
            assert!(
                set_rate(&db, &admin, "g-shoes", "svc-iron", Some(100), true)
                    .await
                    .is_err()
            );
            let quoted = quote(&db, &admin, &order_input(2)).await.unwrap();
            assert_eq!((quoted.total_minor, quoted.piece_count), (550, 2));
            let unconfigured = order_input(1);
            let mut unsupported = unconfigured;
            unsupported.items[0].garment_id = "g-shoes".into();
            unsupported.items[0].service_id = "svc-iron".into();
            assert!(quote(&db, &admin, &unsupported)
                .await
                .unwrap_err()
                .contains("unavailable"));

            let save = |key: &str| SaveInput {
                order: order_input(2),
                idempotency_key: key.into(),
                payment: Some(PaymentInput {
                    amount_minor: 100,
                    method: "cash".into(),
                    reference: None,
                }),
            };
            let mut invalid = save("bad-payment");
            invalid.payment.as_mut().unwrap().amount_minor = 0;
            assert!(save_order(&db, &admin, invalid).await.is_err());
            let order_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders")
                .fetch_one(db.writer_pool().unwrap())
                .await
                .unwrap();
            assert_eq!(
                order_count, 0,
                "invalid payment must roll back order creation"
            );
            let first = save_order(&db, &admin, save("save-once")).await.unwrap();
            assert_eq!(first.pieces.len(), 2);
            assert_eq!((first.paid_minor, first.balance_minor), (100, 450));
            assert_eq!(first.print_jobs.len(), 2);
            let replay = save_order(&db, &admin, save("save-once")).await.unwrap();
            assert_eq!(first.order_id, replay.order_id);
            assert_eq!(replay.pieces.len(), 2);
            let ids = first
                .pieces
                .iter()
                .map(|p| p.id.clone())
                .collect::<Vec<_>>();
            let bad = match_pieces(
                &db,
                &admin,
                &first.order_id,
                vec![ids[0].clone(), ids[0].clone(), "wrong-order-piece".into()],
            )
            .await
            .unwrap();
            assert!(!bad.complete);
            assert_eq!(bad.duplicate_ids.len(), 1);
            assert_eq!(bad.wrong_order_ids.len(), 1);
            let complete = match_pieces(&db, &admin, &first.order_id, ids)
                .await
                .unwrap();
            assert!(complete.complete);

            let reprint = reprint_output(
                &db,
                &admin,
                &first.order_id,
                "tags",
                vec![first.pieces[0].short_id.clone()],
                "reprint-1",
            )
            .await
            .unwrap();
            assert_eq!(reprint.state, "pending");
            let same = reprint_output(
                &db,
                &admin,
                &first.order_id,
                "tags",
                vec![first.pieces[1].short_id.clone()],
                "reprint-1",
            )
            .await
            .unwrap();
            assert_eq!(reprint.id, same.id);
            let payload: String =
                sqlx::query_scalar("SELECT payload_json FROM print_jobs WHERE id=?")
                    .bind(&reprint.id)
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            let doc: crate::printing::PrintDocument = serde_json::from_str(&payload).unwrap();
            let crate::printing::PrintDocument::Tags(tags) = doc else {
                panic!("tag document expected")
            };
            assert_eq!(tags.pieces.len(), 1);
            assert_eq!(tags.pieces[0].piece_id, first.pieces[0].short_id);
            assert!(reprint_output(
                &db,
                &admin,
                &first.order_id,
                "tags",
                vec!["not-this-order".into()],
                "reprint-invalid"
            )
            .await
            .is_err());
            let job_id = first.print_jobs[0].id.clone();
            sqlx::query("UPDATE print_jobs SET state='submitting' WHERE id=?")
                .bind(&job_id)
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            sqlx::query("INSERT INTO print_job_attempts(id,print_job_id,attempted_at,state) VALUES('attempt-fixture',?,CURRENT_TIMESTAMP,'submitting')").bind(&job_id).execute(db.writer_pool().unwrap()).await.unwrap();
            recover_submitting(&db).await.unwrap();
            let recovered: String = sqlx::query_scalar("SELECT state FROM print_jobs WHERE id=?")
                .bind(&job_id)
                .fetch_one(db.writer_pool().unwrap())
                .await
                .unwrap();
            let attempt_state: String = sqlx::query_scalar(
                "SELECT state FROM print_job_attempts WHERE id='attempt-fixture'",
            )
            .fetch_one(db.writer_pool().unwrap())
            .await
            .unwrap();
            assert_eq!(recovered, "uncertain");
            assert_eq!(attempt_state, "uncertain");
            drop(db);
            let _ = std::fs::remove_dir_all(path.parent().unwrap());
        });
    }
}
