//! Read-only insight queries for the counter workspace: the dashboard overview and the sales
//! query (summary, graph series, order list, transaction list).
//!
//! Every command here is open to any signed-in account (staff and administrators see identical
//! figures) and never writes. All amounts are whole paise.
//!
//! # Definitions (binding; the Sales screen repeats the important ones as hints)
//!
//! * **Shop time** is IST (UTC+05:30, no daylight saving). Filters arrive as shop-local
//!   `YYYY-MM-DDTHH:MM` strings and mean the half-open window `[from, to)`.
//! * **Timestamps** are stored in two shapes (`...:00.000Z` by `save_order`, `...+00:00` by
//!   `record_payment` / `cancel_order`), and older rows may use `YYYY-MM-DD HH:MM:SS`. Every
//!   comparison goes through SQLite's `strftime('%s', ...)`, which reads all of them, never
//!   through plain string comparison. A value SQLite cannot read never matches a window.
//! * **Billed** = orders *created* in the window (`received_at`) that are not cancelled today,
//!   unless cancelled orders are asked for. `gross` = subtotal, `discount`, `net billed` = total.
//! * **Collected** = payments *recorded* in the window. **Refunded** = payments whose
//!   `voided_at` falls in the window (the money handed back when an order is cancelled).
//!   History is never rewritten: a payment voided in a later period is a refund *then* and
//!   still collected *when it was taken*. Net collected = collected - refunded. Cash flow does
//!   not depend on `includeCancelled`.
//! * **Cancelled** (count and value) = orders whose cancellation time (the `order_cancelled`
//!   audit row, else the order's last update) falls in the window.
//! * **Expenses** are dated by day, so any expense dated on a day the window touches counts.
//!   Profit = net collected - expenses, and is only given when no narrowing filter is active
//!   (a filtered collected figure minus whole-shop expenses would be meaningless).
//! * **staffId**: billed figures use the order's creator (`orders.created_by`), money figures use
//!   the account that took the payment (`payments.recorded_by`), for refunds too.
//! * **Pieces** counts tagged pieces (`order_pieces`); orders from before piece tracking show 0.
//!
//! Queries read inside one transaction on the single writer connection, so the numbers of one
//! response always come from one consistent snapshot.

use std::collections::BTreeMap;

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveDateTime, Timelike, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};
use tauri::State;

use crate::counter::{
    db_err, digit_value, like_contains, require_actor, strip_country_prefix, CounterSession,
};
use crate::storage::DatabaseState;

/// India Standard Time offset from UTC.
const IST_OFFSET_SECONDS: i64 = 19_800;
/// Widest range any query accepts, so a typo cannot ask for a century of rows.
const MAX_RANGE_DAYS: i64 = 3_660;
const MAX_HOURLY_DAYS: i64 = 31;
const MAX_DAILY_DAYS: i64 = 366;
const MAX_PAGE_SIZE: u32 = 100;
const MAX_OFFSET: u32 = 100_000;
const MAX_TEXT: usize = 100;
/// Ready orders waiting longer than this show up on the dashboard.
const READY_WAITING_SECONDS: i64 = 2 * 24 * 3600;
const ATTENTION_LIMIT: u32 = 20;
const RECENT_ORDERS: u32 = 8;

const METHODS: [&str; 6] = ["cash", "upi", "card", "bank_transfer", "credit", "other"];
const STATUSES: [&str; 9] = [
    "received",
    "washing",
    "drying",
    "ironing",
    "quality_check",
    "packing",
    "ready",
    "collected",
    "cancelled",
];
const IN_PROCESS: [&str; 6] = [
    "received",
    "washing",
    "drying",
    "ironing",
    "quality_check",
    "packing",
];

const GROSS: &str = "CAST(ROUND(o.subtotal * 100) AS INTEGER)";
const DISCOUNT: &str = "CAST(ROUND(o.discount_amount * 100) AS INTEGER)";
const NET: &str = "CAST(ROUND(o.total_amount * 100) AS INTEGER)";
const PIECES: &str = "(SELECT COUNT(*) FROM order_pieces op WHERE op.order_id = o.id)";
const PAID: &str = "COALESCE((SELECT SUM(CAST(ROUND(lp.amount * 100) AS INTEGER)) FROM payments lp WHERE lp.order_id = o.id AND lp.voided_at IS NULL), 0)";
const AMOUNT: &str = "CAST(ROUND(p.amount * 100) AS INTEGER)";

/// SQL for the Unix seconds of a timestamp column in any of the stored shapes.
fn epoch(column: &str) -> String {
    format!("CAST(strftime('%s', {column}) AS INTEGER)")
}

