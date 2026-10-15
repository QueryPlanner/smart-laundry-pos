//! Back-office records for the counter workspace: customers, expenses, inventory and machines.
//!
//! Every command checks the session actor itself. Staff and administrators may read and create or
//! edit records; only an administrator may delete, and every delete needs a reason, keeps the old
//! values in `counter_audit` and runs as one transaction. Money is whole paise at the API edge and
//! rupees (REAL) in the legacy tables, converted in exactly one place per table.

use chrono::{Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;
use uuid::Uuid;

use crate::counter::{
    audit_details, db_err, like_contains, name_key, normalize_phone, require_actor,
    require_admin_in_tx, CounterSession, OrderSummary,
};
use crate::storage::DatabaseState;

type Tx<'a> = sqlx::Transaction<'a, sqlx::Sqlite>;

const MAX_AMOUNT_MINOR: i64 = 100_000_000;
const MAX_QUANTITY: f64 = 1_000_000.0;
const MAX_PAGE: u32 = 200;
const MAX_EXPENSE_PAGE: u32 = 500;
const RECENT_ORDERS: i64 = 10;
const EARLIEST_DATE: (i32, u32, u32) = (2000, 1, 1);
const LATEST_DATE: (i32, u32, u32) = (2100, 12, 31);
const CUSTOMER_TYPES: [&str; 4] = ["regular", "student", "hostel", "other"];
const EXPENSE_METHODS: [&str; 5] = ["cash", "upi", "card", "bank_transfer", "other"];
const STOCK_TYPES: [&str; 3] = ["stock_in", "stock_out", "adjustment"];

// ---------------------------------------------------------------- shared helpers

fn shop_today() -> NaiveDate {
    (Utc::now() + Duration::minutes(330)).date_naive()
}

fn ymd(parts: (i32, u32, u32)) -> NaiveDate {
    NaiveDate::from_ymd_opt(parts.0, parts.1, parts.2).expect("a fixed valid calendar date")
}

fn text_ok(value: &str) -> bool {
    value.chars().all(|c| !c.is_control() || c == '\n')
}

fn required_text(value: &str, label: &str, max: usize) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is required."));
    }
    if trimmed.chars().count() > max {
        return Err(format!("{label} must be {max} characters or fewer."));
    }
    if !text_ok(trimmed) {
        return Err(format!("{label} contains characters that are not allowed."));
    }
    Ok(trimmed.to_string())
}

fn optional_text(value: Option<&str>, label: &str, max: usize) -> Result<Option<String>, String> {
    match value.map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) => required_text(text, label, max).map(Some),
    }
}

fn parse_date(value: &str, label: &str) -> Result<NaiveDate, String> {
    let trimmed = value.trim();
    let date = if trimmed.len() == 10 {
        NaiveDate::parse_from_str(trimmed, "%Y-%m-%d").ok()
    } else {
        None
    };
    let date = date.ok_or_else(|| format!("{label} must be a date like 2026-01-31."))?;
    if date < ymd(EARLIEST_DATE) || date > ymd(LATEST_DATE) {
        return Err(format!("{label} is outside the supported range."));
    }
    Ok(date)
}

fn optional_date(value: Option<&str>, label: &str) -> Result<Option<NaiveDate>, String> {
    match value.map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) => parse_date(text, label).map(Some),
    }
}

