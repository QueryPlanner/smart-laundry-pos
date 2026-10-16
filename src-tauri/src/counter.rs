use base64::Engine;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Column, Row, SqlitePool, TypeInfo, ValueRef};
use std::sync::Mutex;
use uuid::Uuid;

use crate::storage::{DatabaseState, BACKUP_LAST_AT, BACKUP_MIRROR_DIR, BACKUP_MIRROR_STATUS};

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
    pub warning: Option<String>,
    /// A restored backup is waiting for the next start. Writes are blocked until then, and the
    /// restore brings back that backup's accounts and PINs, so the app keeps saying so.
    pub restore_pending: bool,
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
pub(crate) fn db_err(e: sqlx::Error) -> String {
    format!("Local counter database error: {e}")
}

fn join_warnings(first: Option<String>, second: Option<String>) -> Option<String> {
    match (first, second) {
        (Some(a), Some(b)) => Some(format!("{a} {b}")),
        (a, b) => a.or(b),
    }
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
        warning: join_warnings(db.info().warning, db.backup_health().await),
        restore_pending: db.info().restore_pending,
    })
}
pub async fn setup_admin(
    db: &DatabaseState,
    session: &CounterSession,
    input: AccountInput,
) -> Result<Account, String> {
    validate_account(&input)?;
    let mut tx = db.begin_counter_write().await?;
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
        return Err("This account is locked for a few minutes after too many wrong PINs. Wait 5 minutes and try again.".into());
    }
    let salt: String = row.try_get("pin_salt").map_err(db_err)?;
    let expected: String = row.try_get("pin_hash").map_err(db_err)?;
    let current_hash = hash_pin(&pin, &salt);
    let legacy_valid = legacy_hash(&pin, &salt) == expected;
    if current_hash != expected && !legacy_valid {
        let failed: i64 = row.try_get::<i64, _>("failed_attempts").map_err(db_err)? + 1;
        let until = if failed >= 5 {
            Some((Utc::now() + Duration::minutes(5)).to_rfc3339())
        } else {
            None
        };
        let mut tx = db.begin_counter_write().await?;
        sqlx::query("UPDATE counter_accounts SET failed_attempts=?,locked_until=? WHERE id=?")
            .bind(if until.is_some() { 0 } else { failed })
            .bind(until)
            .bind(&user_id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        tx.commit().await.map_err(db_err)?;
        return Err("Incorrect name or PIN.".into());
    }
    if legacy_valid {
        let upgraded_salt = Uuid::new_v4().to_string();
        let upgraded_hash = hash_pin(&pin, &upgraded_salt);
        let mut tx = db.begin_counter_write().await?;
        sqlx::query("UPDATE counter_accounts SET pin_hash=?,pin_salt=?,failed_attempts=0,locked_until=NULL,updated_at=? WHERE id=?")
            .bind(upgraded_hash).bind(upgraded_salt).bind(Utc::now().to_rfc3339()).bind(&user_id).execute(&mut *tx).await.map_err(db_err)?;
        tx.commit().await.map_err(db_err)?;
    } else {
        let mut tx = db.begin_counter_write().await?;
        sqlx::query("UPDATE counter_accounts SET failed_attempts=0,locked_until=NULL WHERE id=?")
            .bind(&user_id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        tx.commit().await.map_err(db_err)?;
    }
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
/// A legacy-table credential that no PIN can match (random, never derived from a PIN).
fn unusable_legacy_credential() -> (String, String) {
    let random = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    (
        hex(&Sha256::digest(random.as_bytes())),
        Uuid::new_v4().to_string(),
    )
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
    let id = Uuid::new_v4().to_string();
    let salt = Uuid::new_v4().to_string();
    let hash = hash_pin(&input.pin, &salt);
    let now = Utc::now().to_rfc3339();
    let mut tx = db.begin_counter_write().await?;
    require_admin_in_tx(&mut tx, session, "create staff accounts").await?;
    sqlx::query("INSERT INTO counter_accounts(id,full_name,pin_hash,pin_salt,role,active,created_at,updated_at) VALUES(?,?,?,?,'staff',1,?,?)").bind(&id).bind(input.full_name.trim()).bind(hash).bind(salt).bind(&now).bind(&now).execute(&mut *tx).await.map_err(db_err)?;
    // The old order/payment tables reference local_users, so staff need a row there. It carries a
    // random value no PIN can produce, so it can never be used to sign in or to guess a PIN.
    let (unusable_hash, unusable_salt) = unusable_legacy_credential();
    sqlx::query("INSERT INTO local_users(id,full_name,pin_hash,pin_salt,role,created_at,updated_at) VALUES(?,?,?,?,'admin',?,?)").bind(&id).bind(input.full_name.trim()).bind(unusable_hash).bind(unusable_salt).bind(&now).bind(&now).execute(&mut *tx).await.map_err(db_err)?;
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
    let mut tx = db.begin_counter_write().await?;
    require_admin_in_tx(&mut tx, session, "change staff accounts").await?;
    if let Some(active) = active {
        // Turning an account back on also clears any lockout from wrong PINs.
        sqlx::query("UPDATE counter_accounts SET active=?1,failed_attempts=CASE WHEN ?1=1 THEN 0 ELSE failed_attempts END,locked_until=CASE WHEN ?1=1 THEN NULL ELSE locked_until END,updated_at=?2 WHERE id=?3")
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
        sqlx::query("UPDATE counter_accounts SET pin_hash=?,pin_salt=?,failed_attempts=0,locked_until=NULL,updated_at=? WHERE id=?").bind(hash).bind(salt).bind(&now).bind(user_id).execute(&mut *tx).await.map_err(db_err)?;
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
    audit_details(tx, actor, action, kind, entity, now, &serde_json::json!({})).await
}

/// Audit row that also records the values involved (old and new price, reason, amounts), so a
/// dispute can be reconstructed later without guessing.
pub(crate) async fn audit_details(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    actor: &str,
    action: &str,
    kind: &str,
    entity: &str,
    now: &str,
    details: &serde_json::Value,
) -> Result<(), String> {
    sqlx::query("INSERT INTO counter_audit(id,actor_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(actor).bind(action).bind(kind).bind(entity)
        .bind(details.to_string()).bind(now)
        .execute(&mut **tx).await.map_err(db_err)?;
    Ok(())
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomerInput {
    pub name: String,
    pub phone: String,
    pub customer_id: Option<String>,
}
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LineInput {
    pub garment_id: String,
    pub service_id: String,
    pub quantity: u32,
}
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OrderInput {
    pub customer: CustomerInput,
    pub items: Vec<LineInput>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInput {
    pub amount_minor: i64,
    pub method: String,
    pub reference: Option<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveInput {
    #[serde(flatten)]
    pub order: OrderInput,
    pub idempotency_key: String,
    pub payment: Option<PaymentInput>,
    pub reviewed_quote: Quote,
}
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
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
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub lines: Vec<QuoteLine>,
    pub subtotal_minor: i64,
    /// Automatic discount, in basis points (1/100 of a percent), resolved natively.
    pub discount_percent_bp: i64,
    pub discount_minor: i64,
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
    pub packing_matched: bool,
    pub collection_matched: bool,
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
    pub order_id: String,
    pub order_number: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedOrder {
    pub order_id: String,
    pub order_number: String,
    pub received_at: String,
    pub promised_at: String,
    pub status: String,
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

/// `%text%` for a LIKE ... ESCAPE '\\' query, with the operator's own wildcards matched literally.
pub(crate) fn like_contains(text: &str) -> String {
    let escaped = text
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

/// Any logged-in account. The caller still validates its own input.
pub(crate) fn require_actor(session: &CounterSession) -> Result<SessionActor, String> {
    session.actor()
}

/// Admin check for writes: the session says admin AND the database still says an active admin,
/// read inside the write transaction (one writer connection), so a role change or deactivation
/// cannot slip in between the check and the write.
pub(crate) async fn require_admin_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    session: &CounterSession,
    what: &str,
) -> Result<SessionActor, String> {
    let actor = require_admin(session, what)?;
    require_active_admin_in_tx(tx, &actor.id).await?;
    Ok(actor)
}

async fn require_active_admin_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    actor_id: &str,
) -> Result<(), String> {
    let admin: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM counter_accounts WHERE id=? AND role='admin' AND active=1",
    )
    .bind(actor_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db_err)?;
    if admin != 1 {
        return Err("The administrator session is no longer valid.".into());
    }
    Ok(())
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
        services: sv.iter().map(row_value).collect(),
        rates: r.iter().map(row_value).collect(),
    })
}
pub(crate) fn row_value(row: &sqlx::sqlite::SqliteRow) -> serde_json::Value {
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
/// ASCII value of a decimal digit written in any of the scripts used in India (and the Arabic-Indic
/// and full-width forms), so "९८७६५४३२१०" and "9876543210" are the same phone number.
pub(crate) fn digit_value(c: char) -> Option<u32> {
    if c.is_ascii_digit() {
        return c.to_digit(10);
    }
    const ZERO_CODE_POINTS: [u32; 12] = [
        0x0660, 0x06F0, 0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66, 0x0BE6, 0x0C66, 0x0CE6, 0x0D66,
        0xFF10,
    ];
    ZERO_CODE_POINTS
        .iter()
        .find_map(|zero| (c as u32).checked_sub(*zero).filter(|offset| *offset < 10))
}

/// Canonical 10-digit mobile number: digits from any script, spaces, dashes, dots, brackets and a
/// leading +91, 91 or 0 are accepted and removed. Anything else is refused, so the same customer
/// is always found whatever way the number was typed.
pub(crate) fn normalize_phone(raw: &str) -> Result<String, String> {
    let mut digits = String::new();
    for c in raw.trim().chars() {
        if let Some(value) = digit_value(c) {
            digits.push(char::from_digit(value, 10).expect("a decimal digit"));
        } else if !matches!(c, ' ' | '-' | '.' | '(' | ')' | '+' | '\u{a0}') {
            return Err(
                "The phone number may only contain digits, spaces and a leading +91.".into(),
            );
        }
    }
    let digits = strip_country_prefix(digits);
    if digits.len() != 10 {
        return Err("Enter a 10-digit mobile number.".into());
    }
    Ok(digits)
}

/// Drop a leading 91 (country code) or 0 (trunk prefix) from a complete-looking number, so a
/// search typed as "+91 98765 43210" matches the stored 10 digits.
pub(crate) fn strip_country_prefix(mut digits: String) -> String {
    if digits.len() == 12 && digits.starts_with("91") {
        digits.drain(..2);
    } else if digits.len() == 11 && digits.starts_with('0') {
        digits.drain(..1);
    }
    digits
}

/// A customer name compared without caring about case or extra spaces.
pub(crate) fn name_key(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Existing customer for an order: the one explicitly selected, else the oldest customer with this
/// phone AND this name. Matching on the phone alone would give one person on a shared phone number
/// another person's discount and history. Older records may hold the number as typed, so both the
/// canonical and the raw form are looked up.
async fn resolve_customer_id(
    conn: &mut sqlx::SqliteConnection,
    customer: &CustomerInput,
) -> Result<Option<String>, String> {
    if let Some(id) = customer.customer_id.as_deref() {
        return sqlx::query_scalar("SELECT id FROM customers WHERE id=?")
            .bind(id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(db_err);
    }
    let phone = normalize_phone(&customer.phone)?;
    let wanted = name_key(&customer.name);
    let rows =
        sqlx::query("SELECT id,name FROM customers WHERE phone IN (?,?) ORDER BY created_at")
            .bind(&phone)
            .bind(customer.phone.trim())
            .fetch_all(&mut *conn)
            .await
            .map_err(db_err)?;
    for row in rows {
        let name: String = row.try_get("name").map_err(db_err)?;
        if name_key(&name) == wanted {
            return row.try_get("id").map(Some).map_err(db_err);
        }
    }
    Ok(None)
}

/// Automatic discount for this customer in basis points. An active customer rule wins over the
/// active shop-wide rule; with neither the discount is zero. Staff can never supply a value.
async fn resolve_discount(
    conn: &mut sqlx::SqliteConnection,
    customer: &CustomerInput,
) -> Result<i64, String> {
    if let Some(id) = resolve_customer_id(&mut *conn, customer).await? {
        let own: Option<i64> = sqlx::query_scalar(
            "SELECT percent_bp FROM counter_discounts WHERE scope='customer' AND customer_id=? AND active=1",
        )
        .bind(id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(db_err)?;
        if let Some(bp) = own {
            return Ok(bp);
        }
    }
    let shop: Option<i64> = sqlx::query_scalar(
        "SELECT percent_bp FROM counter_discounts WHERE scope='all' AND active=1",
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(db_err)?;
    Ok(shop.unwrap_or(0))
}

/// Round-half-up percentage of a paise amount, so the same order always yields the same paise.
fn discount_amount(subtotal_minor: i64, percent_bp: i64) -> Result<i64, String> {
    if !(0..=10_000).contains(&percent_bp) || subtotal_minor < 0 {
        return Err("The discount is outside the allowed range.".into());
    }
    let scaled = i128::from(subtotal_minor) * i128::from(percent_bp) + 5_000;
    i64::try_from(scaled / 10_000).map_err(|_| "Order amount is too large.".to_string())
}

const MAX_ORDER_LINES: usize = 100;
/// ₹10,00,000 in paise: far above any real laundry order, so a typing slip cannot be charged.
const MAX_ORDER_TOTAL_MINOR: i64 = 100_000_000;
/// Highest price one garment/service may be given (₹10,000).
const MAX_RATE_MINOR: i64 = 1_000_000;

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
    normalize_phone(&input.customer.phone)?;
    if input.items.len() > MAX_ORDER_LINES {
        return Err(format!(
            "An order can have at most {MAX_ORDER_LINES} different lines."
        ));
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
        if count as usize > crate::printing::MAX_TAGS_PER_DOCUMENT {
            return Err(format!(
                "An order can have at most {} pieces; split it into two orders.",
                crate::printing::MAX_TAGS_PER_DOCUMENT
            ));
        }
        if total > MAX_ORDER_TOTAL_MINOR {
            return Err("This order's total is unusually large; check the quantities.".into());
        }
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
    let percent_bp = {
        let mut conn = pool.acquire().await.map_err(db_err)?;
        resolve_discount(&mut conn, &input.customer).await?
    };
    let discount = discount_amount(total, percent_bp)?;
    Ok(Quote {
        lines,
        subtotal_minor: total,
        discount_percent_bp: percent_bp,
        discount_minor: discount,
        total_minor: total - discount,
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
    if price.is_some_and(|x| x > MAX_RATE_MINOR) {
        return Err("A rate cannot be more than ₹10,000. Check the amount.".into());
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
    let mut tx = db.begin_counter_write().await?;
    require_admin_in_tx(&mut tx, session, "change rates").await?;
    let before = sqlx::query("SELECT price_minor,available,version FROM garment_service_rates WHERE garment_id=? AND service_id=?")
        .bind(garment).bind(service).fetch_optional(&mut *tx).await.map_err(db_err)?
        .ok_or("Garment or service not found.")?;
    let now = Utc::now().to_rfc3339();
    let result=sqlx::query("UPDATE garment_service_rates SET price_minor=?,configured=?,available=?,version=version+1,updated_at=?,updated_by=? WHERE garment_id=? AND service_id=?")
 .bind(price).bind(price.is_some() as i64).bind(available as i64).bind(&now).bind(&actor.id).bind(garment).bind(service).execute(&mut *tx).await.map_err(db_err)?;
    if result.rows_affected() != 1 {
        return Err("Garment or service not found.".into());
    }
    audit_details(
        &mut tx,
        &actor.id,
        "rate_changed",
        "rate",
        &format!("{garment}|{service}"),
        &now,
        &serde_json::json!({
            "oldPriceMinor": before.try_get::<Option<i64>, _>("price_minor").map_err(db_err)?,
            "oldAvailable": before.try_get::<i64, _>("available").map_err(db_err)? == 1,
            "oldVersion": before.try_get::<i64, _>("version").map_err(db_err)?,
            "newPriceMinor": price,
            "newAvailable": available,
        }),
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    Ok(())
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscountRule {
    pub id: String,
    pub scope: String,
    pub customer_id: Option<String>,
    pub customer_name: Option<String>,
    pub customer_phone: Option<String>,
    pub percent_bp: i64,
    pub label: String,
    pub active: bool,
}

/// Admin check against the session alone; fine for reads. Writes must use [`require_admin_in_tx`].
pub(crate) fn require_admin(session: &CounterSession, what: &str) -> Result<SessionActor, String> {
    let a = actor(session)?;
    if a.role != "admin" {
        return Err(format!("Administrator access is required to {what}."));
    }
    Ok(a)
}

pub async fn list_discounts(
    db: &DatabaseState,
    session: &CounterSession,
) -> Result<Vec<DiscountRule>, String> {
    require_admin(session, "view discounts")?;
    let rows = sqlx::query("SELECT d.id,d.scope,d.customer_id,c.name AS customer_name,c.phone AS customer_phone,d.percent_bp,d.label,d.active FROM counter_discounts d LEFT JOIN customers c ON c.id=d.customer_id ORDER BY d.scope,c.name")
        .fetch_all(db.writer_pool()?)
        .await
        .map_err(db_err)?;
    rows.iter()
        .map(|r| {
            Ok(DiscountRule {
                id: r.try_get("id").map_err(db_err)?,
                scope: r.try_get("scope").map_err(db_err)?,
                customer_id: r.try_get("customer_id").map_err(db_err)?,
                customer_name: r.try_get("customer_name").map_err(db_err)?,
                customer_phone: r.try_get("customer_phone").map_err(db_err)?,
                percent_bp: r.try_get("percent_bp").map_err(db_err)?,
                label: r.try_get("label").map_err(db_err)?,
                active: r.try_get::<i64, _>("active").map_err(db_err)? == 1,
            })
        })
        .collect()
}

/// Create or update the shop-wide rule (`customer_id` = None) or one customer's rule.
/// Only administrators may do this; it applies automatically to future orders.
pub async fn set_discount(
    db: &DatabaseState,
    session: &CounterSession,
    customer_id: Option<&str>,
    percent_bp: i64,
    active: bool,
    label: &str,
) -> Result<(), String> {
    let a = require_admin(session, "change discounts")?;
    if !(0..=10_000).contains(&percent_bp) {
        return Err("A discount must be between 0% and 100%.".into());
    }
    let label = label.trim();
    if label.chars().count() > 60 {
        return Err("Keep the discount label to 60 characters or fewer.".into());
    }
    let (scope, customer) = match customer_id {
        Some(id) if id.trim().is_empty() => return Err("Choose a customer.".into()),
        Some(id) => ("customer", Some(id)),
        None => ("all", None),
    };
    let now = Utc::now().to_rfc3339();
    let mut tx = db.begin_counter_write().await?;
    require_admin_in_tx(&mut tx, session, "change discounts").await?;
    if let Some(id) = customer {
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM customers WHERE id=?")
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
        if exists == 0 {
            return Err("That customer no longer exists.".into());
        }
    }
    let existing: Option<String> = if let Some(id) = customer {
        sqlx::query_scalar(
            "SELECT id FROM counter_discounts WHERE scope='customer' AND customer_id=?",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?
    } else {
        sqlx::query_scalar("SELECT id FROM counter_discounts WHERE scope='all'")
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
    };
    let previous: Option<(i64, i64)> = if let Some(id) = &existing {
        sqlx::query_as("SELECT percent_bp,active FROM counter_discounts WHERE id=?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
    } else {
        None
    };
    let rule_id = if let Some(id) = existing {
        sqlx::query("UPDATE counter_discounts SET percent_bp=?,label=?,active=?,updated_at=?,updated_by=? WHERE id=?")
            .bind(percent_bp).bind(label).bind(active as i64).bind(&now).bind(&a.id).bind(&id)
            .execute(&mut *tx).await.map_err(db_err)?;
        id
    } else {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO counter_discounts(id,scope,customer_id,percent_bp,label,active,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?)")
            .bind(&id).bind(scope).bind(customer).bind(percent_bp).bind(label).bind(active as i64).bind(&now).bind(&now).bind(&a.id)
            .execute(&mut *tx).await.map_err(db_err)?;
        id
    };
    audit_details(
        &mut tx,
        &a.id,
        "discount_changed",
        "discount",
        &rule_id,
        &now,
        &serde_json::json!({
            "scope": scope,
            "customerId": customer,
            "oldPercentBp": previous.map(|p| p.0),
            "oldActive": previous.map(|p| p.1 == 1),
            "newPercentBp": percent_bp,
            "newActive": active,
            "label": label,
        }),
    )
    .await?;
    tx.commit().await.map_err(db_err)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettings {
    /// Where automatic backups are kept on this computer.
    pub folder: String,
    /// Optional second folder (for example a USB drive) that also receives every backup.
    pub mirror_dir: Option<String>,
    /// `None` when no second folder is set, `"ok"`, or `"failed: <reason>"` for the latest backup.
    pub mirror_status: Option<String>,
    pub last_backup_at: Option<String>,
}

pub async fn backup_settings(
    db: &DatabaseState,
    session: &CounterSession,
) -> Result<BackupSettings, String> {
    require_admin(session, "view backup settings")?;
    read_backup_settings(db).await
}

async fn read_backup_settings(db: &DatabaseState) -> Result<BackupSettings, String> {
    let nonempty = |value: Option<String>| value.filter(|v| !v.is_empty());
    Ok(BackupSettings {
        folder: db.backup_folder()?.to_string_lossy().into_owned(),
        mirror_dir: nonempty(db.setting(BACKUP_MIRROR_DIR).await),
        mirror_status: nonempty(db.setting(BACKUP_MIRROR_STATUS).await),
        last_backup_at: nonempty(db.setting(BACKUP_LAST_AT).await),
    })
}

/// Choose (or clear, with `None` or blank) the second backup folder. The folder must already
/// exist, be writable, and be outside this app's own data folder so one disk failure cannot
/// take both copies.
pub async fn set_backup_mirror(
    db: &DatabaseState,
    session: &CounterSession,
    directory: Option<&str>,
) -> Result<(), String> {
    let a = require_admin(session, "change backup settings")?;
    let chosen = directory.map(str::trim).unwrap_or_default().to_string();
    if !chosen.is_empty() {
        let path = std::path::Path::new(&chosen);
        if !path.is_absolute() {
            return Err("Enter the full path of the folder, for example E:\\Backups.".into());
        }
        if !path.is_dir() {
            return Err("That folder does not exist. Connect the drive and check the path.".into());
        }
        let inside_data = match (path.canonicalize(), db.data_folder()?.canonicalize()) {
            (Ok(chosen_real), Ok(data_real)) => chosen_real.starts_with(data_real),
            _ => false,
        };
        if inside_data {
            return Err("Choose a folder outside the app's own data folder.".into());
        }
        let data_folder = db.data_folder()?;
        let on_same_drive = match (path.canonicalize(), data_folder.canonicalize()) {
            (Ok(chosen_real), Ok(data_real)) => crate::storage::same_drive(
                &chosen_real.to_string_lossy(),
                &data_real.to_string_lossy(),
            ),
            _ => false,
        };
        if on_same_drive {
            return Err("Choose a different drive from the one that holds the app's data (for example a USB stick), so one failed disk cannot take both copies.".into());
        }
        // Backups go into a subfolder named for this computer. It is created here, and a copy is
        // only made while it exists, so a different USB stick that took over the same drive letter
        // is never written to by mistake.
        let target = db.mirror_target(path).await;
        std::fs::create_dir_all(&target)
            .map_err(|error| format!("That folder cannot be written to: {error}"))?;
        let probe = target.join(format!(".laundry-write-test-{}", Uuid::new_v4().simple()));
        std::fs::write(&probe, b"ok")
            .and_then(|()| std::fs::remove_file(&probe))
            .map_err(|error| format!("That folder cannot be written to: {error}"))?;
    }
    let now = Utc::now().to_rfc3339();
    let mut tx = db.begin_counter_write().await?;
    require_admin_in_tx(&mut tx, session, "change backup settings").await?;
    sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
        .bind(BACKUP_MIRROR_DIR).bind(&chosen).bind(&now)
        .execute(&mut *tx).await.map_err(db_err)?;
    audit(
        &mut tx,
        &a.id,
        "backup_mirror_changed",
        "settings",
        BACKUP_MIRROR_DIR,
        &now,
    )
    .await?;
    tx.commit().await.map_err(db_err)
}

pub async fn backup_now(
    db: &DatabaseState,
    session: &CounterSession,
) -> Result<BackupSettings, String> {
    require_admin(session, "back up the database")?;
    db.backup_database().await?;
    read_backup_settings(db).await
}

/// Stage a backup file to replace the database at the next start. Administrators only. The role is
/// checked from the session first (before any file is touched) and again against the database on
/// the writer connection just before staging (see [`authorize_restore`]); the app keeps a safety
/// copy of the current database first and blocks writes until it restarts.
pub async fn restore_backup(
    db: &DatabaseState,
    session: &CounterSession,
    source_path: String,
) -> Result<String, String> {
    let actor = require_admin(session, "restore a backup")?;
    if source_path.trim().is_empty() {
        return Err("Choose a backup file to restore.".into());
    }
    let request = db
        .restore_database(source_path.trim().to_string())
        .with_admin_actor(actor.id);
    tauri::async_runtime::spawn_blocking(move || tauri::async_runtime::block_on(request.apply()))
        .await
        .map_err(|error| format!("The database restore task failed: {error}"))?
}

/// Runs on the writer connection while a restore is being staged: the account must still be an
/// active administrator, and the request is audited before the safety backup is taken, so the
/// audit row is inside that safety copy.
pub(crate) async fn authorize_restore(
    connection: &mut sqlx::SqliteConnection,
    actor_id: &str,
    source_path: &str,
) -> Result<(), String> {
    use sqlx::Connection;
    let mut tx = connection.begin().await.map_err(db_err)?;
    require_active_admin_in_tx(&mut tx, actor_id).await?;
    audit_details(
        &mut tx,
        actor_id,
        "restore_requested",
        "backup",
        "database",
        &Utc::now().to_rfc3339(),
        &serde_json::json!({ "sourcePath": source_path }),
    )
    .await?;
    tx.commit().await.map_err(db_err)
}

pub const ADMIN_PIN_RESET_FILE: &str = "reset-admin-pin.txt";

/// Text of a file the owner typed on Windows: UTF-8 (with or without a byte-order mark) or the
/// UTF-16 that PowerShell's `>` and Notepad's "Unicode" produce.
fn decode_text_file(bytes: &[u8]) -> Result<String, String> {
    let utf16 = |rest: &[u8], big_endian: bool| -> Result<String, String> {
        if rest.len() % 2 != 0 {
            return Err("the text file is cut off".into());
        }
        let units: Vec<u16> = rest
            .chunks_exact(2)
            .map(|pair| {
                if big_endian {
                    u16::from_be_bytes([pair[0], pair[1]])
                } else {
                    u16::from_le_bytes([pair[0], pair[1]])
                }
            })
            .collect();
        String::from_utf16(&units).map_err(|_| "the text file is not valid text".to_string())
    };
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return utf16(rest, false);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return utf16(rest, true);
    }
    let rest = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    String::from_utf8(rest.to_vec()).map_err(|_| "the text file is not valid text".to_string())
}

/// Break-glass recovery for a forgotten administrator PIN, for a shop with no internet and no
/// support desk. Someone with access to the computer's files puts the new PIN (4 to 8 digits) in
/// `reset-admin-pin.txt` inside the app's data folder and starts the app. The file is read and
/// DELETED FIRST, then the PIN is applied once, so a leftover file can never re-apply an old PIN
/// later; a file that cannot be deleted is not applied at all. Rejected files are deleted too,
/// so no PIN is left lying on disk. The reset is audited. Anyone able to drop this file could also
/// replace the unencrypted database file, so it adds no access that file access did not already
/// give. Returns a message for the owner, or `None` if there was no file.
pub async fn apply_admin_pin_reset_file(db: &DatabaseState) -> Option<String> {
    let path = db.data_folder().ok()?.join(ADMIN_PIN_RESET_FILE);
    if !path.exists() {
        return None;
    }
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            return Some(format!(
                "The administrator PIN was not reset: the file could not be read ({error})."
            ))
        }
    };
    if let Err(error) = std::fs::remove_file(&path) {
        return Some(format!(
            "The administrator PIN was not reset: the file could not be deleted ({error}), and a file that stays behind would be applied at every start. Delete reset-admin-pin.txt and try again."
        ));
    }
    let pin = match decode_text_file(&bytes) {
        Ok(text) => text.trim().to_string(),
        Err(problem) => {
            return Some(format!(
                "The administrator PIN was not reset: {problem}. The file was deleted. Save it as plain text containing only the PIN."
            ))
        }
    };
    if let Err(problem) = validate_account(&AccountInput {
        full_name: "Administrator".into(),
        pin: pin.clone(),
    }) {
        return Some(format!(
            "The administrator PIN was not reset: {problem} The file was deleted."
        ));
    }
    let outcome: Result<bool, String> = async {
        let mut tx = db.begin_counter_write().await?;
        let admin: Option<String> = sqlx::query_scalar(
            "SELECT id FROM counter_accounts WHERE role='admin' ORDER BY created_at LIMIT 1",
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
        let Some(admin) = admin else {
            return Ok(false);
        };
        let salt = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        sqlx::query("UPDATE counter_accounts SET pin_hash=?,pin_salt=?,active=1,failed_attempts=0,locked_until=NULL,updated_at=? WHERE id=?")
            .bind(hash_pin(&pin, &salt)).bind(&salt).bind(&now).bind(&admin)
            .execute(&mut *tx).await.map_err(db_err)?;
        let legacy_salt =
            base64::engine::general_purpose::STANDARD.encode(Uuid::new_v4().as_bytes());
        sqlx::query("UPDATE local_users SET pin_hash=?,pin_salt=?,updated_at=? WHERE id=?")
            .bind(legacy_hash(&pin, &legacy_salt)).bind(&legacy_salt).bind(&now).bind(&admin)
            .execute(&mut *tx).await.map_err(db_err)?;
        audit(&mut tx, &admin, "admin_pin_reset_by_file", "account", &admin, &now).await?;
        tx.commit().await.map_err(db_err)?;
        Ok(true)
    }
    .await;
    Some(match outcome {
        Ok(true) => "The administrator PIN was reset from reset-admin-pin.txt.".into(),
        Ok(false) => "The administrator PIN was not reset: no administrator exists yet, so there is nothing to reset. The file was deleted.".into(),
        Err(error) => format!(
            "The administrator PIN was not reset ({error}). The file was deleted; create it again and restart."
        ),
    })
}

fn submission_hash(input: &SaveInput) -> Result<String, String> {
    let bytes = serde_json::to_vec(input)
        .map_err(|error| format!("Could not fingerprint order submission: {error}"))?;
    Ok(hex(&Sha256::digest(bytes)))
}

pub async fn save_order(
    db: &DatabaseState,
    session: &CounterSession,
    input: SaveInput,
) -> Result<SavedOrder, String> {
    let actor = actor(session)?;
    if input.idempotency_key.trim().is_empty() || input.idempotency_key.len() > 100 {
        return Err("A valid order submission key is required.".into());
    }
    let pool = db.writer_pool()?;
    let payload_hash = submission_hash(&input)?;
    if let Some(row) = sqlx::query(
        "SELECT order_id,payload_hash FROM counter_order_requests WHERE idempotency_key=?",
    )
    .bind(&input.idempotency_key)
    .fetch_optional(pool)
    .await
    .map_err(db_err)?
    {
        let id: String = row.try_get("order_id").map_err(db_err)?;
        let saved_hash: String = row.try_get("payload_hash").map_err(db_err)?;
        if saved_hash != payload_hash {
            return Err("This submission key was already used for a different order draft.".into());
        }
        return get_saved(db, &id)
            .await?
            .ok_or("Saved order could not be loaded.".into());
    }
    let legacy_existing: Option<String> =
        sqlx::query_scalar("SELECT id FROM orders WHERE idempotency_key=?")
            .bind(&input.idempotency_key)
            .fetch_optional(pool)
            .await
            .map_err(db_err)?;
    if legacy_existing.is_some() {
        return Err("This older submission key cannot be verified. Start a new submission.".into());
    }
    let now = Utc::now();
    let quote = quote_at(pool, &input.order, now).await?;
    if input.reviewed_quote != quote {
        return Err(
            "Rates or the promised time changed. Review the refreshed quote before saving.".into(),
        );
    }
    // Payment is always taken in full up front, so a saved order never carries a balance.
    match (&input.payment, quote.total_minor) {
        (None, 0) => {}
        (Some(_), 0) => return Err("No payment is due for a fully discounted order.".into()),
        (None, _) => return Err("Payment in full is required before the order is saved.".into()),
        (Some(payment), total) if payment.amount_minor != total => {
            return Err("The full order amount must be received before the order is saved.".into())
        }
        _ => {}
    }
    let phone = normalize_phone(&input.order.customer.phone)?;
    let mut tx = db.begin_counter_write().await?;
    if let Some(row) = sqlx::query(
        "SELECT order_id,payload_hash FROM counter_order_requests WHERE idempotency_key=?",
    )
    .bind(&input.idempotency_key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    {
        let id: String = row.try_get("order_id").map_err(db_err)?;
        let saved_hash: String = row.try_get("payload_hash").map_err(db_err)?;
        if saved_hash != payload_hash {
            return Err("This submission key was already used for a different order draft.".into());
        }
        tx.rollback().await.map_err(db_err)?;
        return get_saved(db, &id)
            .await?
            .ok_or("Saved order could not be loaded.".into());
    }
    for line in &quote.lines {
        let current=sqlx::query("SELECT r.price_minor,r.configured,r.available,r.version,g.active AS garment_active,s.active AS service_active FROM garment_service_rates r JOIN garments g ON g.id=r.garment_id JOIN service_methods s ON s.id=r.service_id WHERE r.garment_id=? AND r.service_id=?")
            .bind(&line.garment_id).bind(&line.service_id).fetch_optional(&mut *tx).await.map_err(db_err)?.ok_or("The rate changed; quote the order again.")?;
        let price = current
            .try_get::<Option<i64>, _>("price_minor")
            .map_err(db_err)?;
        let configured = current.try_get::<i64, _>("configured").map_err(db_err)? == 1;
        let available = current.try_get::<i64, _>("available").map_err(db_err)? == 1;
        let version = current.try_get::<i64, _>("version").map_err(db_err)?;
        let active = current
            .try_get::<i64, _>("garment_active")
            .map_err(db_err)?
            == 1
            && current
                .try_get::<i64, _>("service_active")
                .map_err(db_err)?
                == 1;
        if !configured
            || !available
            || !active
            || price != Some(line.unit_price_minor)
            || version != line.rate_version
        {
            return Err(
                "Rates changed while the order was open. Review the refreshed total before saving."
                    .into(),
            );
        }
    }
    if resolve_discount(&mut tx, &input.order.customer).await? != quote.discount_percent_bp {
        return Err(
            "The discount changed while the order was open. Review the refreshed total before saving."
                .into(),
        );
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
        let found = resolve_customer_id(&mut tx, &input.order.customer).await?;
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
            sqlx::query("INSERT INTO customers(id,customer_code,name,phone,customer_type,created_at,updated_at,origin_device_id) VALUES(?,?,?,?,'regular',?,?,?)").bind(&id).bind(code).bind(input.order.customer.name.trim()).bind(&phone).bind(&received).bind(&received).bind(device).execute(&mut *tx).await.map_err(db_err)?;
            Some(id)
        }
    };
    let year = now.timestamp() + 19800;
    let year = chrono::DateTime::from_timestamp(year, 0)
        .ok_or("Could not create order timestamp.")?
        .format("%Y")
        .to_string();
    let prefix = crate::shop_settings::order_prefix(&mut tx).await?;
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
    sqlx::query("INSERT INTO orders(id,order_number,customer_id,customer_name,customer_phone,order_type,received_at,expected_ready_at,status,subtotal,discount_type,discount_value,discount_amount,total_amount,payment_status,created_by,created_at,updated_at,origin_device_id,idempotency_key) VALUES(?,?,?,?,?,'piece',?,?,'received',?,'percentage',?,?,?,'unpaid',?,?,?,?,?)")
 .bind(&oid).bind(&order_no).bind(customer_id).bind(input.order.customer.name.trim()).bind(&phone).bind(&received).bind(&due).bind(quote.subtotal_minor as f64/100.0).bind(quote.discount_percent_bp as f64/100.0).bind(quote.discount_minor as f64/100.0).bind(quote.total_minor as f64/100.0).bind(&actor.id).bind(&received).bind(&received).bind(device).bind(&input.idempotency_key).execute(&mut *tx).await.map_err(db_err)?;
    sqlx::query("INSERT INTO counter_order_requests(idempotency_key,order_id,payload_hash,created_at) VALUES(?,?,?,?)")
        .bind(&input.idempotency_key).bind(&oid).bind(&payload_hash).bind(&received).execute(&mut *tx).await.map_err(db_err)?;
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
            // Short IDs are the two-digit year, the bill sequence and the position, so they are
            // unique, collision-free and easy to read out at pickup (for example 2600123-3).
            let short = format!(
                "{:02}{:05}-{}",
                year.parse::<i64>().unwrap_or(0) % 100,
                seq,
                all_pieces.len() + 1
            );
            all_pieces.push(Piece {
                id: pid.clone(),
                short_id: short.clone(),
                garment_id: src.garment_id.clone(),
                garment: line.garment.clone(),
                service: line.service.clone(),
                position: all_pieces.len() as u32 + 1,
                total: quote.piece_count,
                matched: false,
                packing_matched: false,
                collection_matched: false,
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
        let status = "paid";
        sqlx::query("INSERT INTO payments(id,order_id,amount,method,reference_number,recorded_at,recorded_by,created_at,updated_at,origin_device_id) VALUES(?,?,?,?,?,?,?,?,?,?)")
   .bind(Uuid::new_v4().to_string()).bind(&oid).bind(paid as f64/100.0).bind(&payment.method).bind(&payment.reference).bind(&received).bind(&actor.id).bind(&received).bind(&received).bind("counter").execute(&mut *tx).await.map_err(db_err)?;
        sqlx::query("UPDATE orders SET payment_status=? WHERE id=?")
            .bind(status)
            .bind(&oid)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    if input.payment.is_none() {
        // Only reachable for a 100% discount (total 0): nothing to collect, so the order is paid.
        sqlx::query("UPDATE orders SET payment_status='paid' WHERE id=?")
            .bind(&oid)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    // The shop identity is copied into the document now, so a reprint matches this bill.
    let print_settings = crate::shop_settings::load_for_order(&mut tx).await?;
    let header = print_settings.bill_header();
    let bill = crate::printing::BillDocument {
        header,
        order_number: order_no.clone(),
        created_at_ist: ist_time(now),
        promised_at_ist: ist_time(
            chrono::DateTime::parse_from_rfc3339(&due)
                .map_err(|e| e.to_string())?
                .with_timezone(&Utc),
        ),
        customer_name: input.order.customer.name.trim().into(),
        customer_phone: phone.clone(),
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
        subtotal_minor: quote.subtotal_minor,
        discount_percent_bp: quote.discount_percent_bp,
        discount_minor: quote.discount_minor,
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
        shop_name: print_settings.shop_name.clone(),
        show_shop_name: print_settings.print_shop_name_on_tags,
        tag_line: print_settings.tag_line.clone(),
        tag_length_tenths_mm: print_settings.tag_length_tenths_mm,
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
        "SELECT id,order_number,received_at,expected_ready_at,total_amount,status FROM orders WHERE id=?",
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
    let status: String = o.try_get("status").map_err(db_err)?;
    let paid: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount),0.0) FROM payments WHERE order_id=? AND voided_at IS NULL",
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
        status,
        total_minor: (total * 100.0).round() as i64,
        paid_minor: (paid * 100.0).round() as i64,
        balance_minor: (total * 100.0).round() as i64 - (paid * 100.0).round() as i64,
        pieces,
        print_jobs: jobs,
    }))
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderSummary {
    pub id: String,
    pub order_number: String,
    pub customer_name: String,
    pub customer_phone: String,
    pub status: String,
    pub received_at: String,
    pub promised_at: Option<String>,
    pub total_minor: i64,
    pub paid_minor: i64,
    pub balance_minor: i64,
    pub piece_count: u32,
}
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecordPaymentInput {
    pub amount_minor: i64,
    pub method: String,
    pub reference: Option<String>,
    pub idempotency_key: String,
}

pub async fn search_orders(
    db: &DatabaseState,
    session: &CounterSession,
    query: &str,
    offset: u32,
    limit: u32,
) -> Result<Vec<OrderSummary>, String> {
    let _ = actor(session)?;
    if offset > 100_000 || !(1..=100).contains(&limit) {
        return Err("Order search page is out of range.".into());
    }
    let q = query.trim();
    // An empty search lists the newest orders so pickup never opens on a blank screen; a single
    // character is too broad to be useful.
    if q.chars().count() == 1 {
        return Ok(Vec::new());
    }
    // LIKE wildcards typed by the operator are matched literally.
    let pattern = like_contains(q);
    // A typed phone number ("98765 43210", "+91 98765 43210") also matches the stored digits.
    let phone_digits = strip_country_prefix(
        q.chars()
            .filter_map(digit_value)
            .filter_map(|v| char::from_digit(v, 10))
            .collect(),
    );
    let looks_like_phone = phone_digits.len() >= 3
        && q.chars()
            .all(|c| digit_value(c).is_some() || matches!(c, ' ' | '-' | '+' | '.' | '(' | ')'));
    let phone_pattern = if looks_like_phone {
        format!("%{phone_digits}%")
    } else {
        pattern.clone()
    };
    let rows = sqlx::query("SELECT o.id,o.order_number,o.customer_name,o.customer_phone,o.status,o.received_at,o.expected_ready_at,o.total_amount,COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id=o.id AND p.voided_at IS NULL),0.0) AS paid,COALESCE((SELECT COUNT(*) FROM order_pieces p WHERE p.order_id=o.id),0) AS pieces FROM orders o WHERE ?1='' OR o.order_number LIKE ?2 ESCAPE '\\' OR o.customer_phone LIKE ?5 ESCAPE '\\' ORDER BY o.created_at DESC LIMIT ?3 OFFSET ?4")
        .bind(q).bind(pattern).bind(limit as i64).bind(offset as i64).bind(phone_pattern).fetch_all(db.writer_pool()?).await.map_err(db_err)?;
    rows.iter()
        .map(|r| {
            let total: f64 = r.try_get("total_amount").map_err(db_err)?;
            let paid: f64 = r.try_get("paid").map_err(db_err)?;
            Ok(OrderSummary {
                id: r.try_get("id").map_err(db_err)?,
                order_number: r.try_get("order_number").map_err(db_err)?,
                customer_name: r.try_get("customer_name").map_err(db_err)?,
                customer_phone: r.try_get("customer_phone").map_err(db_err)?,
                status: r.try_get("status").map_err(db_err)?,
                received_at: r.try_get("received_at").map_err(db_err)?,
                promised_at: r.try_get("expected_ready_at").map_err(db_err)?,
                total_minor: (total * 100.0).round() as i64,
                paid_minor: (paid * 100.0).round() as i64,
                balance_minor: (total * 100.0).round() as i64 - (paid * 100.0).round() as i64,
                piece_count: r.try_get("pieces").map_err(db_err)?,
            })
        })
        .collect()
}
pub async fn get_order(
    db: &DatabaseState,
    session: &CounterSession,
    id: &str,
) -> Result<Option<SavedOrder>, String> {
    let _ = actor(session)?;
    get_saved(db, id).await
}
pub async fn record_payment(
    db: &DatabaseState,
    session: &CounterSession,
    order_id: &str,
    input: RecordPaymentInput,
) -> Result<SavedOrder, String> {
    let a = actor(session)?;
    if input.idempotency_key.trim().is_empty() || input.idempotency_key.len() > 100 {
        return Err("A payment submission key is required.".into());
    }
    if input.amount_minor <= 0
        || !matches!(
            input.method.as_str(),
            "cash" | "upi" | "card" | "bank_transfer" | "other"
        )
    {
        return Err("Enter a positive whole-paise payment and a valid method.".into());
    }
    let hash = hex(&Sha256::digest(
        serde_json::to_vec(&(&input.amount_minor, &input.method, &input.reference))
            .map_err(|e| e.to_string())?,
    ));
    let p = db.writer_pool()?;
    if let Some(row) =
        sqlx::query("SELECT order_id,payload_hash FROM counter_payment_requests WHERE request_id=?")
            .bind(&input.idempotency_key)
            .fetch_optional(p)
            .await
            .map_err(db_err)?
    {
        let prior_order: String = row.try_get("order_id").map_err(db_err)?;
        let prior_hash: String = row.try_get("payload_hash").map_err(db_err)?;
        if prior_order != order_id || prior_hash != hash {
            return Err("Payment request key was already used for a different payment.".into());
        }
        return get_saved(db, order_id)
            .await?
            .ok_or("Order not found.".into());
    }
    let mut tx = db.begin_counter_write().await?;
    if let Some(row) =
        sqlx::query("SELECT order_id,payload_hash FROM counter_payment_requests WHERE request_id=?")
            .bind(&input.idempotency_key)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
    {
        let prior_order: String = row.try_get("order_id").map_err(db_err)?;
        let prior_hash: String = row.try_get("payload_hash").map_err(db_err)?;
        if prior_order != order_id || prior_hash != hash {
            return Err("Payment request key was already used for a different payment.".into());
        }
        tx.rollback().await.map_err(db_err)?;
        return get_saved(db, order_id)
            .await?
            .ok_or("Order not found.".into());
    }
    let row = sqlx::query("SELECT total_amount,status FROM orders WHERE id=?")
        .bind(order_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?
        .ok_or("Order not found.".to_string())?;
    let total: f64 = row.try_get("total_amount").map_err(db_err)?;
    let status: String = row.try_get("status").map_err(db_err)?;
    if status == "cancelled" {
        return Err("Payments cannot be added to a cancelled order.".into());
    }
    let paid: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount),0.0) FROM payments WHERE order_id=? AND voided_at IS NULL",
    )
    .bind(order_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let total_minor = (total * 100.0).round() as i64;
    let paid_minor = (paid * 100.0).round() as i64;
    if input.amount_minor > total_minor - paid_minor {
        return Err("Payment cannot exceed the outstanding balance.".into());
    }
    let now = Utc::now().to_rfc3339();
    let payment_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO payments(id,order_id,amount,method,reference_number,recorded_at,recorded_by,created_at,updated_at,origin_device_id) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .bind(&payment_id).bind(order_id).bind(input.amount_minor as f64/100.0).bind(&input.method).bind(&input.reference).bind(&now).bind(&a.id).bind(&now).bind(&now).bind("counter").execute(&mut *tx).await.map_err(db_err)?;
    sqlx::query("INSERT INTO counter_payment_requests(request_id,order_id,payment_id,payload_hash,created_at) VALUES(?,?,?,?,?)").bind(&input.idempotency_key).bind(order_id).bind(&payment_id).bind(hash).bind(&now).execute(&mut *tx).await.map_err(db_err)?;
    let new_paid = paid_minor + input.amount_minor;
    let payment_status = if new_paid == total_minor {
        "paid"
    } else {
        "partially_paid"
    };
    sqlx::query("UPDATE orders SET payment_status=?,updated_at=? WHERE id=?")
        .bind(payment_status)
        .bind(&now)
        .bind(order_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    audit(&mut tx, &a.id, "payment_recorded", "order", order_id, &now).await?;
    tx.commit().await.map_err(db_err)?;
    get_saved(db, order_id)
        .await?
        .ok_or("Order not found.".into())
}
pub async fn update_order_status(
    db: &DatabaseState,
    session: &CounterSession,
    order_id: &str,
    next: &str,
) -> Result<SavedOrder, String> {
    let a = actor(session)?;
    if !matches!(
        next,
        "washing" | "drying" | "ironing" | "quality_check" | "packing" | "ready"
    ) {
        return Err("Choose a valid processing status.".into());
    }
    let mut tx = db.begin_counter_write().await?;
    let current: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=?")
        .bind(order_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?
        .ok_or("Order not found.".to_string())?;
    let allowed = match current.as_str() {
        "received" => matches!(
            next,
            "washing" | "drying" | "ironing" | "quality_check" | "packing" | "ready"
        ),
        "washing" => matches!(
            next,
            "drying" | "ironing" | "quality_check" | "packing" | "ready"
        ),
        "drying" => matches!(next, "ironing" | "quality_check" | "packing" | "ready"),
        "ironing" => matches!(next, "quality_check" | "packing" | "ready"),
        "quality_check" => matches!(next, "packing" | "ready"),
        "packing" => next == "ready",
        _ => false,
    };
    if !allowed {
        return Err(format!("Order cannot move from {current} to {next}."));
    }
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE orders SET status=?,updated_at=? WHERE id=?")
        .bind(next)
        .bind(&now)
        .bind(order_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    audit(
        &mut tx,
        &a.id,
        "order_status_changed",
        "order",
        order_id,
        &now,
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    get_saved(db, order_id)
        .await?
        .ok_or("Order not found.".into())
}
/// Cancel an order that has not been collected: the order is marked cancelled, its payments are
/// voided (the owner hands the money back), unprinted output is dropped, and the reason and the
/// amount to refund are recorded. Administrator only; a collected order cannot be cancelled.
pub async fn cancel_order(
    db: &DatabaseState,
    session: &CounterSession,
    order_id: &str,
    reason: &str,
) -> Result<SavedOrder, String> {
    let a = require_admin(session, "cancel an order")?;
    let reason = reason.trim();
    if !(3..=200).contains(&reason.chars().count()) {
        return Err("Give a reason of 3 to 200 characters.".into());
    }
    let mut tx = db.begin_counter_write().await?;
    require_admin_in_tx(&mut tx, session, "cancel an order").await?;
    let status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=?")
        .bind(order_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?
        .ok_or("Order not found.".to_string())?;
    match status.as_str() {
        "collected" => return Err("A collected order cannot be cancelled.".into()),
        "cancelled" => return Err("This order is already cancelled.".into()),
        _ => {}
    }
    let now = Utc::now().to_rfc3339();
    let paid: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount),0.0) FROM payments WHERE order_id=? AND voided_at IS NULL",
    )
    .bind(order_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    sqlx::query("UPDATE payments SET voided_at=?,voided_by=?,void_reason=?,updated_at=? WHERE order_id=? AND voided_at IS NULL")
        .bind(&now).bind(&a.id).bind(reason).bind(&now).bind(order_id)
        .execute(&mut *tx).await.map_err(db_err)?;
    sqlx::query(
        "UPDATE orders SET status='cancelled',payment_status='unpaid',updated_at=? WHERE id=?",
    )
    .bind(&now)
    .bind(order_id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    sqlx::query("UPDATE print_jobs SET state='failed',last_error='The order was cancelled.',updated_at=? WHERE order_id=? AND state='pending'")
        .bind(&now).bind(order_id)
        .execute(&mut *tx).await.map_err(db_err)?;
    audit_details(
        &mut tx,
        &a.id,
        "order_cancelled",
        "order",
        order_id,
        &now,
        &serde_json::json!({
            "reason": reason,
            "previousStatus": status,
            "refundMinor": (paid * 100.0).round() as i64,
        }),
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    get_saved(db, order_id)
        .await?
        .ok_or("Order not found.".into())
}

pub async fn collect_order(
    db: &DatabaseState,
    session: &CounterSession,
    order_id: &str,
    piece_ids: Vec<String>,
    request_id: &str,
) -> Result<SavedOrder, String> {
    let a = actor(session)?;
    if request_id.trim().is_empty() || request_id.len() > 100 {
        return Err("A collection submission key is required.".into());
    }
    if let Some(row) =
        sqlx::query("SELECT order_id FROM counter_collection_requests WHERE request_id=?")
            .bind(request_id)
            .fetch_optional(db.writer_pool()?)
            .await
            .map_err(db_err)?
    {
        let existing: String = row.try_get("order_id").map_err(db_err)?;
        if existing != order_id {
            return Err("Collection request key belongs to another order.".into());
        }
        return get_saved(db, order_id)
            .await?
            .ok_or("Order not found.".into());
    }
    let mut tx = db.begin_counter_write().await?;
    // A duplicate submission that raced past the check above must see the earlier success.
    if let Some(existing) = sqlx::query_scalar::<_, String>(
        "SELECT order_id FROM counter_collection_requests WHERE request_id=?",
    )
    .bind(request_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    {
        tx.rollback().await.map_err(db_err)?;
        if existing != order_id {
            return Err("Collection request key belongs to another order.".into());
        }
        return get_saved(db, order_id)
            .await?
            .ok_or("Order not found.".into());
    }
    let row = sqlx::query("SELECT status,total_amount FROM orders WHERE id=?")
        .bind(order_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?
        .ok_or("Order not found.".to_string())?;
    let status: String = row.try_get("status").map_err(db_err)?;
    if status != "ready" {
        return Err("Only ready orders can be collected.".into());
    }
    let total: f64 = row.try_get("total_amount").map_err(db_err)?;
    let paid: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount),0.0) FROM payments WHERE order_id=? AND voided_at IS NULL",
    )
    .bind(order_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let balance = (total * 100.0).round() as i64 - (paid * 100.0).round() as i64;
    if balance > 0 {
        return Err(format!(
            "This order still has {} to pay. Record the payment before handing over the garments.",
            crate::print_layout::format_money(balance)
        ));
    }
    // Matching, the status change and the idempotency record share one transaction, so a failure
    // can never leave a half-collected order behind.
    let result = match_in_tx(&mut tx, &a.id, order_id, "collection", piece_ids).await?;
    if !result.complete {
        return Err("Every order piece must be confirmed for collection first.".into());
    }
    let now = Utc::now().to_rfc3339();
    let updated = sqlx::query(
        "UPDATE orders SET status='collected',updated_at=? WHERE id=? AND status='ready'",
    )
    .bind(&now)
    .bind(order_id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    if updated.rows_affected() != 1 {
        return Err("The order changed while it was being collected. Try again.".into());
    }
    sqlx::query(
        "INSERT INTO counter_collection_requests(request_id,order_id,created_at) VALUES(?,?,?)",
    )
    .bind(request_id)
    .bind(order_id)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    audit(&mut tx, &a.id, "order_collected", "order", order_id, &now).await?;
    tx.commit().await.map_err(db_err)?;
    get_saved(db, order_id)
        .await?
        .ok_or("Order not found.".into())
}

async fn pieces_for(p: &SqlitePool, order: &str) -> Result<Vec<Piece>, String> {
    let mut connection = p.acquire().await.map_err(db_err)?;
    pieces_for_conn(&mut connection, order).await
}

async fn pieces_for_conn(
    connection: &mut sqlx::SqliteConnection,
    order: &str,
) -> Result<Vec<Piece>, String> {
    let rows=sqlx::query("SELECT p.id,p.short_id,p.garment_id,p.garment_snapshot,p.service_snapshot,p.position,p.total,EXISTS(SELECT 1 FROM piece_matches m WHERE m.piece_id=p.id AND m.stage='packing') AS packing_matched,EXISTS(SELECT 1 FROM piece_matches m WHERE m.piece_id=p.id AND m.stage='collection') AS collection_matched FROM order_pieces p WHERE p.order_id=? ORDER BY p.position")
        .bind(order).fetch_all(&mut *connection).await.map_err(db_err)?;
    rows.iter()
        .map(|r| {
            let packing = r.try_get::<i64, _>("packing_matched").map_err(db_err)? == 1;
            let collection = r.try_get::<i64, _>("collection_matched").map_err(db_err)? == 1;
            Ok(Piece {
                id: r.try_get("id").map_err(db_err)?,
                short_id: r.try_get("short_id").map_err(db_err)?,
                garment_id: r.try_get("garment_id").map_err(db_err)?,
                garment: r.try_get("garment_snapshot").map_err(db_err)?,
                service: r.try_get("service_snapshot").map_err(db_err)?,
                position: r.try_get("position").map_err(db_err)?,
                total: r.try_get("total").map_err(db_err)?,
                matched: packing || collection,
                packing_matched: packing,
                collection_matched: collection,
            })
        })
        .collect()
}

async fn jobs_for(p: &SqlitePool, order: Option<&str>) -> Result<Vec<PrintJob>, String> {
    let rows = if let Some(order) = order {
        sqlx::query("SELECT j.id,j.kind,j.state,j.printer_id,j.os_job_id,j.last_error,j.order_id,o.order_number FROM print_jobs j JOIN orders o ON o.id=j.order_id WHERE j.order_id=? ORDER BY j.created_at")
            .bind(order).fetch_all(p).await.map_err(db_err)?
    } else {
        sqlx::query("SELECT j.id,j.kind,j.state,j.printer_id,j.os_job_id,j.last_error,j.order_id,o.order_number FROM print_jobs j JOIN orders o ON o.id=j.order_id ORDER BY CASE WHEN j.state IN ('pending','submitting','failed','uncertain') THEN 0 ELSE 1 END, j.created_at DESC LIMIT 200")
            .fetch_all(p).await.map_err(db_err)?
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
                order_id: r.try_get("order_id").map_err(db_err)?,
                order_number: r.try_get("order_number").map_err(db_err)?,
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
    stage: &str,
    ids: Vec<String>,
) -> Result<MatchResult, String> {
    let a = actor(session)?;
    let mut tx = db.begin_counter_write().await?;
    let result = match_in_tx(&mut tx, &a.id, order, stage, ids).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(result)
}

/// Replace the checklist for one stage and report what is missing, duplicated or foreign.
async fn match_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    actor_id: &str,
    order: &str,
    stage: &str,
    ids: Vec<String>,
) -> Result<MatchResult, String> {
    if !matches!(stage, "packing" | "collection") {
        return Err("Choose packing or collection checklist.".into());
    }
    let expected = pieces_for_conn(tx, order).await?;
    if expected.is_empty() {
        return Err("Order has no individually tracked pieces.".into());
    }
    let mut by_input = std::collections::HashMap::new();
    for piece in &expected {
        by_input.insert(piece.id.clone(), piece.id.clone());
        by_input.insert(piece.short_id.clone(), piece.id.clone());
    }
    let mut seen = std::collections::HashSet::new();
    let mut resolved = std::collections::HashSet::new();
    let mut duplicates = Vec::new();
    let mut wrong = Vec::new();
    for id in &ids {
        if let Some(canonical) = by_input.get(id) {
            if !seen.insert(canonical.clone()) {
                duplicates.push(id.clone());
            } else {
                resolved.insert(canonical.clone());
            }
        } else {
            wrong.push(id.clone());
        }
    }
    sqlx::query("DELETE FROM piece_matches WHERE order_id=? AND stage=?")
        .bind(order)
        .bind(stage)
        .execute(&mut **tx)
        .await
        .map_err(db_err)?;
    let now = Utc::now().to_rfc3339();
    for id in &resolved {
        sqlx::query("INSERT INTO piece_matches(id,order_id,piece_id,stage,matched_by,matched_at) VALUES(?,?,?,?,?,?)")
            .bind(Uuid::new_v4().to_string()).bind(order).bind(id).bind(stage).bind(actor_id).bind(&now)
            .execute(&mut **tx).await.map_err(db_err)?;
    }
    let missing = expected
        .iter()
        .filter(|piece| !resolved.contains(&piece.id))
        .map(|piece| piece.short_id.clone())
        .collect::<Vec<_>>();
    let complete = missing.is_empty() && wrong.is_empty() && duplicates.is_empty();
    audit(tx, actor_id, "pieces_matched", stage, order, &now).await?;
    Ok(MatchResult {
        matched_count: resolved.len(),
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
    if input.bill_printer_id == input.tag_printer_id {
        return Err("Choose different printers for bills and for tags.".into());
    }
    let available = crate::printing::enumerate_printers()
        .await
        .map_err(|e| e.to_string())?;
    for id in [&input.bill_printer_id, &input.tag_printer_id] {
        if !available.iter().any(|p| p.id == *id && p.is_available) {
            return Err(format!("Selected printer is not available: {id}"));
        }
    }
    let now = Utc::now().to_rfc3339();
    let mut tx = db.begin_counter_write().await?;
    require_admin_in_tx(&mut tx, session, "configure printers").await?;
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
    dispatch_jobs_filter(db, session, order, None).await
}
async fn dispatch_jobs_filter(
    db: &DatabaseState,
    session: &CounterSession,
    order: &str,
    only_job: Option<&str>,
) -> Result<Vec<PrintJob>, String> {
    let a = actor(session)?;
    let p = db.writer_pool()?;
    let profiles = get_profiles(db, session)
        .await?
        .ok_or("Configure both bill and tag printers in Admin settings.")?;
    let ids: Vec<String> = if let Some(job_id) = only_job {
        sqlx::query_scalar(
            "SELECT id FROM print_jobs WHERE order_id=? AND id=? AND state='pending'",
        )
        .bind(order)
        .bind(job_id)
        .fetch_all(p)
        .await
        .map_err(db_err)?
    } else {
        sqlx::query_scalar(
            "SELECT id FROM print_jobs WHERE order_id=? AND state='pending' ORDER BY kind",
        )
        .bind(order)
        .fetch_all(p)
        .await
        .map_err(db_err)?
    };
    for id in ids {
        let now = Utc::now().to_rfc3339();
        let mut tx = db.begin_counter_write().await?;
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
        let doc: crate::printing::PrintDocument = match serde_json::from_str(&payload) {
            Ok(doc) => doc,
            Err(error) => {
                // Nothing can ever be printed from this job; fail it visibly rather than leaving it
                // claimed forever.
                sqlx::query("UPDATE print_jobs SET state='failed',last_error=?,updated_at=? WHERE id=? AND state='pending'")
                    .bind(format!("The saved print document is unreadable: {error}"))
                    .bind(&now)
                    .bind(&id)
                    .execute(&mut *tx)
                    .await
                    .map_err(db_err)?;
                tx.commit().await.map_err(db_err)?;
                continue;
            }
        };
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
        let mut tx = db.begin_counter_write().await?;
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
pub async fn dispatch_job(
    db: &DatabaseState,
    session: &CounterSession,
    job_id: &str,
) -> Result<PrintJob, String> {
    let _ = actor(session)?;
    let p = db.writer_pool()?;
    let order: String = sqlx::query_scalar("SELECT order_id FROM print_jobs WHERE id=?")
        .bind(job_id)
        .fetch_optional(p)
        .await
        .map_err(db_err)?
        .ok_or("Print job not found.".to_string())?;
    dispatch_jobs_filter(db, session, &order, Some(job_id)).await?;
    jobs_for(p, Some(&order))
        .await?
        .into_iter()
        .find(|job| job.id == job_id)
        .ok_or("Print job not found.".into())
}
pub async fn retry_job(
    db: &DatabaseState,
    session: &CounterSession,
    job_id: &str,
    confirm_uncertain: bool,
) -> Result<PrintJob, String> {
    let a = actor(session)?;
    let p = db.writer_pool()?;
    // The state is checked and changed inside one transaction, and the change only applies to a
    // job that is still failed or uncertain. Two quick clicks on Retry therefore cannot both
    // succeed, and a job that is already printing can never be put back in the queue.
    let mut tx = db.begin_counter_write().await?;
    let row = sqlx::query("SELECT state,order_id FROM print_jobs WHERE id=?")
        .bind(job_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?
        .ok_or("Print job not found.")?;
    let state: String = row.try_get("state").map_err(db_err)?;
    let order_id: String = row.try_get("order_id").map_err(db_err)?;
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
    let reset = sqlx::query("UPDATE print_jobs SET state='pending',last_error=NULL,os_job_id=NULL,updated_at=? WHERE id=? AND state IN ('failed','uncertain')").bind(&now).bind(job_id).execute(&mut *tx).await.map_err(db_err)?;
    if reset.rows_affected() != 1 {
        return Err("This print job just changed. Refresh the list and check its state.".into());
    }
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
    dispatch_jobs_filter(db, session, &order_id, Some(job_id)).await?;
    jobs_for(p, Some(&order_id))
        .await?
        .into_iter()
        .find(|job| job.id == job_id)
        .ok_or("Print job not found.".into())
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
    let mut canonical_piece_ids = piece_ids.clone();
    canonical_piece_ids.sort();
    let request_hash = hex(&Sha256::digest(
        serde_json::to_vec(&(order_id, kind, canonical_piece_ids)).map_err(|e| e.to_string())?,
    ));
    if let Some(row) = sqlx::query(
        "SELECT id,order_id,kind,reprint_payload_hash FROM print_jobs WHERE reprint_request_id=?",
    )
    .bind(request_id)
    .fetch_optional(p)
    .await
    .map_err(db_err)?
    {
        let existing_order: String = row.try_get("order_id").map_err(db_err)?;
        let existing_kind: String = row.try_get("kind").map_err(db_err)?;
        let existing_hash: Option<String> = row.try_get("reprint_payload_hash").map_err(db_err)?;
        if existing_order != order_id
            || existing_kind != kind
            || existing_hash.as_deref() != Some(request_hash.as_str())
        {
            return Err("Reprint request key is already used for another output.".into());
        }
        let existing_id: String = row.try_get("id").map_err(db_err)?;
        return jobs_for(p, Some(order_id))
            .await?
            .into_iter()
            .find(|job| job.id == existing_id)
            .ok_or("Print job not found.".into());
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
            || !tags
                .pieces
                .iter()
                .any(|p| requested.contains(p.piece_id.as_str()))
            || requested
                .iter()
                .any(|id| !tags.pieces.iter().any(|p| p.piece_id == **id))
        {
            return Err("Selected tag IDs must be unique pieces from this order.".into());
        }
        tags.pieces
            .retain(|p| requested.contains(p.piece_id.as_str()));
    }
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    let mut tx = db.begin_counter_write().await?;
    sqlx::query("INSERT INTO print_jobs(id,order_id,kind,state,payload_json,created_at,updated_at,source_job_id,reprint_request_id,reprint_payload_hash) VALUES(?,?,?,'pending',?,?,?,?,?,?)")
        .bind(&id).bind(order_id).bind(kind).bind(serde_json::to_string(&document).map_err(|e| e.to_string())?).bind(&now).bind(&now).bind(&source_id).bind(request_id).bind(request_hash).execute(&mut *tx).await.map_err(db_err)?;
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
    jobs_for(p, Some(order_id))
        .await?
        .into_iter()
        .find(|job| job.id == id)
        .ok_or("Print job not found.".into())
}

pub async fn recover_submitting(db: &DatabaseState) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let mut tx = db.begin_counter_write().await?;
    sqlx::query("UPDATE print_job_attempts SET state='uncertain',error='Application ended during submission; inspect output before retrying.',finished_at=? WHERE state='submitting'").bind(&now).execute(&mut *tx).await.map_err(db_err)?;
    sqlx::query("UPDATE print_jobs SET state='uncertain',last_error='Application ended during submission; inspect output before retrying.',updated_at=? WHERE state='submitting'").bind(now).execute(&mut *tx).await.map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(())
}

pub async fn search_customers(
    db: &DatabaseState,
    session: &CounterSession,
    phone: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let _ = actor(session)?;
    // Typed digits are compared as plain ASCII digits whatever script or spacing was used.
    let digits: String = phone
        .chars()
        .filter_map(digit_value)
        .filter_map(|v| char::from_digit(v, 10))
        .collect();
    if digits.len() < 2 {
        return Ok(Vec::new());
    }
    let rows = sqlx::query(
        "SELECT id,name,phone FROM customers WHERE phone LIKE ? ORDER BY name LIMIT 20",
    )
    .bind(format!("{digits}%"))
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
            // Orders reference local_users, as they do for real staff created by create_staff.
            sqlx::query("INSERT INTO local_users(id,full_name,pin_hash,pin_salt,role,created_at,updated_at) VALUES(?,?,'x','x','admin',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
                .bind(id).bind(id).execute(p).await.unwrap();
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
    fn v1_upgrade_preserves_existing_admin_and_migrates_pin_on_first_login() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(
                    sqlx::sqlite::SqliteConnectOptions::new()
                        .filename(&path)
                        .create_if_missing(true)
                        .foreign_keys(true),
                )
                .await
                .unwrap();
            sqlx::raw_sql(include_str!("../migrations/001_initial_schema.sql"))
                .execute(&pool)
                .await
                .unwrap();
            let old_hash = legacy_hash("2468", "legacy-salt");
            sqlx::query("INSERT INTO local_users(id,full_name,pin_hash,pin_salt,role,created_at,updated_at) VALUES('legacy-admin','Laundry Owner',?,'legacy-salt','admin','2024-01-01','2024-01-01')").bind(&old_hash).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES('legacy-record','preserve-me','2024-01-01')").execute(&pool).await.unwrap();
            sqlx::query("PRAGMA user_version=1")
                .execute(&pool)
                .await
                .unwrap();
            pool.close().await;
            let db = DatabaseState::open(path.clone()).await;
            let session = CounterSession::default();
            let state = bootstrap(&db, &session).await.unwrap();
            assert!(!state.setup_required);
            assert_eq!(state.accounts.len(), 1);
            assert_eq!(state.accounts[0].id, "legacy-admin");
            assert!(login(&db, &session, "legacy-admin".into(), "0000".into())
                .await
                .is_err());
            let account = login(&db, &session, "legacy-admin".into(), "2468".into())
                .await
                .unwrap();
            assert_eq!(account.full_name, "Laundry Owner");
            assert!(setup_admin(
                &db,
                &session,
                AccountInput {
                    full_name: "Attacker".into(),
                    pin: "9876".into()
                }
            )
            .await
            .is_err());
            let saved_hash: String =
                sqlx::query_scalar("SELECT pin_hash FROM local_users WHERE id='legacy-admin'")
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            assert_eq!(
                saved_hash, old_hash,
                "legacy web credential remains compatible"
            );
            let native_hash: String =
                sqlx::query_scalar("SELECT pin_hash FROM counter_accounts WHERE id='legacy-admin'")
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            assert_ne!(
                native_hash, old_hash,
                "native hash upgrades after successful PIN verification"
            );
            let marker: String =
                sqlx::query_scalar("SELECT value FROM app_settings WHERE key='legacy-record'")
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            assert_eq!(marker, "preserve-me");
            drop(db);
            let _ = std::fs::remove_dir_all(path.parent().unwrap());
        });
    }

    async fn staff_fixture(db: &DatabaseState) -> CounterSession {
        let _ = db;
        let staff = CounterSession::default();
        staff
            .set(SessionActor {
                id: "fixture-staff".into(),
                role: "staff".into(),
            })
            .unwrap();
        staff
    }

    async fn cleanup(db: DatabaseState, path: PathBuf) {
        drop(db);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    fn pay(amount_minor: i64) -> Option<PaymentInput> {
        Some(PaymentInput {
            amount_minor,
            method: "cash".into(),
            reference: None,
        })
    }

    async fn save_with(
        db: &DatabaseState,
        session: &CounterSession,
        order: OrderInput,
        key: &str,
    ) -> Result<SavedOrder, String> {
        let reviewed_quote = quote(db, session, &order).await?;
        let payment = if reviewed_quote.total_minor == 0 {
            None
        } else {
            pay(reviewed_quote.total_minor)
        };
        save_order(
            db,
            session,
            SaveInput {
                order,
                reviewed_quote,
                idempotency_key: key.into(),
                payment,
            },
        )
        .await
    }

    #[test]
    fn default_rate_card_is_preloaded_and_shoes_cannot_be_ironed() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            let configured: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM garment_service_rates WHERE configured=1")
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            // 20 garments x 4 services plus shoes (wash and dry clean only).
            assert_eq!(configured, 20 * 4 + 2);
            let quoted = quote(&db, &admin, &order_input(2)).await.unwrap();
            assert_eq!((quoted.subtotal_minor, quoted.discount_minor), (10000, 0));
            for garment in ["g-coat", "g-kurta-pyjama"] {
                let active: i64 = sqlx::query_scalar("SELECT active FROM garments WHERE id=?")
                    .bind(garment)
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
                assert_eq!(active, 1, "{garment} is active");
            }
            for (garment, service, price) in [
                ("g-coat", "svc-iron", 2500),
                ("g-kurta-pyjama", "svc-dry-clean", 15000),
            ] {
                let mut item = order_input(1);
                item.items[0].garment_id = garment.into();
                item.items[0].service_id = service.into();
                assert_eq!(
                    quote(&db, &admin, &item).await.unwrap().subtotal_minor,
                    price,
                    "{garment} {service}"
                );
            }
            for service in ["svc-iron", "svc-wash-iron"] {
                let mut shoes = order_input(1);
                shoes.items[0].garment_id = "g-shoes".into();
                shoes.items[0].service_id = service.into();
                assert!(quote(&db, &admin, &shoes)
                    .await
                    .unwrap_err()
                    .contains("unavailable"));
            }
            let mut shoes = order_input(1);
            shoes.items[0].garment_id = "g-shoes".into();
            shoes.items[0].service_id = "svc-dry-clean".into();
            assert_eq!(quote(&db, &admin, &shoes).await.unwrap().total_minor, 35000);
            cleanup(db, path).await;
        });
    }

    #[test]
    fn only_admins_manage_discounts_and_values_are_validated() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            assert!(set_discount(&db, &staff, None, 500, true, "")
                .await
                .unwrap_err()
                .contains("Administrator"));
            assert!(list_discounts(&db, &staff).await.is_err());
            assert!(set_discount(&db, &admin, None, 10_001, true, "")
                .await
                .is_err());
            assert!(set_discount(&db, &admin, None, -1, true, "").await.is_err());
            assert!(set_discount(&db, &admin, None, 100, true, &"x".repeat(61))
                .await
                .is_err());
            assert!(set_discount(&db, &admin, Some(" "), 100, true, "")
                .await
                .is_err());
            assert!(set_discount(&db, &admin, Some("missing"), 100, true, "")
                .await
                .unwrap_err()
                .contains("no longer exists"));
            set_discount(&db, &admin, None, 1000, true, " Diwali ")
                .await
                .unwrap();
            set_discount(&db, &admin, None, 500, true, "Everyone")
                .await
                .unwrap();
            let rules = list_discounts(&db, &admin).await.unwrap();
            assert_eq!(rules.len(), 1, "one shop-wide rule is updated in place");
            assert_eq!(
                (rules[0].percent_bp, rules[0].label.as_str()),
                (500, "Everyone")
            );
            cleanup(db, path).await;
        });
    }

    #[test]
    fn discounts_apply_automatically_with_customer_rules_overriding_the_shop_rule() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            set_rate(&db, &admin, "g-shirt", "svc-wash", Some(1999), true)
                .await
                .unwrap();
            // Unknown customer, no rules: no discount.
            let none = quote(&db, &staff, &order_input(1)).await.unwrap();
            assert_eq!(
                (
                    none.discount_percent_bp,
                    none.discount_minor,
                    none.total_minor
                ),
                (0, 0, 1999)
            );
            // Shop-wide 10% of 1999 paise = 199.9, rounded half up to 200.
            set_discount(&db, &admin, None, 1000, true, "")
                .await
                .unwrap();
            let shop = quote(&db, &staff, &order_input(1)).await.unwrap();
            assert_eq!((shop.discount_minor, shop.total_minor), (200, 1799));
            // Inactive shop rule is ignored.
            set_discount(&db, &admin, None, 1000, false, "")
                .await
                .unwrap();
            assert_eq!(
                quote(&db, &staff, &order_input(1))
                    .await
                    .unwrap()
                    .discount_minor,
                0
            );
            set_discount(&db, &admin, None, 1000, true, "")
                .await
                .unwrap();
            // Save once so the customer exists, then give that customer their own rule.
            let first = save_with(&db, &staff, order_input(1), "first-order")
                .await
                .unwrap();
            assert_eq!(first.total_minor, 1799);
            let customer: String = sqlx::query_scalar("SELECT customer_id FROM orders WHERE id=?")
                .bind(&first.order_id)
                .fetch_one(db.writer_pool().unwrap())
                .await
                .unwrap();
            // 0% for this customer beats the 10% shop rule, found by phone with no id supplied.
            set_discount(&db, &admin, Some(&customer), 0, true, "No discount")
                .await
                .unwrap();
            assert_eq!(
                quote(&db, &staff, &order_input(1))
                    .await
                    .unwrap()
                    .discount_minor,
                0
            );
            set_discount(&db, &admin, Some(&customer), 2500, true, "Regular")
                .await
                .unwrap();
            let own = quote(&db, &staff, &order_input(2)).await.unwrap();
            // 25% of 3998 = 999.5 -> 1000.
            assert_eq!(
                (own.discount_percent_bp, own.discount_minor, own.total_minor),
                (2500, 1000, 2998)
            );
            // An inactive customer rule falls back to the shop rule.
            set_discount(&db, &admin, Some(&customer), 2500, false, "Regular")
                .await
                .unwrap();
            assert_eq!(
                quote(&db, &staff, &order_input(1))
                    .await
                    .unwrap()
                    .discount_percent_bp,
                1000
            );
            set_discount(&db, &admin, Some(&customer), 2500, true, "Regular")
                .await
                .unwrap();
            let second = save_with(&db, &staff, order_input(2), "second-order")
                .await
                .unwrap();
            assert_eq!(
                (second.total_minor, second.paid_minor, second.balance_minor),
                (2998, 2998, 0)
            );
            let stored: (String, f64, f64, f64) = sqlx::query_as("SELECT discount_type,discount_value,discount_amount,subtotal FROM orders WHERE id=?")
                .bind(&second.order_id)
                .fetch_one(db.writer_pool().unwrap())
                .await
                .unwrap();
            assert_eq!(stored, ("percentage".to_string(), 25.0, 10.0, 39.98));
            let payload: String = sqlx::query_scalar(
                "SELECT payload_json FROM print_jobs WHERE order_id=? AND kind='bill'",
            )
            .bind(&second.order_id)
            .fetch_one(db.writer_pool().unwrap())
            .await
            .unwrap();
            let crate::printing::PrintDocument::Bill(bill) =
                serde_json::from_str(&payload).unwrap()
            else {
                panic!("bill expected")
            };
            assert_eq!(
                (
                    bill.discount_percent_bp,
                    bill.discount_minor,
                    bill.paid_minor,
                    bill.balance_minor
                ),
                (2500, 1000, 2998, 0)
            );
            cleanup(db, path).await;
        });
    }

    #[test]
    fn a_discount_or_rate_changed_after_review_blocks_the_save() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            let reviewed = quote(&db, &staff, &order_input(1)).await.unwrap();
            let save = |key: &str| SaveInput {
                order: order_input(1),
                reviewed_quote: reviewed.clone(),
                idempotency_key: key.into(),
                payment: pay(reviewed.total_minor),
            };
            set_discount(&db, &admin, None, 1000, true, "")
                .await
                .unwrap();
            let blocked = save_order(&db, &staff, save("stale-discount"))
                .await
                .unwrap_err();
            assert!(
                blocked.contains("Rates or the promised time changed"),
                "{blocked}"
            );
            let orders: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders")
                .fetch_one(db.writer_pool().unwrap())
                .await
                .unwrap();
            assert_eq!(orders, 0);
            cleanup(db, path).await;
        });
    }

    #[test]
    fn payment_is_required_in_full_and_a_full_discount_needs_no_payment() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            let reviewed = quote(&db, &staff, &order_input(1)).await.unwrap();
            let total = reviewed.total_minor;
            let attempt = |amount: Option<i64>, key: &str| SaveInput {
                order: order_input(1),
                reviewed_quote: reviewed.clone(),
                idempotency_key: key.into(),
                payment: amount.map(|a| PaymentInput {
                    amount_minor: a,
                    method: "cash".into(),
                    reference: None,
                }),
            };
            for (amount, key) in [
                (None, "none"),
                (Some(total - 1), "short"),
                (Some(total + 1), "over"),
            ] {
                assert!(
                    save_order(&db, &staff, attempt(amount, key)).await.is_err(),
                    "{key}"
                );
            }
            let mut method = attempt(Some(total), "bad-method");
            method.payment.as_mut().unwrap().method = "barter".into();
            assert!(save_order(&db, &staff, method).await.is_err());
            let saved = save_order(&db, &staff, attempt(Some(total), "exact"))
                .await
                .unwrap();
            assert_eq!((saved.paid_minor, saved.balance_minor), (total, 0));
            let status: String = sqlx::query_scalar("SELECT payment_status FROM orders WHERE id=?")
                .bind(&saved.order_id)
                .fetch_one(db.writer_pool().unwrap())
                .await
                .unwrap();
            assert_eq!(status, "paid");

            set_discount(&db, &admin, None, 10_000, true, "Free")
                .await
                .unwrap();
            let free_quote = quote(&db, &staff, &order_input(1)).await.unwrap();
            assert_eq!(free_quote.total_minor, 0);
            let mut with_payment = SaveInput {
                order: order_input(1),
                reviewed_quote: free_quote.clone(),
                idempotency_key: "free-with-payment".into(),
                payment: pay(100),
            };
            assert!(
                save_order(&db, &staff, with_payment_clone(&mut with_payment))
                    .await
                    .unwrap_err()
                    .contains("No payment is due")
            );
            let free = save_with(&db, &staff, order_input(1), "free")
                .await
                .unwrap();
            assert_eq!(
                (free.total_minor, free.paid_minor, free.balance_minor),
                (0, 0, 0)
            );
            let free_status: String =
                sqlx::query_scalar("SELECT payment_status FROM orders WHERE id=?")
                    .bind(&free.order_id)
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            assert_eq!(free_status, "paid");
            cleanup(db, path).await;
        });
    }

    fn with_payment_clone(input: &mut SaveInput) -> SaveInput {
        SaveInput {
            order: input.order.clone(),
            reviewed_quote: input.reviewed_quote.clone(),
            idempotency_key: input.idempotency_key.clone(),
            payment: input.payment.take(),
        }
    }

    #[test]
    fn piece_ids_follow_the_bill_sequence_and_one_shoe_pair_gets_one_tag() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let _admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            let mut order = order_input(2);
            order.items.push(LineInput {
                garment_id: "g-shoes".into(),
                service_id: "svc-wash".into(),
                quantity: 3,
            });
            let saved = save_with(&db, &staff, order, "mixed").await.unwrap();
            assert_eq!(
                saved.pieces.len(),
                5,
                "two shirts plus three shoe pairs, one tag each"
            );
            let year = saved.order_number.split('-').nth(1).unwrap()[2..].to_string();
            let seq = saved.order_number.rsplit('-').next().unwrap();
            for (index, piece) in saved.pieces.iter().enumerate() {
                assert_eq!(piece.short_id, format!("{year}{seq}-{}", index + 1));
                assert_eq!((piece.position, piece.total), (index as u32 + 1, 5));
            }
            let again = save_with(&db, &staff, order_input(1), "second")
                .await
                .unwrap();
            assert!(again
                .pieces
                .iter()
                .all(|p| !saved.pieces.iter().any(|q| q.short_id == p.short_id)));
            cleanup(db, path).await;
        });
    }

    #[test]
    fn an_incomplete_collection_changes_nothing() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let _admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            let order = save_with(&db, &staff, order_input(3), "to-collect")
                .await
                .unwrap();
            update_order_status(&db, &staff, &order.order_id, "ready")
                .await
                .unwrap();
            let ids: Vec<String> = order.pieces.iter().map(|p| p.id.clone()).collect();
            let err = collect_order(&db, &staff, &order.order_id, ids[..2].to_vec(), "partial")
                .await
                .unwrap_err();
            assert!(err.contains("Every order piece"), "{err}");
            let matches: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM piece_matches WHERE order_id=?")
                    .bind(&order.order_id)
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            assert_eq!(
                matches, 0,
                "a rejected collection leaves no partial checklist behind"
            );
            let status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=?")
                .bind(&order.order_id)
                .fetch_one(db.writer_pool().unwrap())
                .await
                .unwrap();
            assert_eq!(status, "ready");
            let requests: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM counter_collection_requests")
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            assert_eq!(requests, 0);
            // Wrong-order and duplicate IDs are also rejected.
            let wrong = collect_order(
                &db,
                &staff,
                &order.order_id,
                vec!["nope".into(); 3],
                "wrong",
            )
            .await;
            assert!(wrong.is_err());
            let done = collect_order(&db, &staff, &order.order_id, ids.clone(), "all")
                .await
                .unwrap();
            assert_eq!(done.status, "collected");
            // The same request key is idempotent; a different key cannot collect again.
            let again = collect_order(&db, &staff, &order.order_id, ids.clone(), "all")
                .await
                .unwrap();
            assert_eq!(again.status, "collected");
            assert!(collect_order(&db, &staff, &order.order_id, ids, "other")
                .await
                .is_err());
            assert!(collect_order(&db, &staff, "missing-order", vec![], "ghost")
                .await
                .is_err());
            cleanup(db, path).await;
        });
    }

    fn temp_folder(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "counter-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn only_admins_manage_backups_and_the_second_folder_is_validated() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            assert!(backup_settings(&db, &staff).await.is_err());
            assert!(set_backup_mirror(&db, &staff, None).await.is_err());
            assert!(backup_now(&db, &staff).await.is_err());

            let initial = backup_settings(&db, &admin).await.unwrap();
            assert!(initial.folder.ends_with("backups"));
            assert_eq!((initial.mirror_dir, initial.last_backup_at), (None, None));

            let mirror = temp_folder("mirror");
            let relative = set_backup_mirror(&db, &admin, Some("backups-here"))
                .await
                .unwrap_err();
            assert!(relative.contains("full path"), "{relative}");
            let missing = mirror.join("not-there");
            let absent = set_backup_mirror(&db, &admin, missing.to_str())
                .await
                .unwrap_err();
            assert!(absent.contains("does not exist"), "{absent}");
            let data_dir = path.parent().unwrap().to_path_buf();
            let inside = data_dir.join("inner");
            std::fs::create_dir_all(&inside).unwrap();
            for own in [data_dir.to_str().unwrap(), inside.to_str().unwrap()] {
                let refused = set_backup_mirror(&db, &admin, Some(own)).await.unwrap_err();
                assert!(refused.contains("outside"), "{refused}");
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let locked = temp_folder("locked");
                std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o500)).unwrap();
                let writable = std::fs::write(locked.join("probe"), b"x").is_ok();
                if !writable {
                    let refused = set_backup_mirror(&db, &admin, locked.to_str())
                        .await
                        .unwrap_err();
                    assert!(refused.contains("cannot be written"), "{refused}");
                }
                std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o700)).unwrap();
            }

            set_backup_mirror(&db, &admin, Some(&format!("  {}  ", mirror.display())))
                .await
                .unwrap();
            let done = backup_now(&db, &admin).await.unwrap();
            assert_eq!(done.mirror_dir.as_deref(), mirror.to_str());
            assert_eq!(done.mirror_status.as_deref(), Some("ok"));
            assert!(done.last_backup_at.is_some());
            let target = db.mirror_target(&mirror).await;
            assert!(
                target.is_dir(),
                "the per-computer folder is made when the folder is chosen"
            );
            let copies = std::fs::read_dir(&target)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().starts_with("laundry-"))
                .count();
            assert_eq!(
                copies, 1,
                "the backup went into this computer's own subfolder"
            );
            assert_eq!(
                std::fs::read_dir(&mirror)
                    .unwrap()
                    .filter_map(Result::ok)
                    .count(),
                1,
                "nothing else is written into the chosen folder"
            );

            set_backup_mirror(&db, &admin, Some("   ")).await.unwrap();
            let cleared = backup_now(&db, &admin).await.unwrap();
            assert_eq!((cleared.mirror_dir, cleared.mirror_status), (None, None));
            set_backup_mirror(&db, &admin, None).await.unwrap();
            cleanup(db, path).await;
            let _ = std::fs::remove_dir_all(mirror);
        });
    }

    #[test]
    fn backup_trouble_is_shown_at_sign_in_and_cleared_by_the_next_good_backup() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            assert_eq!(bootstrap(&db, &admin).await.unwrap().warning, None);
            db.record_backup_failure("The disk is full").await;
            let warning = bootstrap(&db, &admin).await.unwrap().warning.unwrap();
            assert!(
                warning.contains("The disk is full") && warning.contains("Admin > Backups"),
                "{warning}"
            );
            backup_now(&db, &admin).await.unwrap();
            assert_eq!(bootstrap(&db, &admin).await.unwrap().warning, None);
            assert_eq!(
                join_warnings(Some("a".into()), Some("b".into())).as_deref(),
                Some("a b")
            );
            assert_eq!(join_warnings(None, Some("b".into())).as_deref(), Some("b"));
            assert_eq!(join_warnings(Some("a".into()), None).as_deref(), Some("a"));
            assert_eq!(join_warnings(None, None), None);
            cleanup(db, path).await;
        });
    }

    #[test]
    fn staged_restore_blocks_changing_the_backup_folder() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            std::fs::write(
                crate::storage::pending_restore_path_for_tests(&path),
                b"staged",
            )
            .unwrap();
            let mirror = temp_folder("mirror-blocked");
            let refused = set_backup_mirror(&db, &admin, mirror.to_str())
                .await
                .unwrap_err();
            assert!(refused.contains("restore is staged"), "{refused}");
            cleanup(db, path).await;
            let _ = std::fs::remove_dir_all(mirror);
        });
    }

    async fn seed_admin_with_pin(db: &DatabaseState, pin: &str) -> CounterSession {
        let session = admin_fixture(db).await;
        let salt = "initial-salt";
        sqlx::query("UPDATE counter_accounts SET pin_hash=?,pin_salt=?,failed_attempts=5,locked_until='2999-01-01T00:00:00Z',active=0 WHERE id='fixture-admin'")
            .bind(hash_pin(pin, salt))
            .bind(salt)
            .execute(db.writer_pool().unwrap())
            .await
            .unwrap();
        session
    }

    #[test]
    fn a_reset_file_replaces_a_forgotten_admin_pin_once() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            assert_eq!(
                apply_admin_pin_reset_file(&db).await,
                None,
                "no file, nothing to do"
            );
            let _ = seed_admin_with_pin(&db, "1111").await;
            let file = path.parent().unwrap().join(ADMIN_PIN_RESET_FILE);
            std::fs::write(&file, "  2468 \n").unwrap();
            let notice = apply_admin_pin_reset_file(&db).await.unwrap();
            assert!(notice.contains("was reset"), "{notice}");
            assert!(!file.exists());
            assert_eq!(
                apply_admin_pin_reset_file(&db).await,
                None,
                "applied only once"
            );

            let session = CounterSession::default();
            assert!(login(&db, &session, "fixture-admin".into(), "1111".into())
                .await
                .is_err());
            let account = login(&db, &session, "fixture-admin".into(), "2468".into())
                .await
                .unwrap();
            assert_eq!((account.role.as_str(), account.active), ("admin", true));
            let audited: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM counter_audit WHERE action='admin_pin_reset_by_file'",
            )
            .fetch_one(db.writer_pool().unwrap())
            .await
            .unwrap();
            assert_eq!(audited, 1);
            cleanup(db, path).await;
        });
    }

    #[test]
    fn staff_get_an_unusable_legacy_credential_so_their_pin_is_never_stored_with_a_fast_hash() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            let created = create_staff(
                &db,
                &admin,
                AccountInput {
                    full_name: "Asha".into(),
                    pin: "5678".into(),
                },
            )
            .await
            .unwrap();
            let (hash, salt): (String, String) =
                sqlx::query_as("SELECT pin_hash,pin_salt FROM local_users WHERE id=?")
                    .bind(&created.id)
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            assert_ne!(hash, legacy_hash("5678", &salt));
            let (other_hash, _) = unusable_legacy_credential();
            assert_ne!(hash, other_hash, "every credential is random");
            update_staff(&db, &admin, &created.id, None, Some("9999"))
                .await
                .unwrap();
            let (after, _): (String, String) =
                sqlx::query_as("SELECT pin_hash,pin_salt FROM local_users WHERE id=?")
                    .bind(&created.id)
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            assert_eq!(
                after, hash,
                "a PIN reset never writes a PIN-derived hash to the legacy table"
            );
            let session = CounterSession::default();
            assert!(login(&db, &session, created.id.clone(), "9999".into())
                .await
                .is_ok());
            assert!(login(&db, &session, created.id, "5678".into())
                .await
                .is_err());
            cleanup(db, path).await;
        });
    }

    #[test]
    fn an_unusable_reset_file_is_deleted_with_the_reason_and_changes_nothing() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let dir = path.parent().unwrap().to_path_buf();
            let file = dir.join(ADMIN_PIN_RESET_FILE);

            // No administrator yet.
            std::fs::write(&file, "2468").unwrap();
            let none = apply_admin_pin_reset_file(&db).await.unwrap();
            assert!(none.contains("no administrator exists"), "{none}");
            assert!(!file.exists(), "no PIN is left on disk");

            let _ = seed_admin_with_pin(&db, "1111").await;
            for bad in ["12", "123456789", "12ab", ""] {
                std::fs::write(&file, bad).unwrap();
                let notice = apply_admin_pin_reset_file(&db).await.unwrap();
                assert!(
                    notice.contains("not reset")
                        && notice.contains("PIN must contain 4 to 8 digits"),
                    "{bad}: {notice}"
                );
                assert!(!file.exists(), "{bad}");
            }
            std::fs::write(&file, [0xFF, 0xFF, 0xFF]).unwrap();
            let binary = apply_admin_pin_reset_file(&db).await.unwrap();
            assert!(binary.contains("not valid text"), "{binary}");
            assert!(!file.exists());
            // A folder named like the file cannot be read.
            std::fs::create_dir(&file).unwrap();
            let unreadable = apply_admin_pin_reset_file(&db).await.unwrap();
            assert!(unreadable.contains("could not be read"), "{unreadable}");
            std::fs::remove_dir(&file).unwrap();

            let session = CounterSession::default();
            sqlx::query("UPDATE counter_accounts SET active=1,failed_attempts=0,locked_until=NULL WHERE id='fixture-admin'")
                .execute(db.writer_pool().unwrap()).await.unwrap();
            assert!(
                login(&db, &session, "fixture-admin".into(), "1111".into())
                    .await
                    .is_ok(),
                "no rejected file changed the PIN"
            );
            cleanup(db, path).await;
        });
    }

    #[test]
    fn reset_files_saved_by_windows_editors_are_understood() {
        let utf16le = |text: &str| {
            let mut bytes = vec![0xFF, 0xFE];
            for unit in text.encode_utf16() {
                bytes.extend(unit.to_le_bytes());
            }
            bytes
        };
        let utf16be = |text: &str| {
            let mut bytes = vec![0xFE, 0xFF];
            for unit in text.encode_utf16() {
                bytes.extend(unit.to_be_bytes());
            }
            bytes
        };
        assert_eq!(decode_text_file(b"2468\r\n").unwrap().trim(), "2468");
        assert_eq!(decode_text_file(b"\xEF\xBB\xBF2468").unwrap(), "2468");
        assert_eq!(
            decode_text_file(&utf16le("2468\r\n")).unwrap().trim(),
            "2468"
        );
        assert_eq!(decode_text_file(&utf16be("2468")).unwrap(), "2468");
        assert!(
            decode_text_file(&[0xFF, 0xFE, 0x32]).is_err(),
            "cut-off UTF-16"
        );
        assert!(
            decode_text_file(&[0xFF, 0xFE, 0x00, 0xD8]).is_err(),
            "lone surrogate"
        );
        assert!(decode_text_file(&[0xC3, 0x28]).is_err(), "invalid UTF-8");
    }

    #[test]
    fn a_pin_from_a_windows_encoded_file_is_applied() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let _ = seed_admin_with_pin(&db, "1111").await;
            let file = path.parent().unwrap().join(ADMIN_PIN_RESET_FILE);
            let mut bytes = vec![0xFF, 0xFE];
            for unit in "1357\r\n".encode_utf16() {
                bytes.extend(unit.to_le_bytes());
            }
            std::fs::write(&file, bytes).unwrap();
            let notice = apply_admin_pin_reset_file(&db).await.unwrap();
            assert!(notice.contains("was reset"), "{notice}");
            let session = CounterSession::default();
            assert!(login(&db, &session, "fixture-admin".into(), "1357".into())
                .await
                .is_ok());
            cleanup(db, path).await;
        });
    }

    #[test]
    fn a_staged_restore_stops_the_reset_but_never_leaves_the_pin_file_behind() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let _ = seed_admin_with_pin(&db, "1111").await;
            let file = path.parent().unwrap().join(ADMIN_PIN_RESET_FILE);
            std::fs::write(&file, "2468").unwrap();
            std::fs::write(
                crate::storage::pending_restore_path_for_tests(&path),
                b"staged",
            )
            .unwrap();
            let notice = apply_admin_pin_reset_file(&db).await.unwrap();
            assert!(
                notice.contains("not reset") && notice.contains("create it again"),
                "{notice}"
            );
            assert!(
                !file.exists(),
                "a stale file would re-apply an old PIN at a later start"
            );
            cleanup(db, path).await;
        });
    }

    #[test]
    fn phone_numbers_are_recognised_however_they_are_typed() {
        for typed in [
            "9876543210",
            " 98765 43210 ",
            "+91 98765-43210",
            "+919876543210",
            "09876543210",
            "(98765) 43210",
            "९८७६५४३२१०",
            "٩٨٧٦٥٤٣٢١٠",
            "９８７６５４３２１０",
            "98765\u{a0}43210",
        ] {
            assert_eq!(normalize_phone(typed).unwrap(), "9876543210", "{typed}");
        }
        for bad in [
            "",
            "   ",
            "12345",
            "98765432101",
            "98765abc10",
            "+1 415 555 0132 99",
            "9876543210x",
            "919876543210123",
        ] {
            assert!(normalize_phone(bad).is_err(), "{bad}");
        }
        assert_eq!(name_key("  Rita   JOSHI "), "rita joshi");
    }

    #[test]
    fn a_customer_is_found_by_phone_and_name_not_by_phone_alone() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            let named = |name: &str, phone: &str| {
                let mut order = order_input(1);
                order.customer.name = name.into();
                order.customer.phone = phone.into();
                order
            };
            let rahul = save_with(&db, &staff, named("Rahul Sharma", "98765 43210"), "rahul-1")
                .await
                .unwrap();
            let rahul_id: String = sqlx::query_scalar("SELECT customer_id FROM orders WHERE id=?")
                .bind(&rahul.order_id)
                .fetch_one(db.writer_pool().unwrap())
                .await
                .unwrap();
            let stored: String = sqlx::query_scalar("SELECT phone FROM customers WHERE id=?")
                .bind(&rahul_id)
                .fetch_one(db.writer_pool().unwrap())
                .await
                .unwrap();
            assert_eq!(stored, "9876543210", "stored in canonical form");
            set_discount(&db, &admin, Some(&rahul_id), 2000, true, "Rahul")
                .await
                .unwrap();

            // The same person typed another way is still Rahul and gets his discount.
            let again = quote(&db, &staff, &named("  rahul   sharma", "+91 9876543210"))
                .await
                .unwrap();
            assert_eq!(again.discount_percent_bp, 2000);
            // Someone else sharing the phone does NOT inherit it, and becomes a separate customer.
            let priya_quote = quote(&db, &staff, &named("Priya Sharma", "9876543210"))
                .await
                .unwrap();
            assert_eq!(priya_quote.discount_percent_bp, 0);
            let priya = save_with(&db, &staff, named("Priya Sharma", "9876543210"), "priya-1")
                .await
                .unwrap();
            let priya_id: String = sqlx::query_scalar("SELECT customer_id FROM orders WHERE id=?")
                .bind(&priya.order_id)
                .fetch_one(db.writer_pool().unwrap())
                .await
                .unwrap();
            assert_ne!(priya_id, rahul_id);
            let again_order =
                save_with(&db, &staff, named("Rahul Sharma", "9876543210"), "rahul-2")
                    .await
                    .unwrap();
            let again_id: String = sqlx::query_scalar("SELECT customer_id FROM orders WHERE id=?")
                .bind(&again_order.order_id)
                .fetch_one(db.writer_pool().unwrap())
                .await
                .unwrap();
            assert_eq!(
                again_id, rahul_id,
                "no duplicate customer for the same person"
            );
            assert_eq!(
                again_order.total_minor, 4000,
                "20% off the 50.00 wash price"
            );

            // Orders keep the canonical phone, and every spelling finds them.
            for query in [
                "9876543210",
                "98765 43210",
                "+91 98765 43210",
                "९८७६५४३२१०",
                "SL",
            ] {
                let found = search_orders(&db, &staff, query, 0, 50).await.unwrap();
                assert!(
                    found.len() >= 3 || query == "SL",
                    "{query}: {}",
                    found.len()
                );
            }
            let customers = search_customers(&db, &staff, "98765 4").await.unwrap();
            assert_eq!(customers.len(), 2, "Rahul and Priya");
            assert!(search_customers(&db, &staff, "9").await.unwrap().is_empty());

            // Bad numbers are refused with a clear message at quote and at save.
            for bad in ["12345", "abcdefghij", ""] {
                let refused = quote(&db, &staff, &named("Rita", bad)).await.unwrap_err();
                assert!(
                    refused.contains("10-digit") || refused.contains("only contain digits"),
                    "{bad}: {refused}"
                );
            }
            cleanup(db, path).await;
        });
    }

    #[test]
    fn order_search_lists_recent_orders_matches_literally_and_ignores_one_character() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let _admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            let first = save_with(&db, &staff, order_input(1), "s-1").await.unwrap();
            let second = save_with(&db, &staff, order_input(2), "s-2").await.unwrap();
            let recent = search_orders(&db, &staff, "", 0, 50).await.unwrap();
            assert_eq!(
                recent.iter().map(|o| o.id.as_str()).collect::<Vec<_>>(),
                vec![second.order_id.as_str(), first.order_id.as_str()]
            );
            assert_eq!(
                search_orders(&db, &staff, "  ", 0, 1).await.unwrap().len(),
                1,
                "paging applies"
            );
            assert!(search_orders(&db, &staff, "S", 0, 50)
                .await
                .unwrap()
                .is_empty());
            for wildcard in ["%%", "__", "\\"] {
                assert!(
                    search_orders(&db, &staff, wildcard, 0, 50)
                        .await
                        .unwrap()
                        .is_empty(),
                    "{wildcard} is literal"
                );
            }
            let by_number = search_orders(&db, &staff, &second.order_number, 0, 50)
                .await
                .unwrap();
            assert_eq!(by_number.len(), 1);
            assert!(search_orders(&db, &staff, "ab", 0, 0).await.is_err());
            cleanup(db, path).await;
        });
    }

    #[test]
    fn rates_are_capped_and_every_change_is_audited_with_old_and_new_values() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            let too_high = set_rate(&db, &admin, "g-shirt", "svc-wash", Some(1_000_001), true)
                .await
                .unwrap_err();
            assert!(too_high.contains("more than"), "{too_high}");
            set_rate(&db, &admin, "g-shirt", "svc-wash", Some(1_000_000), true)
                .await
                .unwrap();
            set_rate(&db, &admin, "g-shirt", "svc-wash", Some(1600), false)
                .await
                .unwrap();
            assert!(
                set_rate(&db, &admin, "g-nothing", "svc-wash", Some(1), true)
                    .await
                    .is_err()
            );
            let details: Vec<String> = sqlx::query_scalar("SELECT details_json FROM counter_audit WHERE action='rate_changed' ORDER BY created_at,rowid")
                .fetch_all(db.writer_pool().unwrap()).await.unwrap();
            assert_eq!(details.len(), 2);
            let last: serde_json::Value = serde_json::from_str(&details[1]).unwrap();
            assert_eq!(last["oldPriceMinor"], 1_000_000);
            assert_eq!(last["oldAvailable"], true);
            assert_eq!(last["newPriceMinor"], 1600);
            assert_eq!(last["newAvailable"], false);
            let first: serde_json::Value = serde_json::from_str(&details[0]).unwrap();
            assert_eq!(
                first["oldPriceMinor"], 5000,
                "the starter price is recorded as the old value"
            );

            set_discount(&db, &admin, None, 1000, true, "A")
                .await
                .unwrap();
            set_discount(&db, &admin, None, 1500, false, "B")
                .await
                .unwrap();
            let discounts: Vec<String> = sqlx::query_scalar("SELECT details_json FROM counter_audit WHERE action='discount_changed' ORDER BY rowid")
                .fetch_all(db.writer_pool().unwrap()).await.unwrap();
            let change: serde_json::Value = serde_json::from_str(&discounts[1]).unwrap();
            assert_eq!(
                (
                    change["oldPercentBp"].as_i64(),
                    change["newPercentBp"].as_i64()
                ),
                (Some(1000), Some(1500))
            );
            assert_eq!(
                (change["oldActive"].as_bool(), change["newActive"].as_bool()),
                (Some(true), Some(false))
            );
            let created: serde_json::Value = serde_json::from_str(&discounts[0]).unwrap();
            assert!(created["oldPercentBp"].is_null());
            cleanup(db, path).await;
        });
    }

    #[test]
    fn orders_are_limited_in_lines_pieces_and_total() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            let mut many_lines = order_input(1);
            many_lines.items = (0..=MAX_ORDER_LINES)
                .map(|_| LineInput {
                    garment_id: "g-shirt".into(),
                    service_id: "svc-wash".into(),
                    quantity: 1,
                })
                .collect();
            assert!(quote(&db, &staff, &many_lines)
                .await
                .unwrap_err()
                .contains("different lines"));
            let mut many_pieces = order_input(200);
            many_pieces.items.push(LineInput {
                garment_id: "g-shirt".into(),
                service_id: "svc-iron".into(),
                quantity: 200,
            });
            many_pieces.items.push(LineInput {
                garment_id: "g-shirt".into(),
                service_id: "svc-dry-clean".into(),
                quantity: 101,
            });
            assert!(quote(&db, &staff, &many_pieces)
                .await
                .unwrap_err()
                .contains("at most 500 pieces"));
            let mut exactly = order_input(200);
            exactly.items.push(LineInput {
                garment_id: "g-shirt".into(),
                service_id: "svc-iron".into(),
                quantity: 200,
            });
            exactly.items.push(LineInput {
                garment_id: "g-shirt".into(),
                service_id: "svc-dry-clean".into(),
                quantity: 100,
            });
            assert_eq!(quote(&db, &staff, &exactly).await.unwrap().piece_count, 500);
            set_rate(
                &db,
                &admin,
                "g-jacket",
                "svc-dry-clean",
                Some(1_000_000),
                true,
            )
            .await
            .unwrap();
            let mut huge = order_input(1);
            huge.items = (0..4)
                .map(|_| LineInput {
                    garment_id: "g-jacket".into(),
                    service_id: "svc-dry-clean".into(),
                    quantity: 100,
                })
                .collect();
            assert!(quote(&db, &staff, &huge)
                .await
                .unwrap_err()
                .contains("unusually large"));
            cleanup(db, path).await;
        });
    }

    #[test]
    fn reactivating_an_account_clears_its_lockout_and_the_message_says_how_long_to_wait() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            let created = create_staff(
                &db,
                &admin,
                AccountInput {
                    full_name: "Asha".into(),
                    pin: "5678".into(),
                },
            )
            .await
            .unwrap();
            let session = CounterSession::default();
            for _ in 0..5 {
                assert!(login(&db, &session, created.id.clone(), "0000".into())
                    .await
                    .is_err());
            }
            let locked = login(&db, &session, created.id.clone(), "5678".into())
                .await
                .unwrap_err();
            assert!(locked.contains("Wait 5 minutes"), "{locked}");
            update_staff(&db, &admin, &created.id, Some(false), None)
                .await
                .unwrap();
            assert!(login(&db, &session, created.id.clone(), "5678".into())
                .await
                .unwrap_err()
                .contains("inactive"));
            update_staff(&db, &admin, &created.id, Some(true), None)
                .await
                .unwrap();
            assert!(
                login(&db, &session, created.id.clone(), "5678".into())
                    .await
                    .is_ok(),
                "switching the account on again unlocks it"
            );
            cleanup(db, path).await;
        });
    }

    async fn set_profiles_rows(db: &DatabaseState) {
        for (kind, printer) in [("bill", "Canon"), ("tags", "TSC")] {
            sqlx::query("INSERT INTO printer_profiles(kind,printer_id,updated_at,updated_by) VALUES(?,?,CURRENT_TIMESTAMP,'fixture-admin')")
                .bind(kind).bind(printer).execute(db.writer_pool().unwrap()).await.unwrap();
        }
    }

    async fn job_state(db: &DatabaseState, id: &str) -> (String, Option<String>) {
        sqlx::query_as("SELECT state,last_error FROM print_jobs WHERE id=?")
            .bind(id)
            .fetch_one(db.writer_pool().unwrap())
            .await
            .unwrap()
    }

    #[test]
    fn retrying_checks_and_changes_the_state_atomically() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let _admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            set_profiles_rows(&db).await;
            let order = save_with(&db, &staff, order_input(1), "retry-order")
                .await
                .unwrap();
            let job_id = order.print_jobs[0].id.clone();
            for state in ["pending", "submitting", "submitted"] {
                sqlx::query("UPDATE print_jobs SET state=? WHERE id=?")
                    .bind(state)
                    .bind(&job_id)
                    .execute(db.writer_pool().unwrap())
                    .await
                    .unwrap();
                let refused = retry_job(&db, &staff, &job_id, true).await.unwrap_err();
                assert!(refused.contains("Only failed"), "{state}: {refused}");
                assert_eq!(
                    job_state(&db, &job_id).await.0,
                    state,
                    "a refused retry changes nothing"
                );
            }
            sqlx::query("UPDATE print_jobs SET state='uncertain' WHERE id=?")
                .bind(&job_id)
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            assert!(retry_job(&db, &staff, &job_id, false)
                .await
                .unwrap_err()
                .contains("explicitly confirm"));
            assert_eq!(job_state(&db, &job_id).await.0, "uncertain");
            assert!(retry_job(&db, &staff, "no-such-job", false)
                .await
                .unwrap_err()
                .contains("not found"));
            // Confirmed: the job goes back to the queue once and is dispatched (macOS has no printing
            // adapter, so it fails again, which is exactly the safe outcome).
            let retried = retry_job(&db, &staff, &job_id, true).await.unwrap();
            assert_eq!(retried.state, "failed");
            let attempts: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM print_job_attempts WHERE print_job_id=?")
                    .bind(&job_id)
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            assert_eq!(attempts, 1);
            cleanup(db, path).await;
        });
    }

    #[test]
    fn an_unreadable_saved_document_fails_visibly_instead_of_sticking() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let _admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            set_profiles_rows(&db).await;
            let order = save_with(&db, &staff, order_input(1), "broken-doc")
                .await
                .unwrap();
            let job_id = order.print_jobs[0].id.clone();
            sqlx::query("UPDATE print_jobs SET payload_json='{not json' WHERE id=?")
                .bind(&job_id)
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            let job = dispatch_job(&db, &staff, &job_id).await.unwrap();
            assert_eq!(job.state, "failed");
            let (state, error) = job_state(&db, &job_id).await;
            assert_eq!(state, "failed");
            assert!(error.unwrap().contains("unreadable"));
            let attempts: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM print_job_attempts WHERE print_job_id=?")
                    .bind(&job_id)
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            assert_eq!(attempts, 0, "nothing was sent to a printer");
            cleanup(db, path).await;
        });
    }

    #[test]
    fn the_same_printer_cannot_be_chosen_for_bills_and_tags() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            let refused = set_profiles(
                &db,
                &admin,
                ProfilesInput {
                    bill_printer_id: "One".into(),
                    tag_printer_id: "One".into(),
                },
            )
            .await
            .unwrap_err();
            assert!(refused.contains("different printers"), "{refused}");
            cleanup(db, path).await;
        });
    }

    #[test]
    fn the_print_queue_lists_unresolved_jobs_before_finished_ones() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let _admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            let old = save_with(&db, &staff, order_input(1), "q-old")
                .await
                .unwrap();
            let newer = save_with(&db, &staff, order_input(2), "q-new")
                .await
                .unwrap();
            sqlx::query("UPDATE print_jobs SET state='submitted' WHERE order_id=?")
                .bind(&newer.order_id)
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            sqlx::query("UPDATE print_jobs SET state='uncertain' WHERE order_id=? AND kind='tags'")
                .bind(&old.order_id)
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            let queue = list_jobs(&db, &staff, None).await.unwrap();
            let states: Vec<&str> = queue.iter().map(|j| j.state.as_str()).collect();
            let first_done = states.iter().position(|s| *s == "submitted").unwrap();
            assert!(
                states[..first_done]
                    .iter()
                    .all(|s| matches!(*s, "pending" | "uncertain")),
                "{states:?}"
            );
            cleanup(db, path).await;
        });
    }

    #[test]
    fn an_admin_can_cancel_an_uncollected_order_and_the_money_to_return_is_recorded() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            let order = save_with(&db, &staff, order_input(2), "to-cancel")
                .await
                .unwrap();
            assert!(cancel_order(&db, &staff, &order.order_id, "wrong garment")
                .await
                .unwrap_err()
                .contains("Administrator"));
            assert!(cancel_order(&db, &admin, &order.order_id, "x")
                .await
                .unwrap_err()
                .contains("reason"));
            assert!(cancel_order(&db, &admin, "missing", "entered twice")
                .await
                .unwrap_err()
                .contains("not found"));
            let cancelled = cancel_order(&db, &admin, &order.order_id, "  entered twice  ")
                .await
                .unwrap();
            assert_eq!(
                (cancelled.status.as_str(), cancelled.paid_minor),
                ("cancelled", 0)
            );
            let voided: (i64, Option<String>) = sqlx::query_as("SELECT COUNT(*),MAX(void_reason) FROM payments WHERE order_id=? AND voided_at IS NOT NULL")
                .bind(&order.order_id).fetch_one(db.writer_pool().unwrap()).await.unwrap();
            assert_eq!(voided, (1, Some("entered twice".into())));
            let queued: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM print_jobs WHERE order_id=? AND state='pending'",
            )
            .bind(&order.order_id)
            .fetch_one(db.writer_pool().unwrap())
            .await
            .unwrap();
            assert_eq!(
                queued, 0,
                "unprinted output of a cancelled order is dropped"
            );
            let audit_row: String = sqlx::query_scalar(
                "SELECT details_json FROM counter_audit WHERE action='order_cancelled'",
            )
            .fetch_one(db.writer_pool().unwrap())
            .await
            .unwrap();
            let details: serde_json::Value = serde_json::from_str(&audit_row).unwrap();
            assert_eq!(details["refundMinor"], 10000);
            assert_eq!(details["reason"], "entered twice");
            assert!(cancel_order(&db, &admin, &order.order_id, "again")
                .await
                .unwrap_err()
                .contains("already cancelled"));
            assert!(record_payment(
                &db,
                &admin,
                &order.order_id,
                RecordPaymentInput {
                    amount_minor: 100,
                    method: "cash".into(),
                    reference: None,
                    idempotency_key: "k".into()
                }
            )
            .await
            .is_err());
            assert!(update_order_status(&db, &admin, &order.order_id, "ready")
                .await
                .is_err());
            assert!(collect_order(&db, &admin, &order.order_id, vec![], "c")
                .await
                .is_err());
            // A collected order cannot be cancelled.
            let collected = save_with(&db, &staff, order_input(1), "to-collect")
                .await
                .unwrap();
            update_order_status(&db, &staff, &collected.order_id, "ready")
                .await
                .unwrap();
            let ids: Vec<String> = collected.pieces.iter().map(|p| p.id.clone()).collect();
            collect_order(&db, &staff, &collected.order_id, ids, "c2")
                .await
                .unwrap();
            assert!(cancel_order(&db, &admin, &collected.order_id, "too late")
                .await
                .unwrap_err()
                .contains("collected"));
            cleanup(db, path).await;
        });
    }

    #[test]
    fn a_duplicate_collection_request_reports_the_earlier_success() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let _admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            let order = save_with(&db, &staff, order_input(1), "dup-collect")
                .await
                .unwrap();
            let other = save_with(&db, &staff, order_input(1), "dup-collect-2")
                .await
                .unwrap();
            update_order_status(&db, &staff, &order.order_id, "ready")
                .await
                .unwrap();
            let ids: Vec<String> = order.pieces.iter().map(|p| p.id.clone()).collect();
            collect_order(&db, &staff, &order.order_id, ids.clone(), "same-key")
                .await
                .unwrap();
            // A request that raced past the early check lands on the in-transaction check.
            sqlx::query("UPDATE orders SET status='ready' WHERE id=?")
                .bind(&order.order_id)
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            let again = collect_order(&db, &staff, &order.order_id, ids, "same-key")
                .await
                .unwrap();
            assert_eq!(again.order_id, order.order_id);
            assert!(
                collect_order(&db, &staff, &other.order_id, vec![], "same-key")
                    .await
                    .unwrap_err()
                    .contains("another order")
            );
            cleanup(db, path).await;
        });
    }

    #[test]
    fn saving_is_refused_if_a_garment_or_service_was_switched_off_after_the_quote() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let _admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            let reviewed = quote(&db, &staff, &order_input(1)).await.unwrap();
            sqlx::query("UPDATE garments SET active=0 WHERE id='g-shirt'")
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            let input = SaveInput {
                order: order_input(1),
                reviewed_quote: reviewed.clone(),
                idempotency_key: "inactive".into(),
                payment: pay(reviewed.total_minor),
            };
            let refused = save_order(&db, &staff, input).await.unwrap_err();
            assert!(
                refused.contains("unavailable") || refused.contains("changed"),
                "{refused}"
            );
            cleanup(db, path).await;
        });
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
    fn older_admin_writes_recheck_the_database_inside_their_transaction() {
        tauri::async_runtime::block_on(async {
            let db = DatabaseState::open(fixture_path()).await;
            let admin = admin_fixture(&db).await;
            // The session still says admin, but the database no longer has an active admin.
            sqlx::query("UPDATE counter_accounts SET active=0 WHERE id='fixture-admin'")
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            let gone = |e: String| assert!(e.contains("no longer valid"), "{e}");
            gone(
                set_rate(&db, &admin, "g-shirt", "svc-wash", Some(100), true)
                    .await
                    .unwrap_err(),
            );
            gone(
                set_discount(&db, &admin, None, 500, true, "x")
                    .await
                    .unwrap_err(),
            );
            gone(set_backup_mirror(&db, &admin, None).await.unwrap_err());
            gone(
                cancel_order(&db, &admin, "missing", "duplicate")
                    .await
                    .unwrap_err(),
            );
            gone(
                create_staff(
                    &db,
                    &admin,
                    AccountInput {
                        full_name: "New Staff".into(),
                        pin: "482913".into(),
                    },
                )
                .await
                .unwrap_err(),
            );
            gone(
                update_staff(&db, &admin, "fixture-staff", Some(false), None)
                    .await
                    .unwrap_err(),
            );
        });
    }

    #[test]
    fn admin_in_tx_checks_session_role_and_database_state() {
        tauri::async_runtime::block_on(async {
            let db = DatabaseState::open(fixture_path()).await;
            let admin = admin_fixture(&db).await;
            let forged = CounterSession::default();
            forged
                .set(SessionActor {
                    id: "fixture-staff".into(),
                    role: "admin".into(),
                })
                .unwrap();
            let staff = CounterSession::default();
            staff
                .set(SessionActor {
                    id: "fixture-staff".into(),
                    role: "staff".into(),
                })
                .unwrap();
            let signed_out = CounterSession::default();

            let mut tx = db.begin_counter_write().await.unwrap();
            assert_eq!(
                require_admin_in_tx(&mut tx, &admin, "test")
                    .await
                    .unwrap()
                    .id,
                "fixture-admin"
            );
            assert!(require_admin_in_tx(&mut tx, &staff, "test").await.is_err());
            assert!(require_admin_in_tx(&mut tx, &signed_out, "test")
                .await
                .is_err());
            assert!(
                require_admin_in_tx(&mut tx, &forged, "test")
                    .await
                    .unwrap_err()
                    .contains("no longer valid"),
                "database role, not session text, authorizes admin writes"
            );
            sqlx::query("UPDATE counter_accounts SET active=0 WHERE id='fixture-admin'")
                .execute(&mut *tx)
                .await
                .unwrap();
            assert!(require_admin_in_tx(&mut tx, &admin, "test").await.is_err());
            tx.rollback().await.unwrap();
            assert_eq!(require_actor(&staff).unwrap().role, "staff");
            assert!(require_admin(&staff, "test").is_err());
            assert!(require_admin(&admin, "test").is_ok());
        });
    }

    async fn backup_source(label: &str) -> (DatabaseState, PathBuf) {
        let path = fixture_path();
        let db = DatabaseState::open(path.clone()).await;
        assert_eq!(db.info().error, None, "{label}");
        (db, path)
    }

    #[test]
    fn restore_is_admin_only_checked_against_the_database_and_never_stages_for_others() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            let staff = staff_fixture(&db).await;
            let (_source_db, source_path) = backup_source("source").await;
            let source = source_path.to_string_lossy().into_owned();
            let signed_out = CounterSession::default();
            let forged = CounterSession::default();
            forged
                .set(SessionActor {
                    id: "fixture-staff".into(),
                    role: "admin".into(),
                })
                .unwrap();

            for session in [&staff, &signed_out] {
                assert!(restore_backup(&db, session, source.clone()).await.is_err());
            }
            assert!(
                restore_backup(&db, &forged, source.clone())
                    .await
                    .unwrap_err()
                    .contains("no longer valid"),
                "database role, not session text, authorizes a restore"
            );
            assert!(restore_backup(&db, &admin, "   ".into())
                .await
                .unwrap_err()
                .contains("Choose a backup file"));
            assert!(
                !db.info().restore_pending,
                "a refused restore stages nothing"
            );
            assert!(!bootstrap(&db, &admin).await.unwrap().restore_pending);
            let staged_files: Vec<_> = std::fs::read_dir(path.parent().unwrap())
                .unwrap()
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().contains("restore"))
                .collect();
            assert!(staged_files.is_empty(), "no staged file after refusals");
            let audited: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM counter_audit WHERE action='restore_requested'",
            )
            .fetch_one(db.writer_pool().unwrap())
            .await
            .unwrap();
            assert_eq!(audited, 0, "refused restores are not recorded as requests");

            sqlx::query("UPDATE counter_accounts SET active=0 WHERE id='fixture-admin'")
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            assert!(
                restore_backup(&db, &admin, source.clone())
                    .await
                    .unwrap_err()
                    .contains("no longer valid"),
                "a deactivated administrator cannot restore with a session that is still open"
            );
            assert!(!db.info().restore_pending);
            cleanup(db, path).await;
            let _ = std::fs::remove_dir_all(source_path.parent().unwrap());
        });
    }

    #[test]
    fn an_admin_restore_is_audited_keeps_a_safety_backup_and_blocks_writes_until_restart() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            let admin = admin_fixture(&db).await;
            let (_source_db, source_path) = backup_source("source").await;
            let source = source_path.to_string_lossy().into_owned();
            let safety_before = std::fs::read_dir(db.backup_folder().unwrap())
                .map(|entries| entries.count())
                .unwrap_or(0);

            let message = restore_backup(&db, &admin, format!("  {source}  "))
                .await
                .unwrap();
            assert!(message.contains("Restore staged"), "{message}");
            assert!(db.info().restore_pending);
            let booted = bootstrap(&db, &admin).await.unwrap();
            assert!(booted.restore_pending, "the app is told a restore waits");

            let safety_after = std::fs::read_dir(db.backup_folder().unwrap())
                .unwrap()
                .count();
            assert_eq!(
                safety_after,
                safety_before + 1,
                "a safety backup is taken first"
            );
            let details: String = sqlx::query_scalar(
                "SELECT details_json FROM counter_audit WHERE action='restore_requested' AND actor_id='fixture-admin'",
            )
            .fetch_one(db.writer_pool().unwrap())
            .await
            .unwrap();
            assert!(details.contains(&source.replace('\\', "\\\\")), "{details}");

            let blocked = set_rate(&db, &admin, "g-shirt", "svc-wash", Some(300), true)
                .await
                .unwrap_err();
            assert!(blocked.contains("restore is staged"), "{blocked}");
            let again = restore_backup(&db, &admin, source).await.unwrap_err();
            assert!(again.contains("already staged"), "{again}");
            cleanup(db, path).await;
            let _ = std::fs::remove_dir_all(source_path.parent().unwrap());
        });
    }

    #[test]
    fn an_unreadable_or_unopenable_database_refuses_restore_with_its_own_error() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            std::fs::write(&path, b"this is not a database").unwrap();
            let broken = DatabaseState::open(path.clone()).await;
            let startup_error = broken.info().error.expect("a damaged file fails to open");
            let session = CounterSession::default();
            session
                .set(SessionActor {
                    id: "boss".into(),
                    role: "admin".into(),
                })
                .unwrap();
            let refused = restore_backup(&broken, &session, "backup.db".into())
                .await
                .unwrap_err();
            assert_eq!(refused, startup_error);
            let booted = bootstrap(&broken, &session).await;
            assert_eq!(
                booted.err().as_deref(),
                Some(startup_error.as_str()),
                "bootstrap reports why the database could not be opened"
            );
            let unavailable = DatabaseState::unavailable("no folder");
            assert_eq!(
                restore_backup(&unavailable, &session, "backup.db".into())
                    .await
                    .unwrap_err(),
                "no folder"
            );
            assert_eq!(
                bootstrap(&unavailable, &session).await.err().as_deref(),
                Some("no folder")
            );
            cleanup(broken, path).await;
        });
    }

    #[test]
    fn like_contains_matches_operator_wildcards_literally() {
        assert_eq!(like_contains("50%_off\\"), "%50\\%\\_off\\\\%");
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
            assert!(restore_backup(&db, &staff, "backup.db".into())
                .await
                .unwrap_err()
                .contains("Administrator access"));
            // The starter rate card is preloaded; an admin clearing a rate makes it unsellable.
            set_rate(&db, &admin, "g-shirt", "svc-wash", None, true)
                .await
                .unwrap();
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

            let reviewed_quote = quote(&db, &admin, &order_input(2)).await.unwrap();
            let save = |key: &str| SaveInput {
                order: order_input(2),
                reviewed_quote: reviewed_quote.clone(),
                idempotency_key: key.into(),
                payment: Some(PaymentInput {
                    amount_minor: 550,
                    method: "cash".into(),
                    reference: None,
                }),
            };
            let mut invalid = save("bad-payment");
            invalid.payment.as_mut().unwrap().amount_minor = 0;
            assert!(save_order(&db, &admin, invalid).await.is_err());
            let mut partial = save("partial-payment");
            partial.payment.as_mut().unwrap().amount_minor = 100;
            assert!(save_order(&db, &admin, partial)
                .await
                .unwrap_err()
                .contains("full order amount"));
            let mut unpaid = save("no-payment");
            unpaid.payment = None;
            assert!(save_order(&db, &admin, unpaid)
                .await
                .unwrap_err()
                .contains("Payment in full"));
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
            assert_eq!((first.paid_minor, first.balance_minor), (550, 0));
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
                "packing",
                vec![ids[0].clone(), ids[0].clone(), "wrong-order-piece".into()],
            )
            .await
            .unwrap();
            assert!(!bad.complete);
            assert_eq!(bad.duplicate_ids.len(), 1);
            assert_eq!(bad.wrong_order_ids.len(), 1);
            let complete = match_pieces(&db, &admin, &first.order_id, "packing", ids)
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
                vec![first.pieces[0].short_id.clone()],
                "reprint-1",
            )
            .await
            .unwrap();
            assert_eq!(reprint.id, same.id);
            assert!(
                reprint_output(
                    &db,
                    &admin,
                    &first.order_id,
                    "tags",
                    vec![first.pieces[1].short_id.clone()],
                    "reprint-1",
                )
                .await
                .is_err(),
                "a reprint key cannot silently select a different subset"
            );
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

    #[test]
    fn reviewed_quotes_payments_collection_and_partial_tag_positions_are_durable() {
        tauri::async_runtime::block_on(async {
            let path = fixture_path();
            let db = DatabaseState::open(path.clone()).await;
            assert_eq!(db.info().error, None);
            let admin = admin_fixture(&db).await;
            set_rate(&db, &admin, "g-shirt", "svc-wash", Some(275), true)
                .await
                .unwrap();

            let input = order_input(4);
            let reviewed = quote(&db, &admin, &input).await.unwrap();
            let save = |key: &str| SaveInput {
                order: input.clone(),
                idempotency_key: key.into(),
                payment: Some(PaymentInput {
                    amount_minor: 1100,
                    method: "cash".into(),
                    reference: None,
                }),
                reviewed_quote: reviewed.clone(),
            };
            let order = save_order(&db, &admin, save("reviewed-4-piece"))
                .await
                .unwrap();
            // Simulate an order carried over from the old app that still has a balance.
            sqlx::query("DELETE FROM payments WHERE order_id=?")
                .bind(&order.order_id)
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            assert_eq!(order.pieces.len(), 4);
            assert_eq!(
                order.pieces.iter().map(|p| p.position).collect::<Vec<_>>(),
                vec![1, 2, 3, 4]
            );
            set_rate(&db, &admin, "g-shirt", "svc-wash", Some(300), true)
                .await
                .unwrap();
            let retry = save_order(&db, &admin, save("reviewed-4-piece"))
                .await
                .unwrap();
            assert_eq!(
                retry.order_id, order.order_id,
                "same-key exact retries survive later rate changes"
            );
            let mut changed = save("reviewed-4-piece");
            changed.order.items[0].quantity = 3;
            assert!(save_order(&db, &admin, changed).await.is_err());
            assert!(save_order(&db, &admin, save("new-key-stale-quote"))
                .await
                .is_err());

            let payment = RecordPaymentInput {
                amount_minor: 400,
                method: "upi".into(),
                reference: Some("fixture-ref".into()),
                idempotency_key: "payment-once".into(),
            };
            assert!(
                record_payment(
                    &db,
                    &admin,
                    &order.order_id,
                    RecordPaymentInput {
                        amount_minor: 1101,
                        ..payment.clone()
                    }
                )
                .await
                .is_err(),
                "overpayment is rejected"
            );
            let paid = record_payment(&db, &admin, &order.order_id, payment.clone())
                .await
                .unwrap();
            assert_eq!(paid.paid_minor, 400);
            let paid_retry = record_payment(&db, &admin, &order.order_id, payment.clone())
                .await
                .unwrap();
            assert_eq!(
                paid_retry.paid_minor, 400,
                "same payment key cannot double count"
            );
            assert!(
                record_payment(
                    &db,
                    &admin,
                    &order.order_id,
                    RecordPaymentInput {
                        amount_minor: 500,
                        ..payment
                    }
                )
                .await
                .is_err(),
                "payment keys are payload-bound"
            );

            let all_ids = order
                .pieces
                .iter()
                .map(|p| p.id.clone())
                .collect::<Vec<_>>();
            let packing = match_pieces(&db, &admin, &order.order_id, "packing", all_ids.clone())
                .await
                .unwrap();
            assert!(packing.complete);
            update_order_status(&db, &admin, &order.order_id, "ready")
                .await
                .unwrap();
            let unpaid_collect = collect_order(
                &db,
                &admin,
                &order.order_id,
                all_ids.clone(),
                "collect-with-balance",
            )
            .await
            .unwrap_err();
            assert!(unpaid_collect.contains("still has"), "{unpaid_collect}");
            let settled = record_payment(
                &db,
                &admin,
                &order.order_id,
                RecordPaymentInput {
                    amount_minor: 700,
                    method: "cash".into(),
                    reference: None,
                    idempotency_key: "payment-rest".into(),
                },
            )
            .await
            .unwrap();
            assert_eq!(settled.balance_minor, 0);
            assert!(collect_order(
                &db,
                &admin,
                &order.order_id,
                all_ids[..3].to_vec(),
                "collect-incomplete"
            )
            .await
            .is_err());
            let collected = collect_order(
                &db,
                &admin,
                &order.order_id,
                all_ids.clone(),
                "collect-once",
            )
            .await
            .unwrap();
            assert_eq!(collected.status, "collected");
            assert!(collected
                .pieces
                .iter()
                .all(|piece| piece.packing_matched && piece.collection_matched));

            let selected = reprint_output(
                &db,
                &admin,
                &order.order_id,
                "tags",
                vec![order.pieces[2].short_id.clone()],
                "tag-3-of-4",
            )
            .await
            .unwrap();
            let selected_payload: String =
                sqlx::query_scalar("SELECT payload_json FROM print_jobs WHERE id=?")
                    .bind(&selected.id)
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            let crate::printing::PrintDocument::Tags(doc) =
                serde_json::from_str(&selected_payload).unwrap()
            else {
                panic!("tags expected")
            };
            assert_eq!(
                doc.pieces
                    .iter()
                    .map(|p| (p.position, p.total))
                    .collect::<Vec<_>>(),
                vec![(3, 4)]
            );

            let pair = reprint_output(
                &db,
                &admin,
                &order.order_id,
                "tags",
                vec![
                    order.pieces[0].short_id.clone(),
                    order.pieces[3].short_id.clone(),
                ],
                "tag-1-and-4-of-4",
            )
            .await
            .unwrap();
            let pair_payload: String =
                sqlx::query_scalar("SELECT payload_json FROM print_jobs WHERE id=?")
                    .bind(&pair.id)
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            let crate::printing::PrintDocument::Tags(doc) =
                serde_json::from_str(&pair_payload).unwrap()
            else {
                panic!("tags expected")
            };
            assert_eq!(
                doc.pieces
                    .iter()
                    .map(|p| (p.position, p.total))
                    .collect::<Vec<_>>(),
                vec![(1, 4), (4, 4)]
            );
            sqlx::query("UPDATE counter_accounts SET pin_hash=?,pin_salt='restart-test-salt' WHERE id='fixture-admin'")
                .bind(hash_pin("4321", "restart-test-salt"))
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            drop(db);
            let reopened = DatabaseState::open(path.clone()).await;
            let reopened_session = CounterSession::default();
            login(
                &reopened,
                &reopened_session,
                "fixture-admin".into(),
                "4321".into(),
            )
            .await
            .unwrap();
            let persisted = get_order(&reopened, &reopened_session, &order.order_id)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(persisted.status, "collected");
            assert_eq!(persisted.paid_minor, 1100);
            assert!(persisted
                .pieces
                .iter()
                .all(|piece| piece.collection_matched));
            let queue = list_jobs(&reopened, &reopened_session, None).await.unwrap();
            assert!(queue.iter().any(|job| {
                job.order_id == order.order_id && job.order_number == order.order_number
            }));
            assert!(
                search_orders(&reopened, &reopened_session, &order.order_number, 0, 10)
                    .await
                    .unwrap()
                    .iter()
                    .any(|summary| summary.id == order.order_id)
            );
            drop(reopened);
            let _ = std::fs::remove_dir_all(path.parent().unwrap());
        });
    }
}