fn in_list(values: &[&str]) -> String {
    values
        .iter()
        .map(|value| format!("'{value}'"))
        .collect::<Vec<_>>()
        .join(",")
}

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesFilter {
    /// Shop-local start, inclusive: `YYYY-MM-DDTHH:MM`.
    pub from: String,
    /// Shop-local end, exclusive: `YYYY-MM-DDTHH:MM`.
    pub to: String,
    #[serde(default)]
    pub payment_methods: Vec<String>,
    #[serde(default)]
    pub statuses: Vec<String>,
    #[serde(default)]
    pub staff_id: Option<String>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub discounted_only: bool,
    #[serde(default)]
    pub include_cancelled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Bucket {
    Hour,
    Day,
    Month,
}

impl Bucket {
    fn parse(text: &str) -> Result<Self, String> {
        match text {
            "hour" => Ok(Self::Hour),
            "day" => Ok(Self::Day),
            "month" => Ok(Self::Month),
            _ => Err("Choose a graph bucket of hour, day or month.".into()),
        }
    }

    /// SQL for the shop-local bucket key of a timestamp column.
    fn key_sql(self, column: &str) -> String {
        let format = match self {
            Self::Hour => "%Y-%m-%dT%H:00",
            Self::Day => "%Y-%m-%d",
            Self::Month => "%Y-%m",
        };
        format!(
            "strftime('{format}', {} + {IST_OFFSET_SECONDS}, 'unixepoch')",
            epoch(column)
        )
    }

    fn max_days(self) -> i64 {
        match self {
            Self::Hour => MAX_HOURLY_DAYS,
            Self::Day => MAX_DAILY_DAYS,
            Self::Month => MAX_RANGE_DAYS,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Hour => "hourly",
            Self::Day => "daily",
            Self::Month => "monthly",
        }
    }
}

/// A validated filter, ready to be turned into SQL. Only integers, whitelisted words and
/// chrono-formatted dates are ever written into SQL text; the three free-text values (staff id,
/// search pattern, phone pattern) are always bound as `?1`, `?2`, `?3`.
struct Scope {
    from_local: NaiveDateTime,
    to_local: NaiveDateTime,
    /// UTC Unix seconds `[from, to)`; `None` means no date restriction (dashboard recents).
    window: Option<(i64, i64)>,
    /// Day-granular bounds for index use on `received_at` (one day wider than the window).
    coarse: Option<(String, String)>,
    staff: Option<String>,
    search: Option<String>,
    phone: Option<String>,
    discounted_only: bool,
    methods: Vec<&'static str>,
    statuses: Vec<&'static str>,
    include_cancelled: bool,
}

fn parse_local(name: &str, text: &str) -> Result<NaiveDateTime, String> {
    let well_shaped = text.len() == 16 && text.is_ascii();
    let parsed = if well_shaped {
        NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M").ok()
    } else {
        None
    };
    parsed
        .filter(|value| (2000..=2100).contains(&value.year()))
        .ok_or_else(|| format!("{name} must be a shop-time date and time like 2026-03-05T09:30."))
}

fn ist_to_epoch(local: NaiveDateTime) -> i64 {
    local.and_utc().timestamp() - IST_OFFSET_SECONDS
}

fn utc_date(seconds: i64) -> String {
    DateTime::from_timestamp(seconds, 0)
        .map(|instant| instant.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

fn whitelist(
    what: &str,
    allowed: &'static [&'static str],
    given: &[String],
) -> Result<Vec<&'static str>, String> {
    if given.len() > allowed.len() {
        return Err(format!("Too many {what} filters."));
    }
    let mut picked: Vec<&'static str> = Vec::new();
    for value in given {
        let found = allowed
            .iter()
            .find(|candidate| **candidate == value.trim())
            .ok_or_else(|| {
                format!(
                    "Unknown {what} '{}'.",
                    value.chars().take(30).collect::<String>()
                )
            })?;
        if !picked.contains(found) {
            picked.push(*found);
        }
    }
    picked.sort_unstable();
    Ok(picked)
}

impl Scope {
    fn parse(filter: &SalesFilter) -> Result<Self, String> {
        let from_local = parse_local("From", &filter.from)?;
        let to_local = parse_local("To", &filter.to)?;
        if to_local <= from_local {
            return Err("The end of the range must be after its start.".into());
        }
        if (to_local - from_local).num_days() > MAX_RANGE_DAYS {
            return Err("Choose a range of at most 10 years.".into());
        }
        let methods = whitelist("payment method", &METHODS, &filter.payment_methods)?;
        let statuses = whitelist("status", &STATUSES, &filter.statuses)?;
        let staff = filter
            .staff_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if staff
            .as_ref()
            .is_some_and(|id| id.chars().count() > MAX_TEXT)
        {
            return Err("The staff filter is invalid.".into());
        }
        let (search, phone) = search_patterns(filter.search.as_deref())?;
        let from_utc = ist_to_epoch(from_local);
        let to_utc = ist_to_epoch(to_local);
        Ok(Self {
            from_local,
            to_local,
            window: Some((from_utc, to_utc)),
            coarse: Some((utc_date(from_utc - 86_400), utc_date(to_utc + 86_400))),
            staff,
            search,
            phone,
            discounted_only: filter.discounted_only,
            methods,
            statuses,
            include_cancelled: filter.include_cancelled,
        })
    }

    /// A window with no other filter (dashboard cards).
    fn plain(from_local: NaiveDateTime, to_local: NaiveDateTime) -> Self {
        let from_utc = ist_to_epoch(from_local);
        let to_utc = ist_to_epoch(to_local);
        Self {
            from_local,
            to_local,
            window: Some((from_utc, to_utc)),
            coarse: Some((utc_date(from_utc - 86_400), utc_date(to_utc + 86_400))),
            staff: None,
            search: None,
            phone: None,
            discounted_only: false,
            methods: Vec::new(),
            statuses: Vec::new(),
            include_cancelled: false,
        }
    }

    /// No date restriction at all, cancelled orders included.
    fn everything() -> Self {
        let epoch_start =
            DateTime::from_timestamp(0, 0).map_or_else(NaiveDateTime::default, |v| v.naive_utc());
        let mut scope = Self::plain(epoch_start, epoch_start + Duration::days(1));
        scope.window = None;
        scope.coarse = None;
        scope.include_cancelled = true;
        scope
    }

    /// True when any filter beyond the date range narrows the result.
    fn narrowed(&self) -> bool {
        self.staff.is_some()
            || self.search.is_some()
            || self.discounted_only
            || !self.methods.is_empty()
            || !self.statuses.is_empty()
    }

    /// Asking for the cancelled status by name implies wanting cancelled orders.
    fn shows_cancelled(&self) -> bool {
        self.include_cancelled || self.statuses.contains(&"cancelled")
    }

    /// Search, discount and payment-method conditions on the order alias `o`.
    fn order_traits(&self, with_method: bool) -> Vec<String> {
        let mut conditions = vec![
            "(?2 IS NULL OR o.order_number LIKE ?2 ESCAPE '\\' OR o.customer_name LIKE ?2 ESCAPE '\\' OR o.customer_phone LIKE ?3 ESCAPE '\\')".to_string(),
        ];
        if self.discounted_only {
            conditions.push(format!("{DISCOUNT} > 0"));
        }
        if with_method && !self.methods.is_empty() {
            conditions.push(format!(
                "EXISTS (SELECT 1 FROM payments pm WHERE pm.order_id = o.id AND pm.method IN ({}))",
                in_list(&self.methods)
            ));
        }
        conditions
    }

    /// WHERE clause for the billed orders (alias `o`).
    fn order_where(&self) -> String {
        let mut conditions = Vec::new();
        if let Some((from, to)) = self.window {
            let created = epoch("o.received_at");
            conditions.push(format!("{created} >= {from} AND {created} < {to}"));
        }
        if let Some((low, high)) = &self.coarse {
            conditions.push(format!(
                "o.received_at >= '{low}' AND o.received_at < '{high}'"
            ));
        }
        conditions.push("(?1 IS NULL OR o.created_by = ?1)".to_string());
        conditions.extend(self.order_traits(true));
        if !self.statuses.is_empty() {
            conditions.push(format!("o.status IN ({})", in_list(&self.statuses)));
        }
        if !self.shows_cancelled() {
            conditions.push("o.status <> 'cancelled'".to_string());
        }
        conditions.join(" AND ")
    }

    /// WHERE clause for cancelled orders, whatever their creation date (alias `o`).
    fn cancelled_where(&self) -> String {
        let mut conditions = vec![
            "o.status = 'cancelled'".to_string(),
            "(?1 IS NULL OR o.created_by = ?1)".to_string(),
        ];
        conditions.extend(self.order_traits(true));
        // A status filter that leaves cancelled orders out also leaves them out of this card.
        if !self.statuses.is_empty() && !self.statuses.contains(&"cancelled") {
            conditions.push("1 = 0".to_string());
        }
        conditions.join(" AND ")
    }

    /// WHERE clause for payment events (aliases `p` and `o`), dated by `event_column`.
    fn payment_where(&self, event_column: &str) -> String {
        let mut conditions = Vec::new();
        if let Some((from, to)) = self.window {
            let at = epoch(event_column);
            conditions.push(format!("{at} >= {from} AND {at} < {to}"));
        }
        conditions.push("(?1 IS NULL OR p.recorded_by = ?1)".to_string());
        conditions.extend(self.order_traits(false));
        if !self.methods.is_empty() {
            conditions.push(format!("p.method IN ({})", in_list(&self.methods)));
        }
        if !self.statuses.is_empty() {
            conditions.push(format!("o.status IN ({})", in_list(&self.statuses)));
        }
        conditions.join(" AND ")
    }

    fn day_span(&self) -> i64 {
        (self.to_local - self.from_local).num_days()
    }
}

/// `%text%` patterns for the order-number/name match and for the phone match. Mirrors the pickup
/// search: a typed phone number ("+91 98765 43210", "98765 43210") also matches the stored digits.
fn search_patterns(search: Option<&str>) -> Result<(Option<String>, Option<String>), String> {
    let text = search.map(str::trim).unwrap_or_default();
    if text.is_empty() {
        return Ok((None, None));
    }
    if text.chars().count() > MAX_TEXT {
        return Err("The search text is too long (100 characters at most).".into());
    }
    let pattern = like_contains(text);
    let digits = strip_country_prefix(
        text.chars()
            .filter_map(digit_value)
            .filter_map(|value| char::from_digit(value, 10))
            .collect(),
    );
    let looks_like_phone = digits.len() >= 3
        && text
            .chars()
            .all(|c| digit_value(c).is_some() || matches!(c, ' ' | '-' | '+' | '.' | '(' | ')'));
    let phone = if looks_like_phone {
        format!("%{digits}%")
    } else {
        pattern.clone()
    };
    Ok((Some(pattern), Some(phone)))
}

fn bind_scope<'q>(
    query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    scope: &'q Scope,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    query
        .bind(scope.staff.as_deref())
        .bind(scope.search.as_deref())
        .bind(scope.phone.as_deref())
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MethodBreakdown {
    pub method: String,
    pub collected_minor: i64,
    pub refunded_minor: i64,
    pub payments: i64,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusBreakdown {
    pub status: String,
    pub orders: i64,
    pub net_billed_minor: i64,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StaffBreakdown {
    pub staff_id: String,
    pub name: Option<String>,
    pub orders: i64,
    pub net_billed_minor: i64,
    pub collected_minor: i64,
    pub refunded_minor: i64,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceBreakdown {
    pub service: String,
    pub pieces: i64,
    /// Line totals before any order-level discount.
    pub amount_minor: i64,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SalesSummary {
    pub orders: i64,
    pub pieces: i64,
    pub gross_minor: i64,
    pub discount_minor: i64,
    pub net_billed_minor: i64,
    pub average_order_minor: i64,
    pub collected_minor: i64,
    pub refunded_minor: i64,
    pub net_collected_minor: i64,
    pub cancelled_count: i64,
    pub cancelled_minor: i64,
    pub expenses_minor: i64,
    /// Net collected minus expenses; `None` while a narrowing filter is active.
    pub profit_minor: Option<i64>,
    pub by_method: Vec<MethodBreakdown>,
    pub by_status: Vec<StatusBreakdown>,
    pub by_staff: Vec<StaffBreakdown>,
    pub by_service: Vec<ServiceBreakdown>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SeriesPoint {
    /// Shop-local bucket key: `YYYY-MM-DDTHH:00`, `YYYY-MM-DD` or `YYYY-MM`.
    pub bucket: String,
    pub orders: i64,
    pub pieces: i64,
    pub gross_minor: i64,
    pub discount_minor: i64,
    pub net_billed_minor: i64,
    pub collected_minor: i64,
    pub refunded_minor: i64,
}

impl SeriesPoint {
    fn empty(bucket: String) -> Self {
        Self {
            bucket,
            orders: 0,
            pieces: 0,
            gross_minor: 0,
            discount_minor: 0,
            net_billed_minor: 0,
            collected_minor: 0,
            refunded_minor: 0,
        }
    }
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SalesSeries {
    pub bucket: String,
    pub points: Vec<SeriesPoint>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SalesOrderRow {
    pub id: String,
    pub order_number: String,
    pub received_at: String,
    pub customer_name: String,
    pub customer_phone: String,
    pub status: String,
    pub piece_count: i64,
    pub gross_minor: i64,
    pub discount_minor: i64,
    pub total_minor: i64,
    /// Live (not voided) payments.
    pub paid_minor: i64,
    pub balance_minor: i64,
    /// Methods of every payment ever recorded on the order.
    pub methods: Vec<String>,
    pub staff_id: Option<String>,
    pub staff_name: Option<String>,
    pub cancelled_at: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TransactionRow {
    /// The payment id; a payment that was later voided appears twice (`payment`, then `refund`).
    pub id: String,
    /// `payment` (money in, dated by when it was taken) or `refund` (dated by when it was voided).
    pub kind: String,
    pub at: String,
    pub amount_minor: i64,
    pub method: String,
    pub reference: Option<String>,
    pub order_id: String,
    pub order_number: String,
    pub customer_name: String,
    pub customer_phone: String,
    pub order_status: String,
    pub staff_id: String,
    pub staff_name: Option<String>,
    pub voided_by_name: Option<String>,
    pub void_reason: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    /// Rows matching the filter in total, across all pages.
    pub total: i64,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StaffOption {
    pub id: String,
    pub full_name: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueueCounts {
    pub received: i64,
    pub in_process: i64,
    pub ready: i64,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttentionOrder {
    pub id: String,
    pub order_number: String,
    pub customer_name: String,
    pub customer_phone: String,
    pub status: String,
    pub piece_count: i64,
    pub promised_at: Option<String>,
    /// When the order became ready (ready list) or was received (in-process list).
    pub since_at: String,
    pub days_waiting: i64,
    pub balance_minor: i64,
    pub overdue: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttentionList {
    pub total: i64,
    pub orders: Vec<AttentionOrder>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DashboardOverview {
    pub generated_at: String,
    /// Today in shop time, `YYYY-MM-DD`.
    pub today_date: String,
    pub month_start_date: String,
    pub today: SalesSummary,
    pub month_to_date: SalesSummary,
    pub queue: QueueCounts,
    pub ready_waiting: AttentionList,
    pub in_process: AttentionList,
    pub low_stock_count: i64,
    pub recent_orders: Vec<SalesOrderRow>,
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

async fn account_names(conn: &mut SqliteConnection) -> Result<BTreeMap<String, String>, String> {
    let rows = sqlx::query("SELECT id, full_name FROM counter_accounts")
        .fetch_all(conn)
        .await
        .map_err(db_err)?;
    rows.iter()
        .map(|row| {
            Ok((
                row.try_get::<String, _>("id").map_err(db_err)?,
                row.try_get::<String, _>("full_name").map_err(db_err)?,
            ))
        })
        .collect()
}

fn int(row: &sqlx::sqlite::SqliteRow, name: &str) -> Result<i64, String> {
    row.try_get::<i64, _>(name).map_err(db_err)
}

fn text(row: &sqlx::sqlite::SqliteRow, name: &str) -> Result<String, String> {
    row.try_get::<String, _>(name).map_err(db_err)
}

fn opt_text(row: &sqlx::sqlite::SqliteRow, name: &str) -> Result<Option<String>, String> {
    row.try_get::<Option<String>, _>(name).map_err(db_err)
}

/// Collected or refunded money, grouped by method and by the account that took the payment.
async fn money_rows(
    conn: &mut SqliteConnection,
    scope: &Scope,
    event_column: &str,
) -> Result<Vec<(String, String, i64, i64)>, String> {
    let sql = format!(
        "SELECT p.method AS method, p.recorded_by AS staff, COUNT(*) AS n, COALESCE(SUM({AMOUNT}), 0) AS amount \
         FROM payments p JOIN orders o ON o.id = p.order_id WHERE {} GROUP BY p.method, p.recorded_by",
        scope.payment_where(event_column)
    );
    let rows = bind_scope(sqlx::query(&sql), scope)
        .fetch_all(conn)
        .await
        .map_err(db_err)?;
    rows.iter()
        .map(|row| {
            Ok((
                text(row, "method")?,
                text(row, "staff")?,
                int(row, "n")?,
                int(row, "amount")?,
            ))
        })
        .collect()
}

/// A single-number query that uses the shared filter binds.
async fn count(conn: &mut SqliteConnection, sql: &str, scope: &Scope) -> Result<i64, String> {
    let row = bind_scope(sqlx::query(sql), scope)
        .fetch_one(conn)
        .await
        .map_err(db_err)?;
    row.try_get::<i64, _>(0).map_err(db_err)
}

async fn expenses_minor(conn: &mut SqliteConnection, scope: &Scope) -> Result<i64, String> {
    let first_day = scope.from_local.date();
    let last_day = (scope.to_local - Duration::minutes(1)).date();
    let sql = format!(
        "SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) FROM expenses \
         WHERE substr(expense_date, 1, 10) >= '{}' AND substr(expense_date, 1, 10) <= '{}'",
        first_day.format("%Y-%m-%d"),
        last_day.format("%Y-%m-%d")
    );
    sqlx::query_scalar(&sql)
        .fetch_one(conn)
        .await
        .map_err(db_err)
}

/// Orders cancelled inside the window, by the time they were cancelled (not created).
async fn cancelled_in_window(
    conn: &mut SqliteConnection,
    scope: &Scope,
) -> Result<(i64, i64), String> {
    let Some((from, to)) = scope.window else {
        return Ok((0, 0));
    };
    let any: i64 =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM orders WHERE status = 'cancelled')")
            .fetch_one(&mut *conn)
            .await
            .map_err(db_err)?;
    if any == 0 {
        return Ok((0, 0));
    }
    let at = epoch("cancelled_at");
    let sql = format!(
        "SELECT COUNT(*) AS n, COALESCE(SUM(net), 0) AS amount FROM ( \
           SELECT {NET} AS net, COALESCE(c.at, o.updated_at) AS cancelled_at FROM orders o \
           LEFT JOIN (SELECT entity_id, MAX(created_at) AS at FROM counter_audit \
                      WHERE action = 'order_cancelled' AND entity_type = 'order' GROUP BY entity_id) c \
             ON c.entity_id = o.id \
           WHERE {}) \
         WHERE {at} >= {from} AND {at} < {to}",
        scope.cancelled_where()
    );
    let row = bind_scope(sqlx::query(&sql), scope)
        .fetch_one(conn)
        .await
        .map_err(db_err)?;
    Ok((int(&row, "n")?, int(&row, "amount")?))
}

/// `with_services` skips the per-service breakdown, which reads every order line (the dashboard
/// cards do not show it).
async fn summary_inner(
    conn: &mut SqliteConnection,
    scope: &Scope,
    with_services: bool,
) -> Result<SalesSummary, String> {
    let names = account_names(conn).await?;

    let sql = format!(
        "SELECT status, COUNT(*) AS n, COALESCE(SUM(g), 0) AS g, COALESCE(SUM(d), 0) AS d, \
                COALESCE(SUM(t), 0) AS t, COALESCE(SUM(pc), 0) AS pc \
         FROM (SELECT o.status AS status, {GROSS} AS g, {DISCOUNT} AS d, {NET} AS t, {PIECES} AS pc \
               FROM orders o WHERE {}) GROUP BY status",
        scope.order_where()
    );
    let status_rows = bind_scope(sqlx::query(&sql), scope)
        .fetch_all(&mut *conn)
        .await
        .map_err(db_err)?;
    let (mut orders, mut pieces, mut gross, mut discount, mut net) = (0, 0, 0, 0, 0);
    let mut by_status = Vec::new();
    for row in &status_rows {
        orders += int(row, "n")?;
        gross += int(row, "g")?;
        discount += int(row, "d")?;
        net += int(row, "t")?;
        pieces += int(row, "pc")?;
        by_status.push(StatusBreakdown {
            status: text(row, "status")?,
            orders: int(row, "n")?,
            net_billed_minor: int(row, "t")?,
        });
    }
    by_status.sort_by(|a, b| {
        b.orders
            .cmp(&a.orders)
            .then_with(|| a.status.cmp(&b.status))
    });

    let sql = format!(
        "SELECT staff, COUNT(*) AS n, COALESCE(SUM(t), 0) AS t \
         FROM (SELECT o.created_by AS staff, {NET} AS t FROM orders o WHERE {}) GROUP BY staff",
        scope.order_where()
    );
    let billed_by_staff = bind_scope(sqlx::query(&sql), scope)
        .fetch_all(&mut *conn)
        .await
        .map_err(db_err)?;

    let collected = money_rows(conn, scope, "p.recorded_at").await?;
    let refunded = money_rows(conn, scope, "p.voided_at").await?;

    let mut methods: BTreeMap<String, MethodBreakdown> = BTreeMap::new();
    let mut staff: BTreeMap<String, StaffBreakdown> = BTreeMap::new();
    let staff_entry = |staff: &mut BTreeMap<String, StaffBreakdown>, id: &str| {
        staff
            .entry(id.to_string())
            .or_insert_with(|| StaffBreakdown {
                staff_id: id.to_string(),
                name: names.get(id).cloned(),
                orders: 0,
                net_billed_minor: 0,
                collected_minor: 0,
                refunded_minor: 0,
            })
            .clone()
    };
    for row in &billed_by_staff {
        let id = opt_text(row, "staff")?.unwrap_or_default();
        let mut entry = staff_entry(&mut staff, &id);
        entry.orders = int(row, "n")?;
        entry.net_billed_minor = int(row, "t")?;
        staff.insert(id, entry);
    }
    let (mut collected_total, mut refunded_total) = (0, 0);
    for (rows, is_collected) in [(&collected, true), (&refunded, false)] {
        for (method, staff_id, count, amount) in rows {
            let entry = methods
                .entry(method.clone())
                .or_insert_with(|| MethodBreakdown {
                    method: method.clone(),
                    collected_minor: 0,
                    refunded_minor: 0,
                    payments: 0,
                });
            let mut person = staff_entry(&mut staff, staff_id);
            if is_collected {
                entry.collected_minor += amount;
                entry.payments += count;
                person.collected_minor += amount;
                collected_total += amount;
            } else {
                entry.refunded_minor += amount;
                person.refunded_minor += amount;
                refunded_total += amount;
            }
            staff.insert(staff_id.clone(), person);
        }
    }
    let mut by_method: Vec<_> = methods.into_values().collect();
    by_method.sort_by(|a, b| {
        b.collected_minor
            .cmp(&a.collected_minor)
            .then_with(|| a.method.cmp(&b.method))
    });
    let mut by_staff: Vec<_> = staff.into_values().collect();
    by_staff.sort_by(|a, b| {
        b.net_billed_minor
            .cmp(&a.net_billed_minor)
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.staff_id.cmp(&b.staff_id))
    });

    let sql = format!(
        "SELECT oi.service_name AS service, \
                COALESCE(SUM(CASE WHEN oi.service_type IN ('piece', 'combined') THEN CAST(oi.quantity AS INTEGER) ELSE 0 END), 0) AS pieces, \
                COALESCE(SUM(COALESCE(oi.line_total_minor, CAST(ROUND(oi.line_total * 100) AS INTEGER))), 0) AS amount \
         FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE {} GROUP BY oi.service_name",
        scope.order_where()
    );
    let service_rows = if with_services {
        bind_scope(sqlx::query(&sql), scope)
            .fetch_all(&mut *conn)
            .await
            .map_err(db_err)?
    } else {
        Vec::new()
    };
    let mut by_service = service_rows
        .iter()
        .map(|row| {
            Ok(ServiceBreakdown {
                service: text(row, "service")?,
                pieces: int(row, "pieces")?,
                amount_minor: int(row, "amount")?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    by_service.sort_by(|a, b| {
        b.amount_minor
            .cmp(&a.amount_minor)
            .then_with(|| a.service.cmp(&b.service))
    });

    let (cancelled_count, cancelled_minor) = cancelled_in_window(conn, scope).await?;
    let expenses = expenses_minor(conn, scope).await?;
    let net_collected = collected_total - refunded_total;
    Ok(SalesSummary {
        orders,
        pieces,
        gross_minor: gross,
        discount_minor: discount,
        net_billed_minor: net,
        average_order_minor: if orders == 0 {
            0
        } else {
            (net + orders / 2) / orders
        },
        collected_minor: collected_total,
        refunded_minor: refunded_total,
        net_collected_minor: net_collected,
        cancelled_count,
        cancelled_minor,
        expenses_minor: expenses,
        profit_minor: (!scope.narrowed()).then_some(net_collected - expenses),
        by_method,
        by_status,
        by_staff,
        by_service,
    })
}

/// Every bucket key from the one holding `from` through the one holding the last minute before
/// `to`, so quiet hours and days appear as zeros on the graph.
fn bucket_keys(from: NaiveDateTime, to: NaiveDateTime, bucket: Bucket) -> Vec<String> {
    let last = to - Duration::minutes(1);
    let mut keys = Vec::new();
    match bucket {
        Bucket::Hour => {
            let mut at = from.with_minute(0).unwrap_or(from);
            while at <= last {
                keys.push(at.format("%Y-%m-%dT%H:00").to_string());
                at += Duration::hours(1);
            }
        }
        Bucket::Day => {
            let mut day = from.date();
            while day <= last.date() {
                keys.push(day.format("%Y-%m-%d").to_string());
                day += Duration::days(1);
            }
        }
        Bucket::Month => {
            let (mut year, mut month) = (from.year(), from.month());
            while (year, month) <= (last.year(), last.month()) {
                keys.push(format!("{year:04}-{month:02}"));
                (year, month) = if month == 12 {
                    (year + 1, 1)
                } else {
                    (year, month + 1)
                };
            }
        }
    }
    keys
}

async fn series_inner(
    conn: &mut SqliteConnection,
    scope: &Scope,
    bucket: Bucket,
) -> Result<SalesSeries, String> {
    if scope.day_span() > bucket.max_days() {
        return Err(format!(
            "A {} graph can cover at most {} days. Choose a shorter range or a wider bucket.",
            bucket.label(),
            bucket.max_days()
        ));
    }
    let mut points: BTreeMap<String, SeriesPoint> =
        bucket_keys(scope.from_local, scope.to_local, bucket)
            .into_iter()
            .map(|key| (key.clone(), SeriesPoint::empty(key)))
            .collect();

    let sql = format!(
        "SELECT b, COUNT(*) AS n, COALESCE(SUM(g), 0) AS g, COALESCE(SUM(d), 0) AS d, \
                COALESCE(SUM(t), 0) AS t, COALESCE(SUM(pc), 0) AS pc \
         FROM (SELECT {} AS b, {GROSS} AS g, {DISCOUNT} AS d, {NET} AS t, {PIECES} AS pc \
               FROM orders o WHERE {}) GROUP BY b",
        bucket.key_sql("o.received_at"),
        scope.order_where()
    );
    let rows = bind_scope(sqlx::query(&sql), scope)
        .fetch_all(&mut *conn)
        .await
        .map_err(db_err)?;
    for row in &rows {
        if let Some(point) = points.get_mut(&text(row, "b")?) {
            point.orders = int(row, "n")?;
            point.pieces = int(row, "pc")?;
            point.gross_minor = int(row, "g")?;
            point.discount_minor = int(row, "d")?;
            point.net_billed_minor = int(row, "t")?;
        }
    }
    for (column, refunds) in [("p.recorded_at", false), ("p.voided_at", true)] {
        let sql = format!(
            "SELECT {} AS b, COALESCE(SUM({AMOUNT}), 0) AS amount \
             FROM payments p JOIN orders o ON o.id = p.order_id WHERE {} GROUP BY b",
            bucket.key_sql(column),
            scope.payment_where(column)
        );
        let rows = bind_scope(sqlx::query(&sql), scope)
            .fetch_all(&mut *conn)
            .await
            .map_err(db_err)?;
        for row in &rows {
            if let Some(point) = points.get_mut(&text(row, "b")?) {
                if refunds {
                    point.refunded_minor = int(row, "amount")?;
                } else {
                    point.collected_minor = int(row, "amount")?;
                }
            }
        }
    }
    Ok(SalesSeries {
        bucket: match bucket {
            Bucket::Hour => "hour",
            Bucket::Day => "day",
            Bucket::Month => "month",
        }
        .into(),
        points: points.into_values().collect(),
    })
}

fn order_row(
    row: &sqlx::sqlite::SqliteRow,
    cancelled_at: &BTreeMap<String, String>,
) -> Result<SalesOrderRow, String> {
    let id = text(row, "id")?;
    let status = text(row, "status")?;
    let total = int(row, "t")?;
    let paid = int(row, "paid")?;
    let cancelled = status == "cancelled";
    let mut methods: Vec<String> = opt_text(row, "methods")?
        .map(|joined| joined.split(',').map(str::to_string).collect())
        .unwrap_or_default();
    methods.sort();
    Ok(SalesOrderRow {
        cancelled_at: cancelled
            .then(|| {
                cancelled_at
                    .get(&id)
                    .cloned()
                    .or_else(|| opt_text(row, "updated_at").ok().flatten())
            })
            .flatten(),
        id,
        order_number: text(row, "order_number")?,
        received_at: text(row, "received_at")?,
        customer_name: text(row, "customer_name")?,
        customer_phone: text(row, "customer_phone")?,
        piece_count: int(row, "pc")?,
        gross_minor: int(row, "g")?,
        discount_minor: int(row, "d")?,
        total_minor: total,
        paid_minor: paid,
        balance_minor: if cancelled { 0 } else { (total - paid).max(0) },
        methods,
        staff_id: opt_text(row, "created_by")?,
        staff_name: opt_text(row, "staff_name")?,
        status,
    })
}

/// When each cancelled order was cancelled (one pass over the small set of cancellation rows).
async fn cancellation_times(
    conn: &mut SqliteConnection,
) -> Result<BTreeMap<String, String>, String> {
    let rows = sqlx::query(
        "SELECT entity_id, MAX(created_at) AS at FROM counter_audit \
         WHERE action = 'order_cancelled' AND entity_type = 'order' GROUP BY entity_id",
    )
    .fetch_all(conn)
    .await
    .map_err(db_err)?;
    rows.iter()
        .map(|row| Ok((text(row, "entity_id")?, text(row, "at")?)))
        .collect()
}

async fn order_rows(
    conn: &mut SqliteConnection,
    scope: &Scope,
    exact_order: bool,
    limit: u32,
    offset: u32,
) -> Result<Vec<SalesOrderRow>, String> {
    // Exact ordering sorts on the parsed instant so mixed timestamp shapes interleave correctly;
    // the dashboard's "recent" list walks the `received_at` index instead.
    let order_by = if exact_order {
        format!("{} DESC, o.id DESC", epoch("o.received_at"))
    } else {
        "o.received_at DESC, o.id DESC".to_string()
    };
    let sql = format!(
        "SELECT o.id, o.order_number, o.received_at, o.updated_at, o.customer_name, o.customer_phone, \
                o.status, o.created_by, \
                (SELECT a.full_name FROM counter_accounts a WHERE a.id = o.created_by) AS staff_name, \
                {GROSS} AS g, {DISCOUNT} AS d, {NET} AS t, {PIECES} AS pc, {PAID} AS paid, \
                (SELECT group_concat(DISTINCT ap.method) FROM payments ap WHERE ap.order_id = o.id) AS methods \
         FROM orders o WHERE {} ORDER BY {order_by} LIMIT {limit} OFFSET {offset}",
        scope.order_where()
    );
    let rows = bind_scope(sqlx::query(&sql), scope)
        .fetch_all(&mut *conn)
        .await
        .map_err(db_err)?;
    let any_cancelled = rows.iter().any(|row| {
        row.try_get::<String, _>("status")
            .is_ok_and(|s| s == "cancelled")
    });
    let cancelled_at = if any_cancelled {
        cancellation_times(conn).await?
    } else {
        BTreeMap::new()
    };
    rows.iter()
        .map(|row| order_row(row, &cancelled_at))
        .collect()
}

fn page_bounds(offset: u32, limit: u32) -> Result<(), String> {
    if offset > MAX_OFFSET || !(1..=MAX_PAGE_SIZE).contains(&limit) {
        return Err(format!(
            "Choose a page of 1 to {MAX_PAGE_SIZE} rows starting at most {MAX_OFFSET} rows in."
        ));
    }
    Ok(())
}

fn transaction_sides(scope: &Scope) -> String {
    let side = |kind: &str, column: &str| {
        format!(
            "SELECT p.id AS id, '{kind}' AS kind, {column} AS at, {} AS at_s, {AMOUNT} AS amount, \
                    p.method AS method, p.reference_number AS reference, p.order_id AS order_id, \
                    o.order_number AS order_number, o.customer_name AS customer_name, \
                    o.customer_phone AS customer_phone, o.status AS order_status, \
                    p.recorded_by AS staff_id, p.voided_by AS voided_by, p.void_reason AS void_reason \
             FROM payments p JOIN orders o ON o.id = p.order_id WHERE {}",
            epoch(column),
            scope.payment_where(column)
        )
    };
    format!(
        "{} UNION ALL {}",
        side("payment", "p.recorded_at"),
        side("refund", "p.voided_at")
    )
}

async fn transactions_inner(
    conn: &mut SqliteConnection,
    scope: &Scope,
    offset: u32,
    limit: u32,
) -> Result<Page<TransactionRow>, String> {
    let sides = transaction_sides(scope);
    let total = count(conn, &format!("SELECT COUNT(*) FROM ({sides})"), scope).await?;
    let sql = format!(
        "SELECT t.*, (SELECT full_name FROM counter_accounts WHERE id = t.staff_id) AS staff_name, \
                (SELECT full_name FROM counter_accounts WHERE id = t.voided_by) AS voided_by_name \
         FROM ({sides}) t ORDER BY t.at_s DESC, t.id DESC, t.kind DESC LIMIT {limit} OFFSET {offset}"
    );
    let rows = bind_scope(sqlx::query(&sql), scope)
        .fetch_all(&mut *conn)
        .await
        .map_err(db_err)?;
    let items = rows
        .iter()
        .map(|row| {
            Ok(TransactionRow {
                id: text(row, "id")?,
                kind: text(row, "kind")?,
                at: text(row, "at")?,
                amount_minor: int(row, "amount")?,
                method: text(row, "method")?,
                reference: opt_text(row, "reference")?,
                order_id: text(row, "order_id")?,
                order_number: text(row, "order_number")?,
                customer_name: text(row, "customer_name")?,
                customer_phone: text(row, "customer_phone")?,
                order_status: text(row, "order_status")?,
                staff_id: text(row, "staff_id")?,
                staff_name: opt_text(row, "staff_name")?,
                voided_by_name: opt_text(row, "voided_by_name")?,
                void_reason: opt_text(row, "void_reason")?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Page { items, total })
}

async fn attention(
    conn: &mut SqliteConnection,
    ready: bool,
    now: i64,
) -> Result<AttentionList, String> {
    // An order became ready at its last status change; the audit row says when, and the order's
    // own update time covers rows that have none.
    let since = "COALESCE(rs.at, o.updated_at)";
    let (statuses, since_expr, join, condition, order_by) = if ready {
        (
            "'ready'".to_string(),
            since.to_string(),
            "LEFT JOIN (SELECT entity_id, MAX(created_at) AS at FROM counter_audit \
                        WHERE action = 'order_status_changed' AND entity_type = 'order' GROUP BY entity_id) rs \
               ON rs.entity_id = o.id",
            format!("AND {} <= {}", epoch(since), now - READY_WAITING_SECONDS),
            format!("{} ASC, o.id", epoch(since)),
        )
    } else {
        (
            in_list(&IN_PROCESS),
            "o.received_at".to_string(),
            "",
            String::new(),
            format!(
                "CASE WHEN o.expected_ready_at IS NULL THEN 1 ELSE 0 END, {} ASC, o.id",
                epoch("o.expected_ready_at")
            ),
        )
    };
    let from = format!(
        "FROM orders o {join} \
         WHERE o.status IN ({statuses}) AND EXISTS (SELECT 1 FROM order_pieces op WHERE op.order_id = o.id) {condition}"
    );
    let total: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) {from}"))
        .fetch_one(&mut *conn)
        .await
        .map_err(db_err)?;
    let sql = format!(
        "SELECT o.id, o.order_number, o.customer_name, o.customer_phone, o.status, o.expected_ready_at, \
                {since_expr} AS since_at, {NET} AS t, {PAID} AS paid, {PIECES} AS pc {from} \
         ORDER BY {order_by} LIMIT {ATTENTION_LIMIT}"
    );
    let rows = sqlx::query(&sql).fetch_all(conn).await.map_err(db_err)?;
    let orders = rows
        .iter()
        .map(|row| {
            let since_at = text(row, "since_at")?;
            let promised_at = opt_text(row, "expected_ready_at")?;
            let since_seconds = parse_instant(&since_at).unwrap_or(now);
            let overdue = promised_at
                .as_deref()
                .and_then(parse_instant)
                .is_some_and(|promised| promised < now);
            Ok(AttentionOrder {
                id: text(row, "id")?,
                order_number: text(row, "order_number")?,
                customer_name: text(row, "customer_name")?,
                customer_phone: text(row, "customer_phone")?,
                status: text(row, "status")?,
                piece_count: int(row, "pc")?,
                days_waiting: ((now - since_seconds) / 86_400).max(0),
                balance_minor: (int(row, "t")? - int(row, "paid")?).max(0),
                overdue: overdue && !ready,
                promised_at,
                since_at,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(AttentionList { total, orders })
}

/// Unix seconds of a stored timestamp, in any of its shapes.
fn parse_instant(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .map(|instant| instant.timestamp())
        .ok()
        .or_else(|| {
            NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
                .ok()
                .map(|naive| naive.and_utc().timestamp())
        })
}

async fn overview_inner(
    conn: &mut SqliteConnection,
    now: DateTime<Utc>,
) -> Result<DashboardOverview, String> {
    let shop_now = now.naive_utc() + Duration::seconds(IST_OFFSET_SECONDS);
    let today: NaiveDate = shop_now.date();
    let month_start = today.with_day(1).unwrap_or(today);
    let midnight = |date: NaiveDate| date.and_hms_opt(0, 0, 0).unwrap_or_default();
    let tomorrow = today + Duration::days(1);
    let today_summary = summary_inner(
        conn,
        &Scope::plain(midnight(today), midnight(tomorrow)),
        false,
    )
    .await?;
    let month_summary = summary_inner(
        conn,
        &Scope::plain(midnight(month_start), midnight(tomorrow)),
        false,
    )
    .await?;

    let counts = sqlx::query("SELECT status, COUNT(*) AS n FROM orders o WHERE status IN ('received','washing','drying','ironing','quality_check','packing','ready') AND EXISTS (SELECT 1 FROM order_pieces op WHERE op.order_id = o.id) GROUP BY status")
        .fetch_all(&mut *conn)
        .await
        .map_err(db_err)?;
    let mut queue = QueueCounts {
        received: 0,
        in_process: 0,
        ready: 0,
    };
    for row in &counts {
        let n = int(row, "n")?;
        match text(row, "status")?.as_str() {
            "received" => queue.received = n,
            "ready" => queue.ready = n,
            _ => queue.in_process += n,
        }
    }
    let now_seconds = now.timestamp();
    let ready_waiting = attention(conn, true, now_seconds).await?;
    let in_process = attention(conn, false, now_seconds).await?;
    let low_stock_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM inventory_items WHERE minimum_quantity > 0 AND current_quantity <= minimum_quantity",
    )
    .fetch_one(&mut *conn)
    .await
    .map_err(db_err)?;
    let recent_orders = order_rows(conn, &Scope::everything(), false, RECENT_ORDERS, 0).await?;
    Ok(DashboardOverview {
        generated_at: now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        today_date: today.format("%Y-%m-%d").to_string(),
        month_start_date: month_start.format("%Y-%m-%d").to_string(),
        today: today_summary,
        month_to_date: month_summary,
        queue,
        ready_waiting,
        in_process,
        low_stock_count,
        recent_orders,
    })
}

// ---------------------------------------------------------------------------------------------
// Public API (session check, one read transaction)
// ---------------------------------------------------------------------------------------------

macro_rules! read_snapshot {
    ($db:expr, $session:expr, |$conn:ident| $body:expr) => {{
        require_actor($session)?;
        let mut tx = $db.writer_pool()?.begin().await.map_err(db_err)?;
        let $conn: &mut SqliteConnection = &mut tx;
        let result = $body;
        // Nothing was written; releasing the snapshot is all that is left to do.
        tx.rollback().await.map_err(db_err)?;
        result
    }};
}

pub async fn dashboard_overview_at(
    db: &DatabaseState,
    session: &CounterSession,
    now: DateTime<Utc>,
) -> Result<DashboardOverview, String> {
    read_snapshot!(db, session, |conn| overview_inner(conn, now).await)
}

pub async fn sales_summary(
    db: &DatabaseState,
    session: &CounterSession,
    filter: &SalesFilter,
) -> Result<SalesSummary, String> {
    require_actor(session)?;
    let scope = Scope::parse(filter)?;
    read_snapshot!(db, session, |conn| summary_inner(conn, &scope, true).await)
}

pub async fn sales_series(
    db: &DatabaseState,
    session: &CounterSession,
    filter: &SalesFilter,
    bucket: &str,
) -> Result<SalesSeries, String> {
    require_actor(session)?;
    let bucket = Bucket::parse(bucket)?;
    let scope = Scope::parse(filter)?;
    read_snapshot!(db, session, |conn| series_inner(conn, &scope, bucket).await)
}

pub async fn sales_orders(
    db: &DatabaseState,
    session: &CounterSession,
    filter: &SalesFilter,
    offset: u32,
    limit: u32,
) -> Result<Page<SalesOrderRow>, String> {
    require_actor(session)?;
    page_bounds(offset, limit)?;
    let scope = Scope::parse(filter)?;
    read_snapshot!(db, session, |conn| {
        let sql = format!(
            "SELECT COUNT(*) FROM orders o WHERE {}",
            scope.order_where()
        );
        let total = count(conn, &sql, &scope).await?;
        order_rows(conn, &scope, true, limit, offset)
            .await
            .map(|items| Page { items, total })
    })
}

pub async fn sales_transactions(
    db: &DatabaseState,
    session: &CounterSession,
    filter: &SalesFilter,
    offset: u32,
    limit: u32,
) -> Result<Page<TransactionRow>, String> {
    require_actor(session)?;
    page_bounds(offset, limit)?;
    let scope = Scope::parse(filter)?;
    read_snapshot!(db, session, |conn| transactions_inner(
        conn, &scope, offset, limit
    )
    .await)
}

/// Accounts that appear on any order or payment (so the Staff filter only offers people with
/// sales), names only. Includes deactivated accounts: their history is still searchable.
pub async fn sales_staff_options(
    db: &DatabaseState,
    session: &CounterSession,
) -> Result<Vec<StaffOption>, String> {
    read_snapshot!(db, session, |conn| {
        let rows = sqlx::query(
            "SELECT id, full_name FROM counter_accounts \
             WHERE id IN (SELECT created_by FROM orders UNION SELECT recorded_by FROM payments) \
             ORDER BY full_name COLLATE NOCASE, id",
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db_err)?;
        rows.iter()
            .map(|row| {
                Ok(StaffOption {
                    id: text(row, "id")?,
                    full_name: text(row, "full_name")?,
                })
            })
            .collect::<Result<Vec<_>, String>>()
    })
}

// ---------------------------------------------------------------------------------------------
// Tauri commands (registered in lib.rs as `insights::<name>`)
// ---------------------------------------------------------------------------------------------

#[tauri::command]
pub async fn counter_dashboard_overview(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
) -> Result<DashboardOverview, String> {
    dashboard_overview_at(&state, &session, Utc::now()).await
}

#[tauri::command]
pub async fn counter_sales_summary(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    filter: SalesFilter,
) -> Result<SalesSummary, String> {
    sales_summary(&state, &session, &filter).await
}

#[tauri::command]
pub async fn counter_sales_series(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    filter: SalesFilter,
    bucket: String,
) -> Result<SalesSeries, String> {
    sales_series(&state, &session, &filter, &bucket).await
}

#[tauri::command]
pub async fn counter_sales_orders(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    filter: SalesFilter,
    offset: u32,
    limit: u32,
) -> Result<Page<SalesOrderRow>, String> {
    sales_orders(&state, &session, &filter, offset, limit).await
}

#[tauri::command]
pub async fn counter_sales_transactions(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    filter: SalesFilter,
    offset: u32,
    limit: u32,
) -> Result<Page<TransactionRow>, String> {
    sales_transactions(&state, &session, &filter, offset, limit).await
}

#[tauri::command]
pub async fn counter_sales_staff_options(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
) -> Result<Vec<StaffOption>, String> {
    sales_staff_options(&state, &session).await
}

#[cfg(test)]
mod tests;