fn date_text(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

fn valid_reason(reason: &str) -> Result<String, String> {
    let trimmed = reason.trim();
    if !(3..=200).contains(&trimmed.chars().count()) || !text_ok(trimmed) {
        return Err("Give a reason of 3 to 200 characters.".into());
    }
    Ok(trimmed.to_string())
}

fn page(offset: u32, limit: u32, max_limit: u32) -> Result<(i64, i64), String> {
    if offset > 100_000 || !(1..=max_limit).contains(&limit) {
        return Err("The requested page is out of range.".into());
    }
    Ok((i64::from(offset), i64::from(limit)))
}

fn minor_to_rupees(minor: i64) -> f64 {
    minor as f64 / 100.0
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn quantity_ok(value: f64, label: &str, allow_negative: bool) -> Result<f64, String> {
    if !value.is_finite() || value.abs() > MAX_QUANTITY || (!allow_negative && value < 0.0) {
        return Err(format!(
            "{label} must be a number between {} and 1,000,000.",
            if allow_negative { "-1,000,000" } else { "0" }
        ));
    }
    Ok(round3(value))
}

/// The signed-in account, verified against the database INSIDE the write transaction: still
/// active, still the role the session claims, and mirrored in `local_users` (the legacy tables'
/// created_by / recorded_by foreign keys point there). A forged or stale session is refused here
/// instead of surfacing as a raw foreign-key error.
async fn require_active_in_tx(
    tx: &mut Tx<'_>,
    session: &CounterSession,
) -> Result<crate::counter::SessionActor, String> {
    let actor = require_actor(session)?;
    let live: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM counter_accounts a JOIN local_users u ON u.id=a.id WHERE a.id=? AND a.role=? AND a.active=1",
    )
    .bind(&actor.id)
    .bind(&actor.role)
    .fetch_one(&mut **tx)
    .await
    .map_err(db_err)?;
    if live != 1 {
        return Err("This account is no longer active. Sign in again.".into());
    }
    Ok(actor)
}

async fn device_id(tx: &mut Tx<'_>) -> Result<String, String> {
    Ok(
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key='device_id'")
            .fetch_optional(&mut **tx)
            .await
            .map_err(db_err)?
            .unwrap_or_else(|| "counter".to_string()),
    )
}

// ---------------------------------------------------------------- customers

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerFields {
    pub name: String,
    pub phone: String,
    pub alternate_phone: Option<String>,
    pub address: Option<String>,
    pub customer_type: Option<String>,
    pub notes: Option<String>,
}

struct ValidCustomer {
    name: String,
    phone: String,
    raw_phone: String,
    alternate_phone: Option<String>,
    address: Option<String>,
    customer_type: String,
    notes: Option<String>,
}

fn validate_customer(input: &CustomerFields) -> Result<ValidCustomer, String> {
    let name = required_text(&input.name, "Customer name", 100)?
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let phone = normalize_phone(&input.phone)?;
    let alternate_phone = match input.alternate_phone.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(raw) => Some(normalize_phone(raw)?),
    };
    let customer_type = input
        .customer_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("regular")
        .to_string();
    if !CUSTOMER_TYPES.contains(&customer_type.as_str()) {
        return Err("Choose a valid customer type.".into());
    }
    Ok(ValidCustomer {
        name,
        phone,
        raw_phone: input.phone.trim().to_string(),
        alternate_phone,
        address: optional_text(input.address.as_deref(), "Address", 300)?,
        customer_type,
        notes: optional_text(input.notes.as_deref(), "Notes", 500)?,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerRow {
    pub id: String,
    pub customer_code: String,
    pub name: String,
    pub phone: String,
    pub alternate_phone: Option<String>,
    pub address: Option<String>,
    pub customer_type: String,
    pub notes: Option<String>,
    pub created_at: String,
    /// Every order for this customer, cancelled ones included.
    pub order_count: i64,
    /// Total billed in paise; cancelled orders are not billed.
    pub billed_minor: i64,
    pub last_order_at: Option<String>,
    /// True when the owner has set an automatic discount for this customer.
    pub has_discount_rule: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerDetail {
    pub customer: CustomerRow,
    pub recent_orders: Vec<OrderSummary>,
}

/// Orders belonging to customer `c`: linked by id, or (older rows with no link) by phone number.
const OWN_ORDER: &str =
    "(o.customer_id=c.id OR (o.customer_id IS NULL AND o.customer_phone=c.phone))";

fn customer_select(filter: &str) -> String {
    format!(
        "SELECT c.id,c.customer_code,c.name,c.phone,c.alternate_phone,c.address,c.customer_type,c.notes,c.created_at,\
         (SELECT COUNT(*) FROM orders o WHERE {OWN_ORDER}) AS order_count,\
         (SELECT COALESCE(SUM(CAST(ROUND(o.total_amount*100) AS INTEGER)),0) FROM orders o WHERE {OWN_ORDER} AND o.status<>'cancelled') AS billed_minor,\
         (SELECT MAX(o.received_at) FROM orders o WHERE {OWN_ORDER}) AS last_order_at,\
         EXISTS(SELECT 1 FROM counter_discounts d WHERE d.customer_id=c.id) AS has_discount_rule \
         FROM customers c {filter}"
    )
}

fn customer_row(row: &sqlx::sqlite::SqliteRow) -> Result<CustomerRow, String> {
    Ok(CustomerRow {
        id: row.try_get("id").map_err(db_err)?,
        customer_code: row.try_get("customer_code").map_err(db_err)?,
        name: row.try_get("name").map_err(db_err)?,
        phone: row.try_get("phone").map_err(db_err)?,
        alternate_phone: row.try_get("alternate_phone").map_err(db_err)?,
        address: row.try_get("address").map_err(db_err)?,
        customer_type: row.try_get("customer_type").map_err(db_err)?,
        notes: row.try_get("notes").map_err(db_err)?,
        created_at: row.try_get("created_at").map_err(db_err)?,
        order_count: row.try_get("order_count").map_err(db_err)?,
        billed_minor: row.try_get("billed_minor").map_err(db_err)?,
        last_order_at: row.try_get("last_order_at").map_err(db_err)?,
        has_discount_rule: row.try_get::<i64, _>("has_discount_rule").map_err(db_err)? == 1,
    })
}

async fn customer_in(
    conn: &mut sqlx::SqliteConnection,
    id: &str,
) -> Result<Option<CustomerRow>, String> {
    let row = sqlx::query(&customer_select("WHERE c.id=?"))
        .bind(id)
        .fetch_optional(conn)
        .await
        .map_err(db_err)?;
    row.as_ref().map(customer_row).transpose()
}

pub async fn list_customers(
    db: &DatabaseState,
    session: &CounterSession,
    search: &str,
    offset: u32,
    limit: u32,
) -> Result<Vec<CustomerRow>, String> {
    require_actor(session)?;
    let (offset, limit) = page(offset, limit, MAX_PAGE)?;
    let query = search.trim();
    if query.chars().count() > 100 {
        return Err("Keep the search to 100 characters or fewer.".into());
    }
    let text = like_contains(query);
    // A typed phone number ("98765 43210", "+91 98765 43210") also matches the stored digits.
    let phone_like = !query.is_empty()
        && query
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, ' ' | '-' | '+' | '.' | '(' | ')'));
    let digits: String = query.chars().filter(char::is_ascii_digit).collect();
    let phone = if phone_like && digits.len() >= 3 {
        format!("%{}%", normalize_phone(query).unwrap_or(digits))
    } else {
        text.clone()
    };
    let sql = customer_select(
        "WHERE ?1='' OR c.name LIKE ?2 ESCAPE '\\' OR c.customer_code LIKE ?2 ESCAPE '\\' \
         OR c.phone LIKE ?3 ESCAPE '\\' OR c.alternate_phone LIKE ?3 ESCAPE '\\' \
         ORDER BY c.name COLLATE NOCASE,c.created_at LIMIT ?4 OFFSET ?5",
    );
    let rows = sqlx::query(&sql)
        .bind(query)
        .bind(text)
        .bind(phone)
        .bind(limit)
        .bind(offset)
        .fetch_all(db.writer_pool()?)
        .await
        .map_err(db_err)?;
    rows.iter().map(customer_row).collect()
}

pub async fn get_customer(
    db: &DatabaseState,
    session: &CounterSession,
    customer_id: &str,
) -> Result<Option<CustomerDetail>, String> {
    require_actor(session)?;
    let mut conn = db.writer_pool()?.acquire().await.map_err(db_err)?;
    let Some(customer) = customer_in(&mut conn, customer_id).await? else {
        return Ok(None);
    };
    let rows = sqlx::query(
        "SELECT o.id,o.order_number,o.customer_name,o.customer_phone,o.status,o.received_at,o.expected_ready_at,o.total_amount,\
         COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id=o.id AND p.voided_at IS NULL),0.0) AS paid,\
         COALESCE((SELECT COUNT(*) FROM order_pieces p WHERE p.order_id=o.id),0) AS pieces \
         FROM orders o WHERE o.customer_id=?1 OR (o.customer_id IS NULL AND o.customer_phone=?2) \
         ORDER BY o.created_at DESC LIMIT ?3",
    )
    .bind(customer_id)
    .bind(&customer.phone)
    .bind(RECENT_ORDERS)
    .fetch_all(&mut *conn)
    .await
    .map_err(db_err)?;
    let recent_orders = rows
        .iter()
        .map(|r| {
            let total =
                (r.try_get::<f64, _>("total_amount").map_err(db_err)? * 100.0).round() as i64;
            let paid = (r.try_get::<f64, _>("paid").map_err(db_err)? * 100.0).round() as i64;
            Ok(OrderSummary {
                id: r.try_get("id").map_err(db_err)?,
                order_number: r.try_get("order_number").map_err(db_err)?,
                customer_name: r.try_get("customer_name").map_err(db_err)?,
                customer_phone: r.try_get("customer_phone").map_err(db_err)?,
                status: r.try_get("status").map_err(db_err)?,
                received_at: r.try_get("received_at").map_err(db_err)?,
                promised_at: r.try_get("expected_ready_at").map_err(db_err)?,
                total_minor: total,
                paid_minor: paid,
                balance_minor: total - paid,
                piece_count: u32::try_from(r.try_get::<i64, _>("pieces").map_err(db_err)?)
                    .unwrap_or(0),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Some(CustomerDetail {
        customer,
        recent_orders,
    }))
}

/// Refuse a second customer with the same phone AND name (ignoring case and extra spaces), as the
/// order flow does; one phone shared by two different people is allowed.
async fn ensure_unique_customer(
    tx: &mut Tx<'_>,
    valid: &ValidCustomer,
    except_id: Option<&str>,
) -> Result<(), String> {
    let rows = sqlx::query(
        "SELECT id,name FROM customers WHERE phone IN (?1,?2) AND (?3 IS NULL OR id<>?3)",
    )
    .bind(&valid.phone)
    .bind(&valid.raw_phone)
    .bind(except_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(db_err)?;
    let wanted = name_key(&valid.name);
    for row in rows {
        let name: String = row.try_get("name").map_err(db_err)?;
        if name_key(&name) == wanted {
            return Err("A customer with this name and phone number already exists.".into());
        }
    }
    Ok(())
}

pub async fn create_customer(
    db: &DatabaseState,
    session: &CounterSession,
    input: CustomerFields,
) -> Result<CustomerRow, String> {
    require_actor(session)?;
    let valid = validate_customer(&input)?;
    let mut tx = db.begin_counter_write().await?;
    let actor = require_active_in_tx(&mut tx, session).await?;
    ensure_unique_customer(&mut tx, &valid, None).await?;
    let id = Uuid::new_v4().to_string();
    let code = format!("C-{}", &id[..8]);
    let now = Utc::now().to_rfc3339();
    let device = device_id(&mut tx).await?;
    sqlx::query("INSERT INTO customers(id,customer_code,name,phone,alternate_phone,address,customer_type,notes,created_at,updated_at,origin_device_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&id).bind(&code).bind(&valid.name).bind(&valid.phone).bind(&valid.alternate_phone)
        .bind(&valid.address).bind(&valid.customer_type).bind(&valid.notes).bind(&now).bind(&now).bind(device)
        .execute(&mut *tx).await.map_err(db_err)?;
    audit_details(
        &mut tx,
        &actor.id,
        "customer_created",
        "customer",
        &id,
        &now,
        &serde_json::json!({
            "name": valid.name, "phone": valid.phone, "alternatePhone": valid.alternate_phone,
            "address": valid.address, "customerType": valid.customer_type, "notes": valid.notes,
        }),
    )
    .await?;
    let row = customer_in(&mut tx, &id)
        .await?
        .ok_or("The customer could not be read back.".to_string())?;
    tx.commit().await.map_err(db_err)?;
    Ok(row)
}

pub async fn update_customer(
    db: &DatabaseState,
    session: &CounterSession,
    customer_id: &str,
    input: CustomerFields,
) -> Result<CustomerRow, String> {
    require_actor(session)?;
    let valid = validate_customer(&input)?;
    let mut tx = db.begin_counter_write().await?;
    let actor = require_active_in_tx(&mut tx, session).await?;
    let old = customer_in(&mut tx, customer_id)
        .await?
        .ok_or("Customer not found.".to_string())?;
    let old_phone = normalize_phone(&old.phone).unwrap_or_else(|_| old.phone.clone());
    let identity_changed = name_key(&old.name) != name_key(&valid.name) || old_phone != valid.phone;
    if identity_changed {
        // The discount is tied to this customer's name and number; changing either could hand the
        // discount to someone else, so only the administrator may do it.
        if actor.role != "admin" && old.has_discount_rule {
            return Err("Only an administrator can change the name or phone of a customer who has a discount.".into());
        }
        ensure_unique_customer(&mut tx, &valid, Some(customer_id)).await?;
    }
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE customers SET name=?,phone=?,alternate_phone=?,address=?,customer_type=?,notes=?,updated_at=?,version=version+1 WHERE id=?")
        .bind(&valid.name).bind(&valid.phone).bind(&valid.alternate_phone).bind(&valid.address)
        .bind(&valid.customer_type).bind(&valid.notes).bind(&now).bind(customer_id)
        .execute(&mut *tx).await.map_err(db_err)?;
    audit_details(
        &mut tx,
        &actor.id,
        "customer_updated",
        "customer",
        customer_id,
        &now,
        &serde_json::json!({
            "old": {
                "name": old.name, "phone": old.phone, "alternatePhone": old.alternate_phone,
                "address": old.address, "customerType": old.customer_type, "notes": old.notes,
            },
            "new": {
                "name": valid.name, "phone": valid.phone, "alternatePhone": valid.alternate_phone,
                "address": valid.address, "customerType": valid.customer_type, "notes": valid.notes,
            },
        }),
    )
    .await?;
    let row = customer_in(&mut tx, customer_id)
        .await?
        .ok_or("The customer could not be read back.".to_string())?;
    tx.commit().await.map_err(db_err)?;
    Ok(row)
}

pub async fn delete_customer(
    db: &DatabaseState,
    session: &CounterSession,
    customer_id: &str,
    reason: &str,
) -> Result<(), String> {
    let mut tx = db.begin_counter_write().await?;
    let actor = require_admin_in_tx(&mut tx, session, "delete a customer").await?;
    let reason = valid_reason(reason)?;
    let customer = customer_in(&mut tx, customer_id)
        .await?
        .ok_or("Customer not found.".to_string())?;
    // Checked again in this transaction, by link AND by phone, so an order saved a moment ago for
    // this number always blocks the delete.
    let phone = normalize_phone(&customer.phone).unwrap_or_else(|_| customer.phone.clone());
    let orders: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders WHERE customer_id=?1 OR customer_phone IN (?2,?3)",
    )
    .bind(customer_id)
    .bind(&customer.phone)
    .bind(&phone)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if orders > 0 {
        return Err(format!(
            "This customer has {orders} order(s) and cannot be deleted. Orders are never deleted; cancel an order from the Orders screen instead."
        ));
    }
    let rule = sqlx::query(
        "SELECT id,scope,percent_bp,label,active FROM counter_discounts WHERE customer_id=?",
    )
    .bind(customer_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    .map(|r| -> Result<serde_json::Value, String> {
        Ok(serde_json::json!({
            "id": r.try_get::<String, _>("id").map_err(db_err)?,
            "scope": r.try_get::<String, _>("scope").map_err(db_err)?,
            "percentBp": r.try_get::<i64, _>("percent_bp").map_err(db_err)?,
            "label": r.try_get::<String, _>("label").map_err(db_err)?,
            "active": r.try_get::<i64, _>("active").map_err(db_err)? == 1,
        }))
    })
    .transpose()?;
    sqlx::query("DELETE FROM customers WHERE id=?")
        .bind(customer_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    audit_details(
        &mut tx,
        &actor.id,
        "customer_deleted",
        "customer",
        customer_id,
        &Utc::now().to_rfc3339(),
        &serde_json::json!({ "reason": reason, "customer": customer, "discountRule": rule }),
    )
    .await?;
    tx.commit().await.map_err(db_err)
}

// ---------------------------------------------------------------- expenses

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseFilter {
    /// First day to include, `YYYY-MM-DD` in shop time.
    pub from: Option<String>,
    /// Last day to include (inclusive), `YYYY-MM-DD` in shop time.
    pub to: Option<String>,
    pub category: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseInput {
    pub expense_date: String,
    pub category: String,
    pub description: Option<String>,
    pub amount_minor: i64,
    pub payment_method: String,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseRow {
    pub id: String,
    pub expense_date: String,
    pub category: String,
    pub description: Option<String>,
    pub amount_minor: i64,
    pub payment_method: String,
    pub notes: Option<String>,
    pub created_by: String,
    pub created_by_name: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseList {
    pub items: Vec<ExpenseRow>,
    /// Sum of every expense matching the filter, not just the rows returned.
    pub total_minor: i64,
    pub matching: i64,
    /// Every category ever recorded, for the category picker.
    pub categories: Vec<String>,
}

const EXPENSE_COLUMNS: &str = "e.id,e.expense_date,e.category,e.description,CAST(ROUND(e.amount*100) AS INTEGER) AS amount_minor,e.payment_method,e.notes,e.created_by,a.full_name AS created_by_name,e.created_at";

fn expense_row(row: &sqlx::sqlite::SqliteRow) -> Result<ExpenseRow, String> {
    Ok(ExpenseRow {
        id: row.try_get("id").map_err(db_err)?,
        expense_date: row.try_get("expense_date").map_err(db_err)?,
        category: row.try_get("category").map_err(db_err)?,
        description: row.try_get("description").map_err(db_err)?,
        amount_minor: row.try_get("amount_minor").map_err(db_err)?,
        payment_method: row.try_get("payment_method").map_err(db_err)?,
        notes: row.try_get("notes").map_err(db_err)?,
        created_by: row.try_get("created_by").map_err(db_err)?,
        created_by_name: row.try_get("created_by_name").map_err(db_err)?,
        created_at: row.try_get("created_at").map_err(db_err)?,
    })
}

async fn expense_in(
    conn: &mut sqlx::SqliteConnection,
    id: &str,
) -> Result<Option<ExpenseRow>, String> {
    let sql = format!("SELECT {EXPENSE_COLUMNS} FROM expenses e LEFT JOIN counter_accounts a ON a.id=e.created_by WHERE e.id=?");
    let row = sqlx::query(&sql)
        .bind(id)
        .fetch_optional(conn)
        .await
        .map_err(db_err)?;
    row.as_ref().map(expense_row).transpose()
}

pub async fn list_expenses(
    db: &DatabaseState,
    session: &CounterSession,
    filter: ExpenseFilter,
) -> Result<ExpenseList, String> {
    require_actor(session)?;
    let from = optional_date(filter.from.as_deref(), "From date")?;
    let to = optional_date(filter.to.as_deref(), "To date")?;
    if let (Some(from), Some(to)) = (from, to) {
        if from > to {
            return Err("The From date must not be after the To date.".into());
        }
    }
    let category = optional_text(filter.category.as_deref(), "Category", 60)?;
    let (_, limit) = page(0, filter.limit.unwrap_or(200), MAX_EXPENSE_PAGE)?;
    let from = from.map(date_text);
    let to = to.map(date_text);
    let pool = db.writer_pool()?;
    const WHERE: &str = "WHERE (?1 IS NULL OR e.expense_date>=?1) AND (?2 IS NULL OR e.expense_date<=?2) AND (?3 IS NULL OR e.category=?3 COLLATE NOCASE)";
    let rows = sqlx::query(&format!(
        "SELECT {EXPENSE_COLUMNS} FROM expenses e LEFT JOIN counter_accounts a ON a.id=e.created_by {WHERE} ORDER BY e.expense_date DESC,e.created_at DESC,e.id LIMIT ?4"
    ))
    .bind(&from)
    .bind(&to)
    .bind(&category)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(db_err)?;
    let totals = sqlx::query(&format!(
        "SELECT COUNT(*) AS matching,COALESCE(SUM(CAST(ROUND(e.amount*100) AS INTEGER)),0) AS total FROM expenses e {WHERE}"
    ))
    .bind(&from)
    .bind(&to)
    .bind(&category)
    .fetch_one(pool)
    .await
    .map_err(db_err)?;
    let categories: Vec<String> = sqlx::query_scalar(
        "SELECT category FROM expenses GROUP BY category COLLATE NOCASE ORDER BY category COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await
    .map_err(db_err)?;
    Ok(ExpenseList {
        items: rows.iter().map(expense_row).collect::<Result<_, _>>()?,
        total_minor: totals.try_get("total").map_err(db_err)?,
        matching: totals.try_get("matching").map_err(db_err)?,
        categories,
    })
}

pub async fn create_expense(
    db: &DatabaseState,
    session: &CounterSession,
    input: ExpenseInput,
) -> Result<ExpenseRow, String> {
    require_actor(session)?;
    let date = parse_date(&input.expense_date, "Expense date")?;
    if date > shop_today() {
        return Err("The expense date cannot be in the future.".into());
    }
    let category = required_text(&input.category, "Category", 60)?;
    let description = optional_text(input.description.as_deref(), "Description", 200)?;
    let notes = optional_text(input.notes.as_deref(), "Notes", 500)?;
    if !(1..=MAX_AMOUNT_MINOR).contains(&input.amount_minor) {
        return Err("The amount must be between ₹0.01 and ₹10,00,000.".into());
    }
    if !EXPENSE_METHODS.contains(&input.payment_method.as_str()) {
        return Err("Choose a valid payment method.".into());
    }
    let mut tx = db.begin_counter_write().await?;
    let actor = require_active_in_tx(&mut tx, session).await?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let device = device_id(&mut tx).await?;
    sqlx::query("INSERT INTO expenses(id,expense_date,category,description,amount,payment_method,notes,created_by,created_at,updated_at,origin_device_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&id).bind(date_text(date)).bind(&category).bind(&description)
        .bind(minor_to_rupees(input.amount_minor)).bind(&input.payment_method).bind(&notes)
        .bind(&actor.id).bind(&now).bind(&now).bind(device)
        .execute(&mut *tx).await.map_err(db_err)?;
    audit_details(
        &mut tx,
        &actor.id,
        "expense_created",
        "expense",
        &id,
        &now,
        &serde_json::json!({
            "expenseDate": date_text(date), "category": category, "description": description,
            "amountMinor": input.amount_minor, "paymentMethod": input.payment_method, "notes": notes,
        }),
    )
    .await?;
    let row = expense_in(&mut tx, &id)
        .await?
        .ok_or("The expense could not be read back.".to_string())?;
    tx.commit().await.map_err(db_err)?;
    Ok(row)
}

pub async fn delete_expense(
    db: &DatabaseState,
    session: &CounterSession,
    expense_id: &str,
    reason: &str,
) -> Result<(), String> {
    let mut tx = db.begin_counter_write().await?;
    let actor = require_admin_in_tx(&mut tx, session, "delete an expense").await?;
    let reason = valid_reason(reason)?;
    let expense = expense_in(&mut tx, expense_id)
        .await?
        .ok_or("Expense not found.".to_string())?;
    sqlx::query("DELETE FROM expenses WHERE id=?")
        .bind(expense_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    audit_details(
        &mut tx,
        &actor.id,
        "expense_deleted",
        "expense",
        expense_id,
        &Utc::now().to_rfc3339(),
        &serde_json::json!({ "reason": reason, "expense": expense }),
    )
    .await?;
    tx.commit().await.map_err(db_err)
}

// ---------------------------------------------------------------- inventory

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItemInput {
    pub name: String,
    pub unit: String,
    pub minimum_quantity: f64,
    /// Optional stock on hand when the item is first recorded; logged as a stock-in.
    pub opening_quantity: Option<f64>,
    pub purchase_cost_minor: Option<i64>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockAdjustment {
    pub item_id: String,
    /// `stock_in` (positive change), `stock_out` (negative change) or `adjustment` (either sign).
    pub transaction_type: String,
    pub change_quantity: f64,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryRow {
    pub id: String,
    pub name: String,
    pub unit: String,
    pub current_quantity: f64,
    pub minimum_quantity: f64,
    pub purchase_cost_minor: Option<i64>,
    pub notes: Option<String>,
    pub updated_at: String,
    /// Stock is at or below its minimum (items with no minimum never raise the flag).
    pub low_stock: bool,
}

const INVENTORY_COLUMNS: &str = "id,name,unit,current_quantity,minimum_quantity,CAST(ROUND(purchase_cost*100) AS INTEGER) AS purchase_cost_minor,notes,updated_at,(minimum_quantity>0 AND current_quantity<=minimum_quantity) AS low_stock";

fn inventory_row(row: &sqlx::sqlite::SqliteRow) -> Result<InventoryRow, String> {
    Ok(InventoryRow {
        id: row.try_get("id").map_err(db_err)?,
        name: row.try_get("name").map_err(db_err)?,
        unit: row.try_get("unit").map_err(db_err)?,
        current_quantity: row.try_get("current_quantity").map_err(db_err)?,
        minimum_quantity: row.try_get("minimum_quantity").map_err(db_err)?,
        purchase_cost_minor: row.try_get("purchase_cost_minor").map_err(db_err)?,
        notes: row.try_get("notes").map_err(db_err)?,
        updated_at: row.try_get("updated_at").map_err(db_err)?,
        low_stock: row.try_get::<i64, _>("low_stock").map_err(db_err)? == 1,
    })
}

async fn inventory_in(
    conn: &mut sqlx::SqliteConnection,
    id: &str,
) -> Result<Option<InventoryRow>, String> {
    let row = sqlx::query(&format!(
        "SELECT {INVENTORY_COLUMNS} FROM inventory_items WHERE id=?"
    ))
    .bind(id)
    .fetch_optional(conn)
    .await
    .map_err(db_err)?;
    row.as_ref().map(inventory_row).transpose()
}

pub async fn list_inventory(
    db: &DatabaseState,
    session: &CounterSession,
) -> Result<Vec<InventoryRow>, String> {
    require_actor(session)?;
    let rows = sqlx::query(&format!(
        "SELECT {INVENTORY_COLUMNS} FROM inventory_items ORDER BY name COLLATE NOCASE,id"
    ))
    .fetch_all(db.writer_pool()?)
    .await
    .map_err(db_err)?;
    rows.iter().map(inventory_row).collect()
}

async fn log_stock(
    tx: &mut Tx<'_>,
    item_id: &str,
    change: f64,
    kind: &str,
    reason: &str,
    actor_id: &str,
    now: &str,
) -> Result<(), String> {
    sqlx::query("INSERT INTO inventory_transactions(id,inventory_item_id,change_quantity,transaction_type,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(item_id).bind(change).bind(kind).bind(reason)
        .bind(actor_id).bind(now)
        .execute(&mut **tx).await.map_err(db_err)?;
    Ok(())
}

pub async fn create_inventory_item(
    db: &DatabaseState,
    session: &CounterSession,
    input: InventoryItemInput,
) -> Result<InventoryRow, String> {
    require_actor(session)?;
    let name = required_text(&input.name, "Item name", 80)?;
    let unit = required_text(&input.unit, "Unit", 20)?;
    let minimum = quantity_ok(input.minimum_quantity, "Minimum quantity", false)?;
    let opening = input
        .opening_quantity
        .map(|value| quantity_ok(value, "Opening quantity", false))
        .transpose()?
        .unwrap_or(0.0);
    if let Some(cost) = input.purchase_cost_minor {
        if !(0..=MAX_AMOUNT_MINOR).contains(&cost) {
            return Err("The purchase cost must be between ₹0 and ₹10,00,000.".into());
        }
    }
    let notes = optional_text(input.notes.as_deref(), "Notes", 500)?;
    let mut tx = db.begin_counter_write().await?;
    let actor = require_active_in_tx(&mut tx, session).await?;
    let taken: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM inventory_items WHERE name=? COLLATE NOCASE")
            .bind(&name)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    if taken > 0 {
        return Err("An inventory item with this name already exists.".into());
    }
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let device = device_id(&mut tx).await?;
    sqlx::query("INSERT INTO inventory_items(id,name,current_quantity,unit,minimum_quantity,purchase_cost,notes,created_at,updated_at,origin_device_id) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .bind(&id).bind(&name).bind(opening).bind(&unit).bind(minimum)
        .bind(input.purchase_cost_minor.map(minor_to_rupees)).bind(&notes).bind(&now).bind(&now).bind(device)
        .execute(&mut *tx).await.map_err(db_err)?;
    if opening > 0.0 {
        log_stock(
            &mut tx,
            &id,
            opening,
            "stock_in",
            "Opening stock",
            &actor.id,
            &now,
        )
        .await?;
    }
    audit_details(
        &mut tx,
        &actor.id,
        "inventory_item_created",
        "inventory_item",
        &id,
        &now,
        &serde_json::json!({
            "name": name, "unit": unit, "minimumQuantity": minimum, "openingQuantity": opening,
            "purchaseCostMinor": input.purchase_cost_minor, "notes": notes,
        }),
    )
    .await?;
    let row = inventory_in(&mut tx, &id)
        .await?
        .ok_or("The item could not be read back.".to_string())?;
    tx.commit().await.map_err(db_err)?;
    Ok(row)
}

pub async fn adjust_inventory(
    db: &DatabaseState,
    session: &CounterSession,
    input: StockAdjustment,
) -> Result<InventoryRow, String> {
    require_actor(session)?;
    if !STOCK_TYPES.contains(&input.transaction_type.as_str()) {
        return Err("Choose stock in, stock out or adjustment.".into());
    }
    let change = quantity_ok(input.change_quantity, "The stock change", true)?;
    if change == 0.0 {
        return Err("The stock change must not be zero.".into());
    }
    if (input.transaction_type == "stock_in" && change < 0.0)
        || (input.transaction_type == "stock_out" && change > 0.0)
    {
        return Err("The stock change direction does not match the type.".into());
    }
    let reason = valid_reason(&input.reason)?;
    let mut tx = db.begin_counter_write().await?;
    let actor = require_active_in_tx(&mut tx, session).await?;
    let before = inventory_in(&mut tx, &input.item_id)
        .await?
        .ok_or("Inventory item not found.".to_string())?;
    let now = Utc::now().to_rfc3339();
    // The balance check is part of the UPDATE, so stock can never go below zero even when two
    // adjustments are submitted together.
    let changed = sqlx::query("UPDATE inventory_items SET current_quantity=ROUND(current_quantity+?1,3),updated_at=?2,version=version+1 WHERE id=?3 AND ROUND(current_quantity+?1,3)>=0")
        .bind(change).bind(&now).bind(&input.item_id)
        .execute(&mut *tx).await.map_err(db_err)?
        .rows_affected();
    if changed != 1 {
        return Err(format!(
            "Stock cannot become negative; only {} {} in stock.",
            before.current_quantity, before.unit
        ));
    }
    log_stock(
        &mut tx,
        &input.item_id,
        change,
        &input.transaction_type,
        &reason,
        &actor.id,
        &now,
    )
    .await?;
    let after = inventory_in(&mut tx, &input.item_id)
        .await?
        .ok_or("The item could not be read back.".to_string())?;
    audit_details(
        &mut tx,
        &actor.id,
        "inventory_adjusted",
        "inventory_item",
        &input.item_id,
        &now,
        &serde_json::json!({
            "transactionType": input.transaction_type, "changeQuantity": change, "reason": reason,
            "oldQuantity": before.current_quantity, "newQuantity": after.current_quantity,
        }),
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    Ok(after)
}

pub async fn delete_inventory_item(
    db: &DatabaseState,
    session: &CounterSession,
    item_id: &str,
    reason: &str,
) -> Result<(), String> {
    let mut tx = db.begin_counter_write().await?;
    let actor = require_admin_in_tx(&mut tx, session, "delete an inventory item").await?;
    let reason = valid_reason(reason)?;
    let item = inventory_in(&mut tx, item_id)
        .await?
        .ok_or("Inventory item not found.".to_string())?;
    let history = sqlx::query("SELECT id,change_quantity,transaction_type,reason,created_by,created_at FROM inventory_transactions WHERE inventory_item_id=? ORDER BY created_at,id")
        .bind(item_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_err)?
        .iter()
        .map(|r| -> Result<serde_json::Value, String> {
            Ok(serde_json::json!({
                "id": r.try_get::<String, _>("id").map_err(db_err)?,
                "changeQuantity": r.try_get::<f64, _>("change_quantity").map_err(db_err)?,
                "transactionType": r.try_get::<String, _>("transaction_type").map_err(db_err)?,
                "reason": r.try_get::<Option<String>, _>("reason").map_err(db_err)?,
                "createdBy": r.try_get::<String, _>("created_by").map_err(db_err)?,
                "createdAt": r.try_get::<String, _>("created_at").map_err(db_err)?,
            }))
        })
        .collect::<Result<Vec<_>, String>>()?;
    // The history rows are removed with the item (ON DELETE CASCADE); the audit row keeps them.
    sqlx::query("DELETE FROM inventory_items WHERE id=?")
        .bind(item_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    audit_details(
        &mut tx,
        &actor.id,
        "inventory_item_deleted",
        "inventory_item",
        item_id,
        &Utc::now().to_rfc3339(),
        &serde_json::json!({ "reason": reason, "item": item, "transactions": history }),
    )
    .await?;
    tx.commit().await.map_err(db_err)
}

// ---------------------------------------------------------------- machines

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineInput {
    pub name: String,
    pub machine_type: String,
    pub capacity: Option<String>,
    pub purchase_date: Option<String>,
    pub last_maintenance_date: Option<String>,
    pub next_maintenance_date: Option<String>,
    pub notes: Option<String>,
}

struct ValidMachine {
    name: String,
    machine_type: String,
    capacity: Option<String>,
    purchase_date: Option<String>,
    last_maintenance_date: Option<String>,
    next_maintenance_date: Option<String>,
    notes: Option<String>,
}

fn validate_machine(input: &MachineInput) -> Result<ValidMachine, String> {
    let today = shop_today();
    let purchase = optional_date(input.purchase_date.as_deref(), "Purchase date")?;
    let last = optional_date(
        input.last_maintenance_date.as_deref(),
        "Last maintenance date",
    )?;
    let next = optional_date(
        input.next_maintenance_date.as_deref(),
        "Next maintenance date",
    )?;
    if purchase.is_some_and(|date| date > today) {
        return Err("The purchase date cannot be in the future.".into());
    }
    if last.is_some_and(|date| date > today) {
        return Err("The last maintenance date cannot be in the future.".into());
    }
    if let (Some(last), Some(next)) = (last, next) {
        if next < last {
            return Err("The next maintenance date cannot be before the last one.".into());
        }
    }
    Ok(ValidMachine {
        name: required_text(&input.name, "Machine name", 80)?,
        machine_type: required_text(&input.machine_type, "Machine type", 40)?,
        capacity: optional_text(input.capacity.as_deref(), "Capacity", 40)?,
        purchase_date: purchase.map(date_text),
        last_maintenance_date: last.map(date_text),
        next_maintenance_date: next.map(date_text),
        notes: optional_text(input.notes.as_deref(), "Notes", 500)?,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineRow {
    pub id: String,
    pub name: String,
    pub machine_type: String,
    pub capacity: Option<String>,
    pub purchase_date: Option<String>,
    pub last_maintenance_date: Option<String>,
    pub next_maintenance_date: Option<String>,
    pub notes: Option<String>,
    /// The next maintenance date is today (shop time) or earlier.
    pub maintenance_due: bool,
}

fn machine_row(row: &sqlx::sqlite::SqliteRow, today: &str) -> Result<MachineRow, String> {
    let next: Option<String> = row.try_get("next_maintenance_date").map_err(db_err)?;
    Ok(MachineRow {
        id: row.try_get("id").map_err(db_err)?,
        name: row.try_get("name").map_err(db_err)?,
        machine_type: row.try_get("machine_type").map_err(db_err)?,
        capacity: row.try_get("capacity").map_err(db_err)?,
        purchase_date: row.try_get("purchase_date").map_err(db_err)?,
        last_maintenance_date: row.try_get("last_maintenance_date").map_err(db_err)?,
        maintenance_due: next.as_deref().is_some_and(|date| date <= today),
        next_maintenance_date: next,
        notes: row.try_get("notes").map_err(db_err)?,
    })
}

const MACHINE_COLUMNS: &str =
    "id,name,machine_type,capacity,purchase_date,last_maintenance_date,next_maintenance_date,notes";

async fn machine_in(
    conn: &mut sqlx::SqliteConnection,
    id: &str,
) -> Result<Option<MachineRow>, String> {
    let row = sqlx::query(&format!(
        "SELECT {MACHINE_COLUMNS} FROM machines WHERE id=?"
    ))
    .bind(id)
    .fetch_optional(conn)
    .await
    .map_err(db_err)?;
    let today = date_text(shop_today());
    row.as_ref().map(|r| machine_row(r, &today)).transpose()
}

pub async fn list_machines(
    db: &DatabaseState,
    session: &CounterSession,
) -> Result<Vec<MachineRow>, String> {
    require_actor(session)?;
    let rows = sqlx::query(&format!(
        "SELECT {MACHINE_COLUMNS} FROM machines ORDER BY COALESCE(next_maintenance_date,'9999-12-31'),name COLLATE NOCASE,id"
    ))
    .fetch_all(db.writer_pool()?)
    .await
    .map_err(db_err)?;
    let today = date_text(shop_today());
    rows.iter().map(|r| machine_row(r, &today)).collect()
}

pub async fn create_machine(
    db: &DatabaseState,
    session: &CounterSession,
    input: MachineInput,
) -> Result<MachineRow, String> {
    require_actor(session)?;
    let valid = validate_machine(&input)?;
    let mut tx = db.begin_counter_write().await?;
    let actor = require_active_in_tx(&mut tx, session).await?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let device = device_id(&mut tx).await?;
    sqlx::query("INSERT INTO machines(id,name,machine_type,capacity,purchase_date,last_maintenance_date,next_maintenance_date,notes,created_at,updated_at,origin_device_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&id).bind(&valid.name).bind(&valid.machine_type).bind(&valid.capacity)
        .bind(&valid.purchase_date).bind(&valid.last_maintenance_date).bind(&valid.next_maintenance_date)
        .bind(&valid.notes).bind(&now).bind(&now).bind(device)
        .execute(&mut *tx).await.map_err(db_err)?;
    audit_details(
        &mut tx,
        &actor.id,
        "machine_created",
        "machine",
        &id,
        &now,
        &machine_json(&valid),
    )
    .await?;
    let row = machine_in(&mut tx, &id)
        .await?
        .ok_or("The machine could not be read back.".to_string())?;
    tx.commit().await.map_err(db_err)?;
    Ok(row)
}

fn machine_json(valid: &ValidMachine) -> serde_json::Value {
    serde_json::json!({
        "name": valid.name, "machineType": valid.machine_type, "capacity": valid.capacity,
        "purchaseDate": valid.purchase_date, "lastMaintenanceDate": valid.last_maintenance_date,
        "nextMaintenanceDate": valid.next_maintenance_date, "notes": valid.notes,
    })
}

/// Replace a machine's details, including its maintenance record (last and next service date and
/// notes). The table has no status column, so "status" is exactly this maintenance record.
pub async fn update_machine(
    db: &DatabaseState,
    session: &CounterSession,
    machine_id: &str,
    input: MachineInput,
) -> Result<MachineRow, String> {
    require_actor(session)?;
    let valid = validate_machine(&input)?;
    let mut tx = db.begin_counter_write().await?;
    let actor = require_active_in_tx(&mut tx, session).await?;
    let old = machine_in(&mut tx, machine_id)
        .await?
        .ok_or("Machine not found.".to_string())?;
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE machines SET name=?,machine_type=?,capacity=?,purchase_date=?,last_maintenance_date=?,next_maintenance_date=?,notes=?,updated_at=?,version=version+1 WHERE id=?")
        .bind(&valid.name).bind(&valid.machine_type).bind(&valid.capacity).bind(&valid.purchase_date)
        .bind(&valid.last_maintenance_date).bind(&valid.next_maintenance_date).bind(&valid.notes)
        .bind(&now).bind(machine_id)
        .execute(&mut *tx).await.map_err(db_err)?;
    audit_details(
        &mut tx,
        &actor.id,
        "machine_updated",
        "machine",
        machine_id,
        &now,
        &serde_json::json!({ "old": old, "new": machine_json(&valid) }),
    )
    .await?;
    let row = machine_in(&mut tx, machine_id)
        .await?
        .ok_or("The machine could not be read back.".to_string())?;
    tx.commit().await.map_err(db_err)?;
    Ok(row)
}

pub async fn delete_machine(
    db: &DatabaseState,
    session: &CounterSession,
    machine_id: &str,
    reason: &str,
) -> Result<(), String> {
    let mut tx = db.begin_counter_write().await?;
    let actor = require_admin_in_tx(&mut tx, session, "delete a machine").await?;
    let reason = valid_reason(reason)?;
    let machine = machine_in(&mut tx, machine_id)
        .await?
        .ok_or("Machine not found.".to_string())?;
    sqlx::query("DELETE FROM machines WHERE id=?")
        .bind(machine_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    audit_details(
        &mut tx,
        &actor.id,
        "machine_deleted",
        "machine",
        machine_id,
        &Utc::now().to_rfc3339(),
        &serde_json::json!({ "reason": reason, "machine": machine }),
    )
    .await?;
    tx.commit().await.map_err(db_err)
}

// ---------------------------------------------------------------- Tauri commands

#[tauri::command]
pub async fn counter_list_customers(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    search: String,
    offset: u32,
    limit: u32,
) -> Result<Vec<CustomerRow>, String> {
    list_customers(&state, &session, &search, offset, limit).await
}
#[tauri::command]
pub async fn counter_get_customer(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    customer_id: String,
) -> Result<Option<CustomerDetail>, String> {
    get_customer(&state, &session, &customer_id).await
}
#[tauri::command]
pub async fn counter_create_customer(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    input: CustomerFields,
) -> Result<CustomerRow, String> {
    create_customer(&state, &session, input).await
}
#[tauri::command]
pub async fn counter_update_customer(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    customer_id: String,
    input: CustomerFields,
) -> Result<CustomerRow, String> {
    update_customer(&state, &session, &customer_id, input).await
}
#[tauri::command]
pub async fn counter_delete_customer(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    customer_id: String,
    reason: String,
) -> Result<(), String> {
    delete_customer(&state, &session, &customer_id, &reason).await
}
#[tauri::command]
pub async fn counter_list_expenses(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    filter: ExpenseFilter,
) -> Result<ExpenseList, String> {
    list_expenses(&state, &session, filter).await
}
#[tauri::command]
pub async fn counter_create_expense(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    input: ExpenseInput,
) -> Result<ExpenseRow, String> {
    create_expense(&state, &session, input).await
}
#[tauri::command]
pub async fn counter_delete_expense(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    expense_id: String,
    reason: String,
) -> Result<(), String> {
    delete_expense(&state, &session, &expense_id, &reason).await
}
#[tauri::command]
pub async fn counter_list_inventory(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
) -> Result<Vec<InventoryRow>, String> {
    list_inventory(&state, &session).await
}
#[tauri::command]
pub async fn counter_create_inventory_item(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    input: InventoryItemInput,
) -> Result<InventoryRow, String> {
    create_inventory_item(&state, &session, input).await
}
#[tauri::command]
pub async fn counter_adjust_inventory(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    input: StockAdjustment,
) -> Result<InventoryRow, String> {
    adjust_inventory(&state, &session, input).await
}
#[tauri::command]
pub async fn counter_delete_inventory_item(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    item_id: String,
    reason: String,
) -> Result<(), String> {
    delete_inventory_item(&state, &session, &item_id, &reason).await
}
#[tauri::command]
pub async fn counter_list_machines(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
) -> Result<Vec<MachineRow>, String> {
    list_machines(&state, &session).await
}
#[tauri::command]
pub async fn counter_create_machine(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    input: MachineInput,
) -> Result<MachineRow, String> {
    create_machine(&state, &session, input).await
}
#[tauri::command]
pub async fn counter_update_machine(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    machine_id: String,
    input: MachineInput,
) -> Result<MachineRow, String> {
    update_machine(&state, &session, &machine_id, input).await
}
#[tauri::command]
pub async fn counter_delete_machine(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    machine_id: String,
    reason: String,
) -> Result<(), String> {
    delete_machine(&state, &session, &machine_id, &reason).await
}

#[cfg(test)]
mod office_tests {
    use super::*;
    use crate::counter::{self, AccountInput, SessionActor};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    static NEXT: AtomicU64 = AtomicU64::new(0);

    struct Fixture {
        db: Arc<DatabaseState>,
        admin: Arc<CounterSession>,
        staff: Arc<CounterSession>,
        admin_id: String,
        staff_id: String,
        dir: PathBuf,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn session_for(id: &str, role: &str) -> CounterSession {
        let session = CounterSession::default();
        session
            .set(SessionActor {
                id: id.into(),
                role: role.into(),
            })
            .unwrap();
        session
    }

    /// A database whose accounts were made the way the app makes them (setup_admin, then
    /// create_staff), so the local_users mirror rows exist exactly as in production.
    async fn fixture() -> Fixture {
        let dir = std::env::temp_dir().join(format!(
            "office-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db = DatabaseState::open(dir.join("office.db")).await;
        let admin = CounterSession::default();
        let owner = counter::setup_admin(
            &db,
            &admin,
            AccountInput {
                full_name: "Owner".into(),
                pin: "1234".into(),
            },
        )
        .await
        .unwrap();
        let clerk = counter::create_staff(
            &db,
            &admin,
            AccountInput {
                full_name: "Clerk".into(),
                pin: "4321".into(),
            },
        )
        .await
        .unwrap();
        Fixture {
            db: Arc::new(db),
            staff: Arc::new(session_for(&clerk.id, "staff")),
            admin: Arc::new(admin),
            admin_id: owner.id,
            staff_id: clerk.id,
            dir,
        }
    }

    fn customer(name: &str, phone: &str) -> CustomerFields {
        CustomerFields {
            name: name.into(),
            phone: phone.into(),
            alternate_phone: None,
            address: None,
            customer_type: None,
            notes: None,
        }
    }
    fn expense(date: &str, category: &str, amount_minor: i64) -> ExpenseInput {
        ExpenseInput {
            expense_date: date.into(),
            category: category.into(),
            description: None,
            amount_minor,
            payment_method: "cash".into(),
            notes: None,
        }
    }
    fn item(name: &str, minimum: f64, opening: Option<f64>) -> InventoryItemInput {
        InventoryItemInput {
            name: name.into(),
            unit: "kg".into(),
            minimum_quantity: minimum,
            opening_quantity: opening,
            purchase_cost_minor: None,
            notes: None,
        }
    }
    fn stock(item_id: &str, kind: &str, change: f64) -> StockAdjustment {
        StockAdjustment {
            item_id: item_id.into(),
            transaction_type: kind.into(),
            change_quantity: change,
            reason: "Weekly count".into(),
        }
    }
    fn machine(name: &str) -> MachineInput {
        MachineInput {
            name: name.into(),
            machine_type: "Washer".into(),
            capacity: Some("12 kg".into()),
            purchase_date: None,
            last_maintenance_date: None,
            next_maintenance_date: None,
            notes: None,
        }
    }
    fn days_from_today(days: i64) -> String {
        date_text(shop_today() + Duration::days(days))
    }

    /// Test fixture row; every argument is a column the tests vary.
    #[allow(clippy::too_many_arguments)]
    async fn insert_order(
        db: &DatabaseState,
        number: &str,
        customer_id: Option<&str>,
        phone: &str,
        status: &str,
        total: f64,
        created_by: &str,
        at: &str,
    ) -> String {
        let id = format!("order-{number}");
        sqlx::query("INSERT INTO orders(id,order_number,customer_id,customer_name,customer_phone,order_type,received_at,status,subtotal,total_amount,created_by,created_at,updated_at,origin_device_id) VALUES(?,?,?,'Walk-in',?,'piece',?,?,?,?,?,?,?,'test')")
            .bind(&id).bind(number).bind(customer_id).bind(phone).bind(at).bind(status)
            .bind(total).bind(total).bind(created_by).bind(at).bind(at)
            .execute(db.writer_pool().unwrap()).await.unwrap();
        id
    }

    async fn audit_rows(db: &DatabaseState, action: &str) -> Vec<serde_json::Value> {
        let rows: Vec<String> = sqlx::query_scalar(
            "SELECT details_json FROM counter_audit WHERE action=? ORDER BY created_at,id",
        )
        .bind(action)
        .fetch_all(db.writer_pool().unwrap())
        .await
        .unwrap();
        rows.iter()
            .map(|json| serde_json::from_str(json).unwrap())
            .collect()
    }

    async fn count(db: &DatabaseState, table: &str) -> i64 {
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(db.writer_pool().unwrap())
            .await
            .unwrap()
    }

    fn run<F: std::future::Future<Output = ()>>(future: F) {
        tauri::async_runtime::block_on(future);
    }

    // ------------------------------------------------------------ roles and sessions

    #[test]
    fn admin_and_staff_can_both_write_every_record_type() {
        run(async {
            let f = fixture().await;
            for (session, who) in [(&f.admin, &f.admin_id), (&f.staff, &f.staff_id)] {
                let c = create_customer(
                    &f.db,
                    session,
                    customer(&format!("Cust {who}"), "9876543210"),
                )
                .await
                .unwrap();
                assert_eq!(c.order_count, 0);
                let e = create_expense(
                    &f.db,
                    session,
                    expense(&days_from_today(0), "Rent", 150_000),
                )
                .await
                .unwrap();
                assert_eq!(e.created_by, *who, "created_by is the signed-in account");
                assert!(e.created_by_name.is_some());
                let i = create_inventory_item(
                    &f.db,
                    session,
                    item(&format!("Soap {who}"), 2.0, Some(5.0)),
                )
                .await
                .unwrap();
                let after = adjust_inventory(&f.db, session, stock(&i.id, "stock_out", -1.0))
                    .await
                    .unwrap();
                assert_eq!(after.current_quantity, 4.0);
                let m = create_machine(&f.db, session, machine(&format!("Washer {who}")))
                    .await
                    .unwrap();
                update_machine(&f.db, session, &m.id, machine(&format!("Washer {who} B")))
                    .await
                    .unwrap();
                let txn_by: String = sqlx::query_scalar(
                    "SELECT created_by FROM inventory_transactions WHERE inventory_item_id=? AND transaction_type='stock_out'",
                )
                .bind(&i.id)
                .fetch_one(f.db.writer_pool().unwrap())
                .await
                .unwrap();
                assert_eq!(txn_by, *who);
            }
            assert_eq!(
                list_customers(&f.db, &f.staff, "", 0, 50)
                    .await
                    .unwrap()
                    .len(),
                2
            );
            assert_eq!(list_inventory(&f.db, &f.staff).await.unwrap().len(), 2);
            assert_eq!(list_machines(&f.db, &f.staff).await.unwrap().len(), 2);
        });
    }

    #[test]
    fn staff_can_never_delete_but_admin_can() {
        run(async {
            let f = fixture().await;
            let c = create_customer(&f.db, &f.staff, customer("Del Me", "9876543210"))
                .await
                .unwrap();
            let e = create_expense(&f.db, &f.staff, expense(&days_from_today(0), "Tea", 5_000))
                .await
                .unwrap();
            let i = create_inventory_item(&f.db, &f.staff, item("Bleach", 1.0, None))
                .await
                .unwrap();
            let m = create_machine(&f.db, &f.staff, machine("Dryer"))
                .await
                .unwrap();
            let denied = "Administrator access is required";
            assert!(delete_customer(&f.db, &f.staff, &c.id, "Duplicate entry")
                .await
                .unwrap_err()
                .contains(denied));
            assert!(delete_expense(&f.db, &f.staff, &e.id, "Entered twice")
                .await
                .unwrap_err()
                .contains(denied));
            assert!(
                delete_inventory_item(&f.db, &f.staff, &i.id, "Discontinued")
                    .await
                    .unwrap_err()
                    .contains(denied)
            );
            assert!(delete_machine(&f.db, &f.staff, &m.id, "Sold the machine")
                .await
                .unwrap_err()
                .contains(denied));
            assert_eq!(
                (
                    count(&f.db, "customers").await,
                    count(&f.db, "expenses").await,
                    count(&f.db, "inventory_items").await,
                    count(&f.db, "machines").await
                ),
                (1, 1, 1, 1)
            );
            delete_customer(&f.db, &f.admin, &c.id, "Duplicate entry")
                .await
                .unwrap();
            delete_expense(&f.db, &f.admin, &e.id, "Entered twice")
                .await
                .unwrap();
            delete_inventory_item(&f.db, &f.admin, &i.id, "Discontinued")
                .await
                .unwrap();
            delete_machine(&f.db, &f.admin, &m.id, "Sold the machine")
                .await
                .unwrap();
            assert_eq!(
                (
                    count(&f.db, "customers").await,
                    count(&f.db, "expenses").await,
                    count(&f.db, "inventory_items").await,
                    count(&f.db, "machines").await
                ),
                (0, 0, 0, 0)
            );
        });
    }

    #[test]
    fn signed_out_forged_and_inactive_sessions_are_refused() {
        run(async {
            let f = fixture().await;
            let out = CounterSession::default();
            let login_first = "Log in before";
            assert!(list_customers(&f.db, &out, "", 0, 10)
                .await
                .unwrap_err()
                .contains(login_first));
            assert!(get_customer(&f.db, &out, "x")
                .await
                .unwrap_err()
                .contains(login_first));
            assert!(list_expenses(&f.db, &out, ExpenseFilter::default())
                .await
                .unwrap_err()
                .contains(login_first));
            assert!(list_inventory(&f.db, &out)
                .await
                .unwrap_err()
                .contains(login_first));
            assert!(list_machines(&f.db, &out)
                .await
                .unwrap_err()
                .contains(login_first));
            assert!(create_customer(&f.db, &out, customer("A", "9876543210"))
                .await
                .unwrap_err()
                .contains(login_first));
            assert!(delete_machine(&f.db, &out, "x", "no reason")
                .await
                .unwrap_err()
                .contains(login_first));

            // A session naming an account that does not exist.
            let ghost = session_for("ghost", "staff");
            let stale = "no longer active";
            assert!(create_customer(&f.db, &ghost, customer("A", "9876543210"))
                .await
                .unwrap_err()
                .contains(stale));
            assert!(
                create_expense(&f.db, &ghost, expense(&days_from_today(0), "Rent", 100))
                    .await
                    .unwrap_err()
                    .contains(stale)
            );
            assert!(create_inventory_item(&f.db, &ghost, item("X", 0.0, None))
                .await
                .unwrap_err()
                .contains(stale));
            assert!(create_machine(&f.db, &ghost, machine("W"))
                .await
                .unwrap_err()
                .contains(stale));
            let forged_admin = session_for("ghost", "admin");
            assert!(delete_expense(&f.db, &forged_admin, "x", "forged admin")
                .await
                .unwrap_err()
                .contains("no longer valid"));

            // A staff account that claims to be admin: the session says admin, the database says staff.
            let impostor = session_for(&f.staff_id, "admin");
            assert!(delete_customer(&f.db, &impostor, "x", "impostor")
                .await
                .unwrap_err()
                .contains("no longer valid"));
            assert!(
                create_customer(&f.db, &impostor, customer("A", "9876543210"))
                    .await
                    .unwrap_err()
                    .contains(stale)
            );

            // A deactivated staff account stops being able to write at once, session or not.
            create_customer(&f.db, &f.staff, customer("Before", "9876543210"))
                .await
                .unwrap();
            counter::update_staff(&f.db, &f.admin, &f.staff_id, Some(false), None)
                .await
                .unwrap();
            assert!(
                create_customer(&f.db, &f.staff, customer("After", "9876543211"))
                    .await
                    .unwrap_err()
                    .contains(stale)
            );
            assert!(
                adjust_inventory(&f.db, &f.staff, stock("x", "adjustment", 1.0))
                    .await
                    .unwrap_err()
                    .contains(stale)
            );
            assert_eq!(count(&f.db, "customers").await, 1);

            // An admin deactivated in the database loses delete rights even with a live session.
            sqlx::query("UPDATE counter_accounts SET active=0 WHERE id=?")
                .bind(&f.admin_id)
                .execute(f.db.writer_pool().unwrap())
                .await
                .unwrap();
            assert!(delete_customer(&f.db, &f.admin, "x", "deactivated admin")
                .await
                .unwrap_err()
                .contains("no longer valid"));
        });
    }

    // ------------------------------------------------------------ customers

    #[test]
    fn customer_phone_is_normalised_exactly_like_the_order_flow() {
        run(async {
            let f = fixture().await;
            for raw in [
                "+91 98765 43210",
                "09876543210",
                "९८७६५४३२१०",
                "(98765) 43210",
            ] {
                assert_eq!(normalize_phone(raw).unwrap(), "9876543210");
            }
            let c = create_customer(
                &f.db,
                &f.staff,
                CustomerFields {
                    alternate_phone: Some("+91 91234 56789".into()),
                    ..customer("Rahul", "+91 98765 43210")
                },
            )
            .await
            .unwrap();
            assert_eq!(c.phone, normalize_phone("+91 98765 43210").unwrap());
            assert_eq!(c.alternate_phone.as_deref(), Some("9123456789"));
            assert!(c.customer_code.starts_with("C-"));
            assert_eq!(c.customer_type, "regular");
            for bad in ["12345", "98765abcde", "", "98765432101234"] {
                assert!(
                    create_customer(&f.db, &f.staff, customer("Bad", bad))
                        .await
                        .is_err(),
                    "{bad}"
                );
            }
            assert!(create_customer(
                &f.db,
                &f.staff,
                CustomerFields {
                    alternate_phone: Some("123".into()),
                    ..customer("Bad", "9876543299")
                }
            )
            .await
            .is_err());
        });
    }

    #[test]
    fn customers_are_unique_per_phone_and_name_but_a_phone_may_be_shared() {
        run(async {
            let f = fixture().await;
            let a = create_customer(&f.db, &f.staff, customer("Priya  Shah", "9876543210"))
                .await
                .unwrap();
            let dup = create_customer(&f.db, &f.admin, customer("priya shah", "+91 9876543210"))
                .await
                .unwrap_err();
            assert!(dup.contains("already exists"));
            let b = create_customer(&f.db, &f.staff, customer("Anil Shah", "9876543210"))
                .await
                .unwrap();
            assert_ne!(a.id, b.id);
            // Renaming into a duplicate is refused; keeping your own identity is not a duplicate.
            let clash =
                update_customer(&f.db, &f.staff, &b.id, customer("Priya Shah", "9876543210"))
                    .await
                    .unwrap_err();
            assert!(clash.contains("already exists"));
            update_customer(
                &f.db,
                &f.staff,
                &a.id,
                CustomerFields {
                    address: Some("12 MG Road".into()),
                    ..customer("Priya Shah", "9876543210")
                },
            )
            .await
            .unwrap();
            // A legacy row stored with the number as typed still counts as the same person.
            sqlx::query("INSERT INTO customers(id,customer_code,name,phone,customer_type,created_at,updated_at,origin_device_id) VALUES('legacy','C-legacy','Old Timer','98765 11111','regular','2024','2024','x')")
                .execute(f.db.writer_pool().unwrap()).await.unwrap();
            assert!(
                create_customer(&f.db, &f.staff, customer("Old Timer", "98765 11111"))
                    .await
                    .unwrap_err()
                    .contains("already exists")
            );
        });
    }

    #[test]
    fn customer_field_validation_and_caps() {
        run(async {
            let f = fixture().await;
            let long = "x".repeat(101);
            assert!(create_customer(&f.db, &f.staff, customer("", "9876543210"))
                .await
                .unwrap_err()
                .contains("required"));
            assert!(
                create_customer(&f.db, &f.staff, customer(&long, "9876543210"))
                    .await
                    .unwrap_err()
                    .contains("100")
            );
            assert!(
                create_customer(&f.db, &f.staff, customer("Tab\tName", "9876543210"))
                    .await
                    .unwrap_err()
                    .contains("not allowed")
            );
            let too_long = |field: &str| field.repeat(301);
            assert!(create_customer(
                &f.db,
                &f.staff,
                CustomerFields {
                    address: Some(too_long("a")),
                    ..customer("A", "9876543210")
                }
            )
            .await
            .is_err());
            assert!(create_customer(
                &f.db,
                &f.staff,
                CustomerFields {
                    notes: Some("n".repeat(501)),
                    ..customer("A", "9876543210")
                }
            )
            .await
            .is_err());
            assert!(create_customer(
                &f.db,
                &f.staff,
                CustomerFields {
                    customer_type: Some("vip".into()),
                    ..customer("A", "9876543210")
                }
            )
            .await
            .unwrap_err()
            .contains("customer type"));
            let ok = create_customer(
                &f.db,
                &f.staff,
                CustomerFields {
                    customer_type: Some("hostel".into()),
                    notes: Some("  line1\nline2 ".into()),
                    address: Some("   ".into()),
                    ..customer("  Ok  ", "9876543210")
                },
            )
            .await
            .unwrap();
            assert_eq!(
                (
                    ok.name.as_str(),
                    ok.customer_type.as_str(),
                    ok.address.clone(),
                    ok.notes.as_deref()
                ),
                ("Ok", "hostel", None, Some("line1\nline2"))
            );
            assert!(
                update_customer(&f.db, &f.staff, "missing", customer("A", "9876543210"))
                    .await
                    .unwrap_err()
                    .contains("not found")
            );
            assert!(
                update_customer(&f.db, &f.staff, &ok.id, customer("A", "bad"))
                    .await
                    .is_err()
            );
            assert_eq!(count(&f.db, "customers").await, 1);
        });
    }

    #[test]
    fn customer_list_search_and_order_statistics() {
        run(async {
            let f = fixture().await;
            let rahul = create_customer(&f.db, &f.staff, customer("Rahul Patil", "9876543210"))
                .await
                .unwrap();
            let priya = create_customer(&f.db, &f.staff, customer("Priya Shah", "9123456789"))
                .await
                .unwrap();
            let idle = create_customer(&f.db, &f.staff, customer("Zed 100% _x", "9000000001"))
                .await
                .unwrap();
            for (n, status, total, at) in [
                ("A-1", "collected", 250.50, "2026-01-01T10:00:00.000Z"),
                ("A-2", "ready", 100.0, "2026-02-01T10:00:00.000Z"),
                ("A-3", "cancelled", 999.0, "2026-03-01T10:00:00.000Z"),
            ] {
                insert_order(
                    &f.db,
                    n,
                    Some(&rahul.id),
                    &rahul.phone,
                    status,
                    total,
                    &f.staff_id,
                    at,
                )
                .await;
            }
            // An older order with no customer link is matched by phone.
            insert_order(
                &f.db,
                "A-4",
                None,
                &rahul.phone,
                "ready",
                49.99,
                &f.staff_id,
                "2026-01-15T10:00:00.000Z",
            )
            .await;
            // Another customer's order with a different phone never leaks in.
            insert_order(
                &f.db,
                "B-1",
                Some(&priya.id),
                &priya.phone,
                "ready",
                10.0,
                &f.staff_id,
                "2026-01-02T10:00:00.000Z",
            )
            .await;

            let all = list_customers(&f.db, &f.staff, "", 0, 50).await.unwrap();
            assert_eq!(
                all.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
                ["Priya Shah", "Rahul Patil", "Zed 100% _x"]
            );
            let r = all.iter().find(|c| c.id == rahul.id).unwrap();
            assert_eq!(r.order_count, 4, "cancelled orders still count as orders");
            assert_eq!(
                r.billed_minor,
                25_050 + 10_000 + 4_999,
                "cancelled orders are not billed"
            );
            assert_eq!(r.last_order_at.as_deref(), Some("2026-03-01T10:00:00.000Z"));
            let p = all.iter().find(|c| c.id == priya.id).unwrap();
            assert_eq!((p.order_count, p.billed_minor), (1, 1_000));
            let i = all.iter().find(|c| c.id == idle.id).unwrap();
            assert_eq!(
                (i.order_count, i.billed_minor, i.last_order_at.clone()),
                (0, 0, None)
            );

            let names =
                |rows: Vec<CustomerRow>| rows.into_iter().map(|c| c.name).collect::<Vec<_>>();
            assert_eq!(
                names(
                    list_customers(&f.db, &f.staff, "rahul", 0, 50)
                        .await
                        .unwrap()
                ),
                ["Rahul Patil"]
            );
            assert_eq!(
                names(
                    list_customers(&f.db, &f.staff, "  SHAH ", 0, 50)
                        .await
                        .unwrap()
                ),
                ["Priya Shah"]
            );
            assert_eq!(
                names(
                    list_customers(&f.db, &f.staff, &rahul.customer_code, 0, 50)
                        .await
                        .unwrap()
                ),
                ["Rahul Patil"]
            );
            assert_eq!(
                names(
                    list_customers(&f.db, &f.staff, "+91 98765 43210", 0, 50)
                        .await
                        .unwrap()
                ),
                ["Rahul Patil"]
            );
            assert_eq!(
                names(
                    list_customers(&f.db, &f.staff, "98765", 0, 50)
                        .await
                        .unwrap()
                ),
                ["Rahul Patil"]
            );
            assert_eq!(
                names(
                    list_customers(&f.db, &f.staff, "100%", 0, 50)
                        .await
                        .unwrap()
                ),
                ["Zed 100% _x"],
                "LIKE wildcards are literal"
            );
            assert!(
                list_customers(&f.db, &f.staff, "%", 0, 50)
                    .await
                    .unwrap()
                    .len()
                    == 1,
                "a bare % matches only a literal percent sign"
            );
            assert!(list_customers(&f.db, &f.staff, "nobody", 0, 50)
                .await
                .unwrap()
                .is_empty());
            assert_eq!(
                list_customers(&f.db, &f.staff, "", 1, 1).await.unwrap()[0].name,
                "Rahul Patil"
            );
            assert!(list_customers(&f.db, &f.staff, "", 0, 0).await.is_err());
            assert!(list_customers(&f.db, &f.staff, "", 0, 201).await.is_err());
            assert!(list_customers(&f.db, &f.staff, "", 100_001, 10)
                .await
                .is_err());
            assert!(list_customers(&f.db, &f.staff, &"x".repeat(101), 0, 10)
                .await
                .is_err());
        });
    }

    #[test]
    fn customer_detail_lists_recent_orders_newest_first_capped_at_ten() {
        run(async {
            let f = fixture().await;
            let c = create_customer(&f.db, &f.staff, customer("Rahul Patil", "9876543210"))
                .await
                .unwrap();
            assert!(get_customer(&f.db, &f.staff, "missing")
                .await
                .unwrap()
                .is_none());
            let empty = get_customer(&f.db, &f.staff, &c.id).await.unwrap().unwrap();
            assert!(empty.recent_orders.is_empty());
            for n in 1..=12 {
                insert_order(
                    &f.db,
                    &format!("R-{n:02}"),
                    Some(&c.id),
                    &c.phone,
                    "ready",
                    100.0,
                    &f.staff_id,
                    &format!("2026-01-{n:02}T10:00:00.000Z"),
                )
                .await;
            }
            sqlx::query("INSERT INTO payments(id,order_id,amount,method,recorded_at,recorded_by,created_at,updated_at,origin_device_id) VALUES('pay-1','order-R-12',40.5,'cash','2026-01-12',?,'2026-01-12','2026-01-12','t')")
                .bind(&f.staff_id).execute(f.db.writer_pool().unwrap()).await.unwrap();
            let detail = get_customer(&f.db, &f.staff, &c.id).await.unwrap().unwrap();
            assert_eq!(detail.customer.order_count, 12);
            assert_eq!(detail.recent_orders.len(), 10);
            assert_eq!(detail.recent_orders[0].order_number, "R-12");
            assert_eq!(detail.recent_orders[9].order_number, "R-03");
            assert_eq!(
                (
                    detail.recent_orders[0].total_minor,
                    detail.recent_orders[0].paid_minor,
                    detail.recent_orders[0].balance_minor
                ),
                (10_000, 4_050, 5_950)
            );
        });
    }

    #[test]
    fn staff_cannot_change_identity_of_a_customer_with_a_discount_but_admin_can() {
        run(async {
            let f = fixture().await;
            let c = create_customer(&f.db, &f.staff, customer("Vip Customer", "9876543210"))
                .await
                .unwrap();
            assert!(!c.has_discount_rule);
            // Without a rule staff may rename.
            let renamed = update_customer(
                &f.db,
                &f.staff,
                &c.id,
                customer("Vip Customer Jr", "9876543210"),
            )
            .await
            .unwrap();
            counter::set_discount(&f.db, &f.admin, Some(&c.id), 1000, true, "Regular")
                .await
                .unwrap();
            let c = get_customer(&f.db, &f.staff, &renamed.id)
                .await
                .unwrap()
                .unwrap()
                .customer;
            assert!(c.has_discount_rule);
            let blocked = "Only an administrator can change the name or phone";
            assert!(update_customer(
                &f.db,
                &f.staff,
                &c.id,
                customer("Someone Else", "9876543210")
            )
            .await
            .unwrap_err()
            .contains(blocked));
            assert!(update_customer(
                &f.db,
                &f.staff,
                &c.id,
                customer("Vip Customer Jr", "9876500000")
            )
            .await
            .unwrap_err()
            .contains(blocked));
            // Case-only name changes and other fields are not an identity change.
            update_customer(
                &f.db,
                &f.staff,
                &c.id,
                CustomerFields {
                    address: Some("New address".into()),
                    notes: Some("Prefers starch".into()),
                    ..customer("vip customer  jr", "+91 9876543210")
                },
            )
            .await
            .unwrap();
            let after =
                update_customer(&f.db, &f.admin, &c.id, customer("Vip Senior", "9876500000"))
                    .await
                    .unwrap();
            assert_eq!(
                (
                    after.name.as_str(),
                    after.phone.as_str(),
                    after.has_discount_rule
                ),
                ("Vip Senior", "9876500000", true)
            );
            let audits = audit_rows(&f.db, "customer_updated").await;
            let last = audits.last().unwrap();
            assert_eq!(
                last["old"]["name"], "vip customer jr",
                "the staff case-only edit was applied and audited"
            );
            assert_eq!(last["new"]["name"], "Vip Senior");
            assert_eq!(last["new"]["phone"], "9876500000");
        });
    }

    #[test]
    fn deleting_a_customer_is_refused_when_orders_exist_by_link_or_by_phone() {
        run(async {
            let f = fixture().await;
            let linked = create_customer(&f.db, &f.staff, customer("Linked", "9876543210"))
                .await
                .unwrap();
            let by_phone = create_customer(&f.db, &f.staff, customer("By Phone", "9123456789"))
                .await
                .unwrap();
            let clean = create_customer(&f.db, &f.staff, customer("Clean", "9000000001"))
                .await
                .unwrap();
            insert_order(
                &f.db,
                "L-1",
                Some(&linked.id),
                "0000000000",
                "cancelled",
                10.0,
                &f.staff_id,
                "2026-01-01T10:00:00.000Z",
            )
            .await;
            insert_order(
                &f.db,
                "P-1",
                None,
                &by_phone.phone,
                "ready",
                10.0,
                &f.staff_id,
                "2026-01-01T10:00:00.000Z",
            )
            .await;
            let msg = delete_customer(&f.db, &f.admin, &linked.id, "Cleaning up")
                .await
                .unwrap_err();
            assert!(
                msg.contains("1 order") && msg.contains("never deleted"),
                "{msg}"
            );
            assert!(
                delete_customer(&f.db, &f.admin, &by_phone.id, "Cleaning up")
                    .await
                    .unwrap_err()
                    .contains("cannot be deleted")
            );
            assert_eq!(count(&f.db, "customers").await, 3);
            assert!(
                audit_rows(&f.db, "customer_deleted").await.is_empty(),
                "a refused delete writes no audit row"
            );

            counter::set_discount(&f.db, &f.admin, Some(&clean.id), 500, true, "Friend")
                .await
                .unwrap();
            delete_customer(&f.db, &f.admin, &clean.id, "  Duplicate of another  ")
                .await
                .unwrap();
            assert_eq!(count(&f.db, "customers").await, 2);
            assert_eq!(
                count(&f.db, "counter_discounts").await,
                0,
                "the customer's discount rule goes with it"
            );
            let audits = audit_rows(&f.db, "customer_deleted").await;
            assert_eq!(audits.len(), 1);
            assert_eq!(audits[0]["reason"], "Duplicate of another");
            assert_eq!(audits[0]["customer"]["name"], "Clean");
            assert_eq!(audits[0]["customer"]["phone"], "9000000001");
            assert_eq!(audits[0]["discountRule"]["percentBp"], 500);
            let actor: String = sqlx::query_scalar(
                "SELECT actor_id FROM counter_audit WHERE action='customer_deleted'",
            )
            .fetch_one(f.db.writer_pool().unwrap())
            .await
            .unwrap();
            assert_eq!(actor, f.admin_id);
            assert!(delete_customer(&f.db, &f.admin, &clean.id, "Already gone")
                .await
                .unwrap_err()
                .contains("not found"));
        });
    }

    #[test]
    fn delete_reasons_are_validated_for_every_record_type() {
        run(async {
            let f = fixture().await;
            let c = create_customer(&f.db, &f.staff, customer("A", "9876543210"))
                .await
                .unwrap();
            let e = create_expense(&f.db, &f.staff, expense(&days_from_today(0), "Tea", 500))
                .await
                .unwrap();
            let i = create_inventory_item(&f.db, &f.staff, item("Soap", 0.0, None))
                .await
                .unwrap();
            let m = create_machine(&f.db, &f.staff, machine("W")).await.unwrap();
            for reason in ["", "  ab  ", &"r".repeat(201), "bad\u{7}reason"] {
                for result in [
                    delete_customer(&f.db, &f.admin, &c.id, reason).await,
                    delete_expense(&f.db, &f.admin, &e.id, reason).await,
                    delete_inventory_item(&f.db, &f.admin, &i.id, reason).await,
                    delete_machine(&f.db, &f.admin, &m.id, reason).await,
                ] {
                    assert!(result.unwrap_err().contains("3 to 200 characters"));
                }
            }
            assert_eq!(
                count(&f.db, "customers").await
                    + count(&f.db, "expenses").await
                    + count(&f.db, "inventory_items").await
                    + count(&f.db, "machines").await,
                4
            );
            assert_eq!(
                count(&f.db, "counter_audit").await,
                4 + 2,
                "only the setup/staff rows plus four creations"
            );
            for missing in [
                delete_expense(&f.db, &f.admin, "nope", "Does not exist")
                    .await
                    .unwrap_err(),
                delete_inventory_item(&f.db, &f.admin, "nope", "Does not exist")
                    .await
                    .unwrap_err(),
                delete_machine(&f.db, &f.admin, "nope", "Does not exist")
                    .await
                    .unwrap_err(),
            ] {
                assert!(missing.contains("not found"));
            }
        });
    }

    // ------------------------------------------------------------ expenses

    #[test]
    fn expense_is_stored_in_rupees_and_listed_in_paise() {
        run(async {
            let f = fixture().await;
            let created = create_expense(
                &f.db,
                &f.staff,
                ExpenseInput {
                    description: Some("  Detergent refill ".into()),
                    notes: Some("Receipt 42".into()),
                    payment_method: "upi".into(),
                    ..expense(&days_from_today(0), "  Supplies ", 123_457)
                },
            )
            .await
            .unwrap();
            assert_eq!(
                (
                    created.category.as_str(),
                    created.amount_minor,
                    created.payment_method.as_str()
                ),
                ("Supplies", 123_457, "upi")
            );
            assert_eq!(created.description.as_deref(), Some("Detergent refill"));
            let stored: f64 = sqlx::query_scalar("SELECT amount FROM expenses WHERE id=?")
                .bind(&created.id)
                .fetch_one(f.db.writer_pool().unwrap())
                .await
                .unwrap();
            assert_eq!(stored, 1234.57);
            let audits = audit_rows(&f.db, "expense_created").await;
            assert_eq!(audits[0]["amountMinor"], 123_457);
            assert_eq!(audits[0]["category"], "Supplies");
        });
    }

    #[test]
    fn expense_validation_covers_amount_date_method_and_text() {
        run(async {
            let f = fixture().await;
            let today = days_from_today(0);
            let amount = "between";
            assert!(create_expense(&f.db, &f.staff, expense(&today, "Rent", 0))
                .await
                .unwrap_err()
                .contains(amount));
            assert!(create_expense(&f.db, &f.staff, expense(&today, "Rent", -5))
                .await
                .unwrap_err()
                .contains(amount));
            assert!(create_expense(
                &f.db,
                &f.staff,
                expense(&today, "Rent", MAX_AMOUNT_MINOR + 1)
            )
            .await
            .unwrap_err()
            .contains(amount));
            create_expense(&f.db, &f.staff, expense(&today, "Rent", MAX_AMOUNT_MINOR))
                .await
                .unwrap();
            create_expense(&f.db, &f.staff, expense(&today, "Rent", 1))
                .await
                .unwrap();
            // IST midnight edge: today in shop time is accepted, tomorrow is not, whatever UTC says.
            create_expense(&f.db, &f.staff, expense(&days_from_today(0), "Rent", 100))
                .await
                .unwrap();
            assert!(
                create_expense(&f.db, &f.staff, expense(&days_from_today(1), "Rent", 100))
                    .await
                    .unwrap_err()
                    .contains("future")
            );
            for bad in [
                "",
                "2026-13-01",
                "2026-02-30",
                "31-01-2026",
                "2026-1-5",
                "1999-12-31",
                "2101-01-01",
                "garbage",
            ] {
                assert!(
                    create_expense(&f.db, &f.staff, expense(bad, "Rent", 100))
                        .await
                        .is_err(),
                    "{bad}"
                );
            }
            assert!(create_expense(&f.db, &f.staff, expense(&today, "  ", 100))
                .await
                .unwrap_err()
                .contains("required"));
            assert!(
                create_expense(&f.db, &f.staff, expense(&today, &"c".repeat(61), 100))
                    .await
                    .is_err()
            );
            assert!(create_expense(
                &f.db,
                &f.staff,
                ExpenseInput {
                    description: Some("d".repeat(201)),
                    ..expense(&today, "Rent", 100)
                }
            )
            .await
            .is_err());
            assert!(create_expense(
                &f.db,
                &f.staff,
                ExpenseInput {
                    notes: Some("n".repeat(501)),
                    ..expense(&today, "Rent", 100)
                }
            )
            .await
            .is_err());
            for method in ["credit", "", "CASH", "paypal"] {
                assert!(
                    create_expense(
                        &f.db,
                        &f.staff,
                        ExpenseInput {
                            payment_method: method.into(),
                            ..expense(&today, "Rent", 100)
                        }
                    )
                    .await
                    .unwrap_err()
                    .contains("payment method"),
                    "{method}"
                );
            }
            assert_eq!(count(&f.db, "expenses").await, 3);
        });
    }

    #[test]
    fn expense_list_filters_by_inclusive_ist_dates_and_category() {
        run(async {
            let f = fixture().await;
            for (date, category, amount) in [
                ("2026-01-31", "Rent", 100_000),
                ("2026-02-01", "Rent", 200_000),
                ("2026-02-28", "Power", 30_000),
                ("2026-03-01", "rent", 4_000),
            ] {
                create_expense(&f.db, &f.staff, expense(date, category, amount))
                    .await
                    .unwrap();
            }
            let list = |from: Option<&str>,
                        to: Option<&str>,
                        category: Option<&str>,
                        limit: Option<u32>| {
                list_expenses(
                    &f.db,
                    &f.staff,
                    ExpenseFilter {
                        from: from.map(Into::into),
                        to: to.map(Into::into),
                        category: category.map(Into::into),
                        limit,
                    },
                )
            };
            let all = list(None, None, None, None).await.unwrap();
            assert_eq!((all.matching, all.total_minor), (4, 334_000));
            assert_eq!(all.items[0].expense_date, "2026-03-01", "newest first");
            assert_eq!(
                all.categories,
                ["Power", "Rent"],
                "categories are de-duplicated ignoring case"
            );
            let feb = list(Some("2026-02-01"), Some("2026-02-28"), None, None)
                .await
                .unwrap();
            assert_eq!(
                (feb.matching, feb.total_minor),
                (2, 230_000),
                "both ends are included, the month boundary is not"
            );
            let rent = list(None, None, Some("RENT"), None).await.unwrap();
            assert_eq!((rent.matching, rent.total_minor), (3, 304_000));
            let capped = list(None, None, None, Some(1)).await.unwrap();
            assert_eq!(
                (capped.items.len(), capped.matching, capped.total_minor),
                (1, 4, 334_000),
                "the total covers rows beyond the page"
            );
            let empty = list(Some("2027-01-01"), Some("2027-01-01"), None, None)
                .await
                .unwrap();
            assert_eq!(
                (empty.items.len(), empty.matching, empty.total_minor),
                (0, 0, 0)
            );
            assert!(list(Some("2026-03-02"), Some("2026-03-01"), None, None)
                .await
                .unwrap_err()
                .contains("not be after"));
            assert!(list(Some("bad"), None, None, None).await.is_err());
            assert!(list(None, None, None, Some(0)).await.is_err());
            assert!(list(None, None, None, Some(501)).await.is_err());
            assert!(list(None, None, Some(&"c".repeat(61)), None).await.is_err());
        });
    }

    #[test]
    fn expense_delete_keeps_the_old_row_in_the_audit_trail() {
        run(async {
            let f = fixture().await;
            let e = create_expense(
                &f.db,
                &f.staff,
                ExpenseInput {
                    description: Some("Wrong shop".into()),
                    ..expense("2026-02-03", "Supplies", 77_700)
                },
            )
            .await
            .unwrap();
            delete_expense(&f.db, &f.admin, &e.id, "Entered in error")
                .await
                .unwrap();
            assert_eq!(count(&f.db, "expenses").await, 0);
            let audits = audit_rows(&f.db, "expense_deleted").await;
            assert_eq!(audits.len(), 1);
            assert_eq!(audits[0]["reason"], "Entered in error");
            assert_eq!(audits[0]["expense"]["amountMinor"], 77_700);
            assert_eq!(audits[0]["expense"]["category"], "Supplies");
            assert_eq!(audits[0]["expense"]["expenseDate"], "2026-02-03");
            assert_eq!(audits[0]["expense"]["createdBy"], f.staff_id);
        });
    }

    // ------------------------------------------------------------ inventory

    #[test]
    fn inventory_create_validates_and_logs_opening_stock() {
        run(async {
            let f = fixture().await;
            let created = create_inventory_item(
                &f.db,
                &f.staff,
                InventoryItemInput {
                    purchase_cost_minor: Some(45_050),
                    notes: Some("Blue drum".into()),
                    ..item("  Detergent ", 2.0, Some(10.0))
                },
            )
            .await
            .unwrap();
            assert_eq!(
                (
                    created.name.as_str(),
                    created.current_quantity,
                    created.purchase_cost_minor
                ),
                ("Detergent", 10.0, Some(45_050))
            );
            let txns: Vec<(f64, String, String)> = sqlx::query_as("SELECT change_quantity,transaction_type,reason FROM inventory_transactions WHERE inventory_item_id=?")
                .bind(&created.id).fetch_all(f.db.writer_pool().unwrap()).await.unwrap();
            assert_eq!(
                txns,
                [(10.0, "stock_in".to_string(), "Opening stock".to_string())]
            );
            let none = create_inventory_item(&f.db, &f.staff, item("Hangers", 0.0, None))
                .await
                .unwrap();
            assert_eq!(none.current_quantity, 0.0);
            assert_eq!(
                count(&f.db, "inventory_transactions").await,
                1,
                "no opening stock, no transaction"
            );
            assert!(
                create_inventory_item(&f.db, &f.admin, item("DETERGENT", 1.0, None))
                    .await
                    .unwrap_err()
                    .contains("already exists")
            );
            assert!(create_inventory_item(&f.db, &f.staff, item("", 1.0, None))
                .await
                .unwrap_err()
                .contains("required"));
            assert!(create_inventory_item(
                &f.db,
                &f.staff,
                InventoryItemInput {
                    unit: " ".into(),
                    ..item("A", 1.0, None)
                }
            )
            .await
            .is_err());
            assert!(create_inventory_item(
                &f.db,
                &f.staff,
                InventoryItemInput {
                    unit: "u".repeat(21),
                    ..item("A", 1.0, None)
                }
            )
            .await
            .is_err());
            assert!(
                create_inventory_item(&f.db, &f.staff, item(&"n".repeat(81), 1.0, None))
                    .await
                    .is_err()
            );
            for bad in [-1.0, f64::NAN, f64::INFINITY, 1_000_001.0] {
                assert!(
                    create_inventory_item(&f.db, &f.staff, item("B", bad, None))
                        .await
                        .is_err(),
                    "minimum {bad}"
                );
                assert!(
                    create_inventory_item(&f.db, &f.staff, item("B", 1.0, Some(bad)))
                        .await
                        .is_err(),
                    "opening {bad}"
                );
            }
            for cost in [-1, MAX_AMOUNT_MINOR + 1] {
                assert!(create_inventory_item(
                    &f.db,
                    &f.staff,
                    InventoryItemInput {
                        purchase_cost_minor: Some(cost),
                        ..item("C", 1.0, None)
                    }
                )
                .await
                .unwrap_err()
                .contains("purchase cost"));
            }
            assert!(create_inventory_item(
                &f.db,
                &f.staff,
                InventoryItemInput {
                    notes: Some("n".repeat(501)),
                    ..item("D", 1.0, None)
                }
            )
            .await
            .is_err());
            assert_eq!(count(&f.db, "inventory_items").await, 2);
        });
    }

    #[test]
    fn low_stock_flag_follows_the_minimum() {
        run(async {
            let f = fixture().await;
            let low = create_inventory_item(&f.db, &f.staff, item("Low", 5.0, Some(5.0)))
                .await
                .unwrap();
            let fine = create_inventory_item(&f.db, &f.staff, item("Fine", 5.0, Some(6.0)))
                .await
                .unwrap();
            let unmonitored =
                create_inventory_item(&f.db, &f.staff, item("Unmonitored", 0.0, None))
                    .await
                    .unwrap();
            assert_eq!(
                (low.low_stock, fine.low_stock, unmonitored.low_stock),
                (true, false, false)
            );
            let after = adjust_inventory(&f.db, &f.staff, stock(&fine.id, "stock_out", -1.5))
                .await
                .unwrap();
            assert!(after.low_stock);
            let listed = list_inventory(&f.db, &f.staff).await.unwrap();
            assert_eq!(
                listed
                    .iter()
                    .map(|i| (i.name.as_str(), i.low_stock))
                    .collect::<Vec<_>>(),
                [("Fine", true), ("Low", true), ("Unmonitored", false)]
            );
        });
    }

    #[test]
    fn stock_adjustments_keep_the_transaction_log_equal_to_the_balance() {
        run(async {
            let f = fixture().await;
            let i = create_inventory_item(&f.db, &f.staff, item("Starch", 1.0, Some(0.1)))
                .await
                .unwrap();
            for (kind, change) in [
                ("stock_in", 0.2),
                ("stock_in", 5.0),
                ("stock_out", -2.55),
                ("adjustment", -0.75),
                ("adjustment", 0.4),
            ] {
                adjust_inventory(&f.db, &f.staff, stock(&i.id, kind, change))
                    .await
                    .unwrap();
            }
            let balance = list_inventory(&f.db, &f.staff).await.unwrap()[0].current_quantity;
            let logged: f64 = sqlx::query_scalar("SELECT ROUND(SUM(change_quantity),3) FROM inventory_transactions WHERE inventory_item_id=?")
                .bind(&i.id).fetch_one(f.db.writer_pool().unwrap()).await.unwrap();
            assert_eq!(
                balance, 2.4,
                "0.1+0.2+5-2.55-0.75+0.4 with no floating point drift"
            );
            assert_eq!(balance, logged);
            assert_eq!(count(&f.db, "inventory_transactions").await, 6);
            let audits = audit_rows(&f.db, "inventory_adjusted").await;
            assert_eq!(audits.len(), 5);
            assert_eq!(audits[0]["oldQuantity"], 0.1);
            assert_eq!(audits[0]["newQuantity"], 0.3);
            assert_eq!(audits[0]["reason"], "Weekly count");
        });
    }

    #[test]
    fn stock_can_never_go_negative_and_a_refusal_changes_nothing() {
        run(async {
            let f = fixture().await;
            let i = create_inventory_item(&f.db, &f.staff, item("Bleach", 0.0, Some(3.0)))
                .await
                .unwrap();
            let refused = adjust_inventory(&f.db, &f.staff, stock(&i.id, "stock_out", -3.001))
                .await
                .unwrap_err();
            assert!(
                refused.contains("cannot become negative") && refused.contains("3 kg"),
                "{refused}"
            );
            assert!(
                adjust_inventory(&f.db, &f.staff, stock(&i.id, "adjustment", -1_000_000.0))
                    .await
                    .unwrap_err()
                    .contains("negative")
            );
            let (txns, audits) = (
                count(&f.db, "inventory_transactions").await,
                audit_rows(&f.db, "inventory_adjusted").await.len(),
            );
            assert_eq!((txns, audits), (1, 0));
            assert_eq!(
                list_inventory(&f.db, &f.staff).await.unwrap()[0].current_quantity,
                3.0
            );
            // Exactly to zero is fine.
            assert_eq!(
                adjust_inventory(&f.db, &f.staff, stock(&i.id, "stock_out", -3.0))
                    .await
                    .unwrap()
                    .current_quantity,
                0.0
            );
        });
    }

    #[test]
    fn simultaneous_stock_out_cannot_overdraw() {
        run(async {
            let f = fixture().await;
            let i = create_inventory_item(&f.db, &f.staff, item("Hangers", 0.0, Some(10.0)))
                .await
                .unwrap();
            let mut tasks = Vec::new();
            for _ in 0..4 {
                let (db, session, id) = (f.db.clone(), f.staff.clone(), i.id.clone());
                tasks.push(tauri::async_runtime::spawn(async move {
                    adjust_inventory(&db, &session, stock(&id, "stock_out", -4.0)).await
                }));
            }
            let mut ok = 0;
            for task in tasks {
                if task.await.unwrap().is_ok() {
                    ok += 1;
                }
            }
            assert_eq!(ok, 2, "10 units allow exactly two withdrawals of 4");
            assert_eq!(
                list_inventory(&f.db, &f.staff).await.unwrap()[0].current_quantity,
                2.0
            );
            assert_eq!(count(&f.db, "inventory_transactions").await, 3);
        });
    }

    #[test]
    fn stock_adjustment_validation() {
        run(async {
            let f = fixture().await;
            let i = create_inventory_item(&f.db, &f.staff, item("Soap", 0.0, Some(5.0)))
                .await
                .unwrap();
            assert!(
                adjust_inventory(&f.db, &f.staff, stock(&i.id, "refund", 1.0))
                    .await
                    .unwrap_err()
                    .contains("stock in")
            );
            assert!(
                adjust_inventory(&f.db, &f.staff, stock(&i.id, "adjustment", 0.0))
                    .await
                    .unwrap_err()
                    .contains("zero")
            );
            assert!(
                adjust_inventory(&f.db, &f.staff, stock(&i.id, "adjustment", 0.0004))
                    .await
                    .unwrap_err()
                    .contains("zero"),
                "rounds to zero at 3 decimals"
            );
            assert!(
                adjust_inventory(&f.db, &f.staff, stock(&i.id, "stock_in", -1.0))
                    .await
                    .unwrap_err()
                    .contains("direction")
            );
            assert!(
                adjust_inventory(&f.db, &f.staff, stock(&i.id, "stock_out", 1.0))
                    .await
                    .unwrap_err()
                    .contains("direction")
            );
            for bad in [f64::NAN, f64::INFINITY, 1_000_001.0] {
                assert!(
                    adjust_inventory(&f.db, &f.staff, stock(&i.id, "adjustment", bad))
                        .await
                        .is_err()
                );
            }
            let mut no_reason = stock(&i.id, "stock_in", 1.0);
            no_reason.reason = " x ".into();
            assert!(adjust_inventory(&f.db, &f.staff, no_reason)
                .await
                .unwrap_err()
                .contains("3 to 200"));
            assert!(
                adjust_inventory(&f.db, &f.staff, stock("missing", "stock_in", 1.0))
                    .await
                    .unwrap_err()
                    .contains("not found")
            );
            assert_eq!(count(&f.db, "inventory_transactions").await, 1);
        });
    }

    #[test]
    fn inventory_delete_audits_the_item_and_its_history() {
        run(async {
            let f = fixture().await;
            let i = create_inventory_item(&f.db, &f.staff, item("Softener", 1.0, Some(4.0)))
                .await
                .unwrap();
            adjust_inventory(&f.db, &f.staff, stock(&i.id, "stock_out", -1.5))
                .await
                .unwrap();
            delete_inventory_item(&f.db, &f.admin, &i.id, "Stopped stocking")
                .await
                .unwrap();
            assert_eq!(
                (
                    count(&f.db, "inventory_items").await,
                    count(&f.db, "inventory_transactions").await
                ),
                (0, 0)
            );
            let audits = audit_rows(&f.db, "inventory_item_deleted").await;
            assert_eq!(audits.len(), 1);
            assert_eq!(audits[0]["reason"], "Stopped stocking");
            assert_eq!(audits[0]["item"]["name"], "Softener");
            assert_eq!(audits[0]["item"]["currentQuantity"], 2.5);
            let history = audits[0]["transactions"].as_array().unwrap();
            assert_eq!(history.len(), 2);
            let mut changes: Vec<f64> = history
                .iter()
                .map(|t| t["changeQuantity"].as_f64().unwrap())
                .collect();
            changes.sort_by(|a, b| a.partial_cmp(b).unwrap());
            assert_eq!(changes, [-1.5, 4.0]);
            assert!(history
                .iter()
                .all(|t| t["createdBy"] == serde_json::Value::String(f.staff_id.clone())));
        });
    }

    // ------------------------------------------------------------ machines

    #[test]
    fn machines_record_maintenance_and_flag_what_is_due() {
        run(async {
            let f = fixture().await;
            let overdue = create_machine(
                &f.db,
                &f.staff,
                MachineInput {
                    last_maintenance_date: Some(days_from_today(-60)),
                    next_maintenance_date: Some(days_from_today(-1)),
                    ..machine("B Washer")
                },
            )
            .await
            .unwrap();
            let today = create_machine(
                &f.db,
                &f.staff,
                MachineInput {
                    next_maintenance_date: Some(days_from_today(0)),
                    ..machine("A Dryer")
                },
            )
            .await
            .unwrap();
            let later = create_machine(
                &f.db,
                &f.staff,
                MachineInput {
                    purchase_date: Some("2024-05-01".into()),
                    next_maintenance_date: Some(days_from_today(30)),
                    notes: Some("  Belt noisy ".into()),
                    ..machine("C Iron")
                },
            )
            .await
            .unwrap();
            let never = create_machine(&f.db, &f.staff, machine("D Press"))
                .await
                .unwrap();
            assert!(overdue.maintenance_due && today.maintenance_due);
            assert!(!later.maintenance_due && !never.maintenance_due);
            assert_eq!(later.notes.as_deref(), Some("Belt noisy"));
            let listed = list_machines(&f.db, &f.staff).await.unwrap();
            assert_eq!(
                listed.iter().map(|m| m.name.as_str()).collect::<Vec<_>>(),
                ["B Washer", "A Dryer", "C Iron", "D Press"],
                "soonest maintenance first, unscheduled last"
            );

            // Recording a service: last = today, next = in 90 days, with notes.
            let serviced = update_machine(
                &f.db,
                &f.staff,
                &overdue.id,
                MachineInput {
                    last_maintenance_date: Some(days_from_today(0)),
                    next_maintenance_date: Some(days_from_today(90)),
                    notes: Some("Replaced belt".into()),
                    ..machine("B Washer")
                },
            )
            .await
            .unwrap();
            assert!(!serviced.maintenance_due);
            assert_eq!(serviced.notes.as_deref(), Some("Replaced belt"));
            let audits = audit_rows(&f.db, "machine_updated").await;
            assert_eq!(audits[0]["old"]["nextMaintenanceDate"], days_from_today(-1));
            assert_eq!(audits[0]["new"]["nextMaintenanceDate"], days_from_today(90));
            assert_eq!(audits[0]["new"]["notes"], "Replaced belt");
            assert!(update_machine(&f.db, &f.staff, "missing", machine("X"))
                .await
                .unwrap_err()
                .contains("not found"));
        });
    }

    #[test]
    fn machine_validation() {
        run(async {
            let f = fixture().await;
            assert!(create_machine(&f.db, &f.staff, machine(""))
                .await
                .unwrap_err()
                .contains("required"));
            assert!(create_machine(
                &f.db,
                &f.staff,
                MachineInput {
                    machine_type: " ".into(),
                    ..machine("A")
                }
            )
            .await
            .is_err());
            assert!(create_machine(&f.db, &f.staff, machine(&"n".repeat(81)))
                .await
                .is_err());
            assert!(create_machine(
                &f.db,
                &f.staff,
                MachineInput {
                    machine_type: "t".repeat(41),
                    ..machine("A")
                }
            )
            .await
            .is_err());
            assert!(create_machine(
                &f.db,
                &f.staff,
                MachineInput {
                    capacity: Some("c".repeat(41)),
                    ..machine("A")
                }
            )
            .await
            .is_err());
            assert!(create_machine(
                &f.db,
                &f.staff,
                MachineInput {
                    notes: Some("n".repeat(501)),
                    ..machine("A")
                }
            )
            .await
            .is_err());
            assert!(create_machine(
                &f.db,
                &f.staff,
                MachineInput {
                    purchase_date: Some(days_from_today(1)),
                    ..machine("A")
                }
            )
            .await
            .unwrap_err()
            .contains("purchase date"));
            assert!(create_machine(
                &f.db,
                &f.staff,
                MachineInput {
                    last_maintenance_date: Some(days_from_today(1)),
                    ..machine("A")
                }
            )
            .await
            .unwrap_err()
            .contains("last maintenance"));
            assert!(create_machine(
                &f.db,
                &f.staff,
                MachineInput {
                    last_maintenance_date: Some("2026-02-10".into()),
                    next_maintenance_date: Some("2026-02-09".into()),
                    ..machine("A")
                }
            )
            .await
            .unwrap_err()
            .contains("before the last"));
            assert!(create_machine(
                &f.db,
                &f.staff,
                MachineInput {
                    next_maintenance_date: Some("soon".into()),
                    ..machine("A")
                }
            )
            .await
            .is_err());
            create_machine(
                &f.db,
                &f.staff,
                MachineInput {
                    last_maintenance_date: Some("2026-02-10".into()),
                    next_maintenance_date: Some("2026-02-10".into()),
                    capacity: Some("  ".into()),
                    ..machine("A")
                },
            )
            .await
            .unwrap();
            assert_eq!(count(&f.db, "machines").await, 1);
            assert_eq!(
                list_machines(&f.db, &f.staff).await.unwrap()[0].capacity,
                None
            );
        });
    }

    #[test]
    fn machine_delete_audits_the_old_row() {
        run(async {
            let f = fixture().await;
            let m = create_machine(
                &f.db,
                &f.staff,
                MachineInput {
                    notes: Some("Old but reliable".into()),
                    ..machine("Washer 1")
                },
            )
            .await
            .unwrap();
            delete_machine(&f.db, &f.admin, &m.id, "Sold to another shop")
                .await
                .unwrap();
            assert_eq!(count(&f.db, "machines").await, 0);
            let audits = audit_rows(&f.db, "machine_deleted").await;
            assert_eq!(audits[0]["reason"], "Sold to another shop");
            assert_eq!(audits[0]["machine"]["name"], "Washer 1");
            assert_eq!(audits[0]["machine"]["notes"], "Old but reliable");
        });
    }

    #[test]
    fn writes_are_refused_while_a_restore_is_staged_but_reads_still_work() {
        run(async {
            let f = fixture().await;
            let i = create_inventory_item(&f.db, &f.staff, item("Soap", 0.0, Some(2.0)))
                .await
                .unwrap();
            let c = create_customer(&f.db, &f.staff, customer("A", "9876543210"))
                .await
                .unwrap();
            let e = create_expense(&f.db, &f.staff, expense(&days_from_today(0), "Tea", 500))
                .await
                .unwrap();
            let m = create_machine(&f.db, &f.staff, machine("W")).await.unwrap();
            std::fs::write(
                crate::storage::pending_restore_path_for_tests(&f.dir.join("office.db")),
                b"staged",
            )
            .unwrap();
            let staged = "restore is staged";
            assert!(
                create_customer(&f.db, &f.staff, customer("B", "9876543211"))
                    .await
                    .unwrap_err()
                    .contains(staged)
            );
            assert!(
                update_customer(&f.db, &f.staff, &c.id, customer("C", "9876543210"))
                    .await
                    .unwrap_err()
                    .contains(staged)
            );
            assert!(
                create_expense(&f.db, &f.staff, expense(&days_from_today(0), "Tea", 500))
                    .await
                    .unwrap_err()
                    .contains(staged)
            );
            assert!(
                create_inventory_item(&f.db, &f.staff, item("Other", 0.0, None))
                    .await
                    .unwrap_err()
                    .contains(staged)
            );
            assert!(
                adjust_inventory(&f.db, &f.staff, stock(&i.id, "stock_in", 1.0))
                    .await
                    .unwrap_err()
                    .contains(staged)
            );
            assert!(create_machine(&f.db, &f.staff, machine("X"))
                .await
                .unwrap_err()
                .contains(staged));
            assert!(update_machine(&f.db, &f.staff, &m.id, machine("Y"))
                .await
                .unwrap_err()
                .contains(staged));
            assert!(delete_customer(&f.db, &f.admin, &c.id, "Staged restore")
                .await
                .unwrap_err()
                .contains(staged));
            assert!(delete_expense(&f.db, &f.admin, &e.id, "Staged restore")
                .await
                .unwrap_err()
                .contains(staged));
            assert!(
                delete_inventory_item(&f.db, &f.admin, &i.id, "Staged restore")
                    .await
                    .unwrap_err()
                    .contains(staged)
            );
            assert!(delete_machine(&f.db, &f.admin, &m.id, "Staged restore")
                .await
                .unwrap_err()
                .contains(staged));
            assert_eq!(
                list_customers(&f.db, &f.staff, "", 0, 10)
                    .await
                    .unwrap()
                    .len(),
                1
            );
            assert_eq!(
                list_inventory(&f.db, &f.staff).await.unwrap()[0].current_quantity,
                2.0
            );
        });
    }
}
