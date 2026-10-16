//! Shop settings: the five values an administrator may edit and the bill header built from them.
//!
//! `app_settings` is a general key/value table that also holds `device_id` and the backup
//! bookkeeping. Nothing here reads or writes a key outside [`EDITABLE_KEYS`], and the save command
//! takes a typed struct that refuses unknown fields, so a forged request cannot reach the others.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::counter::{audit_details, db_err, require_actor, require_admin_in_tx, CounterSession};
use crate::printing::{
    tenths_mm, BillHeader, MAX_HEADER_FIELD_CHARS, MAX_TAG_LENGTH_TENTHS_MM,
    MIN_TAG_LENGTH_TENTHS_MM,
};
use crate::storage::DatabaseState;

/// The only `app_settings` keys this module reads for the screen or writes.
pub const EDITABLE_KEYS: [&str; 14] = [
    "shop_name",
    "shop_address",
    "shop_phone",
    "receipt_footer",
    "order_prefix",
    "print_shop_name_on_bill",
    "print_shop_address",
    "print_shop_phone",
    "print_customer_phone",
    "print_received_at",
    "print_ready_by",
    "print_shop_name_on_tags",
    "tag_line",
    "tag_length_mm",
];

const DEFAULT_SHOP_NAME: &str = "Smart Laundry";
const DEFAULT_ORDER_PREFIX: &str = "LA";
const MAX_NAME_CHARS: usize = 60;
const MAX_ADDRESS_CHARS: usize = 120;
const MAX_PHONE_CHARS: usize = 20;
const MAX_FOOTER_CHARS: usize = 120;
const MAX_PREFIX_CHARS: usize = 6;
const MAX_TAG_LINE_CHARS: usize = 40;
const DEFAULT_TAG_LENGTH_TENTHS_MM: u16 = 1016;

/// What the settings screen shows and saves. `deny_unknown_fields` is the whitelist: a request
/// naming any other setting (for example `deviceId`) fails to parse and writes nothing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShopSettings {
    pub shop_name: String,
    pub shop_address: String,
    pub shop_phone: String,
    pub receipt_footer: String,
    pub order_prefix: String,
    #[serde(default = "default_true")]
    pub print_shop_name_on_bill: bool,
    #[serde(default = "default_true")]
    pub print_shop_address: bool,
    #[serde(default = "default_true")]
    pub print_shop_phone: bool,
    #[serde(default = "default_true")]
    pub print_customer_phone: bool,
    #[serde(default = "default_true")]
    pub print_received_at: bool,
    #[serde(default = "default_true")]
    pub print_ready_by: bool,
    #[serde(default)]
    pub print_shop_name_on_tags: bool,
    #[serde(default)]
    pub tag_line: String,
    #[serde(
        default = "default_tag_length_tenths_mm",
        with = "tenths_mm",
        rename = "tagLengthMm"
    )]
    pub tag_length_tenths_mm: u16,
}

impl ShopSettings {
    fn from_pairs(pairs: &[(String, String)]) -> Self {
        let value = |key: &str| {
            pairs
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v.trim().to_string())
                .unwrap_or_default()
        };
        let or_default = |text: String, default: &str| {
            if text.is_empty() {
                default.to_string()
            } else {
                text
            }
        };
        let flag = |key: &str, default: bool| {
            let stored = value(key);
            if stored.is_empty() {
                default
            } else {
                stored == "true" || stored == "1"
            }
        };
        let tag_length_tenths_mm = value("tag_length_mm")
            .parse::<f64>()
            .ok()
            .filter(|mm| mm.is_finite() && (30.0..=200.0).contains(mm))
            .map(|mm| (mm * 10.0).round() as u16)
            .unwrap_or(DEFAULT_TAG_LENGTH_TENTHS_MM);
        Self {
            shop_name: or_default(value("shop_name"), DEFAULT_SHOP_NAME),
            shop_address: value("shop_address"),
            shop_phone: value("shop_phone"),
            receipt_footer: value("receipt_footer"),
            order_prefix: or_default(value("order_prefix"), DEFAULT_ORDER_PREFIX),
            print_shop_name_on_bill: flag("print_shop_name_on_bill", true),
            print_shop_address: flag("print_shop_address", true),
            print_shop_phone: flag("print_shop_phone", true),
            print_customer_phone: flag("print_customer_phone", true),
            print_received_at: flag("print_received_at", true),
            print_ready_by: flag("print_ready_by", true),
            print_shop_name_on_tags: flag("print_shop_name_on_tags", false),
            tag_line: value("tag_line"),
            tag_length_tenths_mm,
        }
    }

    /// Values in the same order as [`EDITABLE_KEYS`].
    fn entries(&self) -> Vec<(&'static str, String)> {
        vec![
            ("shop_name", self.shop_name.clone()),
            ("shop_address", self.shop_address.clone()),
            ("shop_phone", self.shop_phone.clone()),
            ("receipt_footer", self.receipt_footer.clone()),
            ("order_prefix", self.order_prefix.clone()),
            (
                "print_shop_name_on_bill",
                self.print_shop_name_on_bill.to_string(),
            ),
            ("print_shop_address", self.print_shop_address.to_string()),
            ("print_shop_phone", self.print_shop_phone.to_string()),
            (
                "print_customer_phone",
                self.print_customer_phone.to_string(),
            ),
            ("print_received_at", self.print_received_at.to_string()),
            ("print_ready_by", self.print_ready_by.to_string()),
            (
                "print_shop_name_on_tags",
                self.print_shop_name_on_tags.to_string(),
            ),
            ("tag_line", self.tag_line.clone()),
            (
                "tag_length_mm",
                format!("{:.1}", f64::from(self.tag_length_tenths_mm) / 10.0),
            ),
        ]
    }

    pub(crate) fn bill_header(&self) -> BillHeader {
        let clamp = |text: &str| text.chars().take(MAX_HEADER_FIELD_CHARS).collect();
        BillHeader {
            shop_name: clamp(&self.shop_name),
            address: clamp(&self.shop_address),
            phone: clamp(&self.shop_phone),
            footer: clamp(&self.receipt_footer),
            show_shop_name: self.print_shop_name_on_bill,
            show_shop_address: self.print_shop_address,
            show_shop_phone: self.print_shop_phone,
            show_customer_phone: self.print_customer_phone,
            show_received_at: self.print_received_at,
            show_ready_by: self.print_ready_by,
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_tag_length_tenths_mm() -> u16 {
    DEFAULT_TAG_LENGTH_TENTHS_MM
}

/// Trim, refuse control characters (a newline would break a printed line) and cap the length.
fn clean_text(label: &str, raw: &str, max_chars: usize, required: bool) -> Result<String, String> {
    let text = raw.trim();
    if text.chars().any(char::is_control) {
        return Err(format!(
            "{label} cannot contain line breaks or control characters."
        ));
    }
    if text.chars().count() > max_chars {
        return Err(format!("{label} must be {max_chars} characters or fewer."));
    }
    if required && text.is_empty() {
        return Err(format!("Enter the {}.", label.to_lowercase()));
    }
    Ok(text.to_string())
}

/// 1-6 letters or digits, upper-cased. A hyphen is refused because bill numbers are
/// `PREFIX-YEAR-NUMBER` and other code splits them on it.
fn clean_prefix(raw: &str) -> Result<String, String> {
    let text = raw.trim().to_uppercase();
    let valid = !text.is_empty()
        && text.chars().count() <= MAX_PREFIX_CHARS
        && text
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    if valid {
        Ok(text)
    } else {
        Err(format!(
            "The bill number prefix must be 1 to {MAX_PREFIX_CHARS} letters or digits."
        ))
    }
}

fn validate(input: &ShopSettings) -> Result<ShopSettings, String> {
    if !(MIN_TAG_LENGTH_TENTHS_MM..=MAX_TAG_LENGTH_TENTHS_MM).contains(&input.tag_length_tenths_mm)
    {
        return Err("Tag cut length must be between 30 and 200 mm.".into());
    }
    Ok(ShopSettings {
        shop_name: clean_text("Shop name", &input.shop_name, MAX_NAME_CHARS, true)?,
        shop_address: clean_text("Address", &input.shop_address, MAX_ADDRESS_CHARS, false)?,
        shop_phone: clean_text("Phone", &input.shop_phone, MAX_PHONE_CHARS, false)?,
        receipt_footer: clean_text(
            "Receipt footer",
            &input.receipt_footer,
            MAX_FOOTER_CHARS,
            false,
        )?,
        order_prefix: clean_prefix(&input.order_prefix)?,
        print_shop_name_on_bill: input.print_shop_name_on_bill,
        print_shop_address: input.print_shop_address,
        print_shop_phone: input.print_shop_phone,
        print_customer_phone: input.print_customer_phone,
        print_received_at: input.print_received_at,
        print_ready_by: input.print_ready_by,
        print_shop_name_on_tags: input.print_shop_name_on_tags,
        tag_line: clean_text("Tag line", &input.tag_line, MAX_TAG_LINE_CHARS, false)?,
        tag_length_tenths_mm: input.tag_length_tenths_mm,
    })
}

const SELECT_EDITABLE: &str =
    "SELECT key,value FROM app_settings WHERE key IN (?,?,?,?,?,?,?,?,?,?,?,?,?,?)";

fn pairs_from(rows: &[sqlx::sqlite::SqliteRow]) -> Result<Vec<(String, String)>, String> {
    rows.iter()
        .map(|row| {
            Ok((
                row.try_get("key").map_err(db_err)?,
                row.try_get("value").map_err(db_err)?,
            ))
        })
        .collect()
}

/// Reads only the whitelisted keys, so nothing else in `app_settings` can leak to the screen.
async fn read_pairs(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<Vec<(String, String)>, String> {
    let mut query = sqlx::query(SELECT_EDITABLE);
    for key in EDITABLE_KEYS {
        query = query.bind(key);
    }
    pairs_from(&query.fetch_all(&mut **tx).await.map_err(db_err)?)
}

/// Any logged-in account may read the settings (the counter prints the shop name on every bill).
pub async fn get_shop_settings(
    db: &DatabaseState,
    session: &CounterSession,
) -> Result<ShopSettings, String> {
    require_actor(session)?;
    let mut query = sqlx::query(SELECT_EDITABLE);
    for key in EDITABLE_KEYS {
        query = query.bind(key);
    }
    let rows = query.fetch_all(db.writer_pool()?).await.map_err(db_err)?;
    Ok(ShopSettings::from_pairs(&pairs_from(&rows)?))
}

/// Administrator-only. The role is re-checked against the database inside the write transaction;
/// only changed keys are written, and the old and new values are audited together.
pub async fn save_shop_settings(
    db: &DatabaseState,
    session: &CounterSession,
    input: &ShopSettings,
) -> Result<ShopSettings, String> {
    let mut tx = db.begin_counter_write().await?;
    let admin = require_admin_in_tx(&mut tx, session, "change the shop settings").await?;
    let new = validate(input)?;
    let old = ShopSettings::from_pairs(&read_pairs(&mut tx).await?);
    let now = Utc::now().to_rfc3339();
    let mut changed = serde_json::Map::new();
    for ((key, old_value), (_, new_value)) in old.entries().into_iter().zip(new.entries()) {
        if old_value == new_value {
            continue;
        }
        sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
            .bind(key)
            .bind(&new_value)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        changed.insert(
            key.to_string(),
            serde_json::json!({ "old": old_value, "new": new_value }),
        );
    }
    if !changed.is_empty() {
        audit_details(
            &mut tx,
            &admin.id,
            "shop_settings_changed",
            "shop_settings",
            "shop",
            &now,
            &serde_json::json!({ "changes": changed }),
        )
        .await?;
    }
    tx.commit().await.map_err(db_err)?;
    Ok(new)
}

#[tauri::command]
pub async fn counter_get_shop_settings(
    state: tauri::State<'_, DatabaseState>,
    session: tauri::State<'_, CounterSession>,
) -> Result<ShopSettings, String> {
    get_shop_settings(&state, &session).await
}

#[tauri::command]
pub async fn counter_save_shop_settings(
    state: tauri::State<'_, DatabaseState>,
    session: tauri::State<'_, CounterSession>,
    settings: ShopSettings,
) -> Result<ShopSettings, String> {
    save_shop_settings(&state, &session, &settings).await
}

/// Bill-number prefix for the next order, read inside the order-saving transaction. A blank or
/// missing value falls back to `LA`. Numbers come from a per-year counter that does not depend on
/// the prefix, so changing it never repeats or skips a number.
pub(crate) async fn order_prefix(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<String, String> {
    let stored: Option<String> =
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key='order_prefix'")
            .fetch_optional(&mut **tx)
            .await
            .map_err(db_err)?;
    Ok(stored
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_ORDER_PREFIX.to_string()))
}

/// Shop identity copied into a bill document at order-save time. Fields are raw (a blank name or
/// footer makes the bill use its built-in title and thank-you line) and clamped so a long legacy
/// value can never make the bill fail print validation.
pub(crate) async fn bill_header(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<BillHeader, String> {
    Ok(load_for_order(tx).await?.bill_header())
}

/// All print choices are read from the same order transaction and copied into the saved jobs.
pub(crate) async fn load_for_order(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<ShopSettings, String> {
    Ok(ShopSettings::from_pairs(&read_pairs(tx).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::counter::{
        quote, reprint_output, save_order, CustomerInput, LineInput, OrderInput, PaymentInput,
        SaveInput, SessionActor,
    };
    use crate::printing::PrintDocument;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    type Mutation = Box<dyn Fn(&mut ShopSettings)>;

    static NEXT: AtomicU64 = AtomicU64::new(0);

    fn fixture_path() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "shop-settings-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        path.join("shop.db")
    }

    async fn add_account(db: &DatabaseState, id: &str, role: &str, active: i64) {
        let pool = db.writer_pool().unwrap();
        sqlx::query("INSERT INTO local_users(id,full_name,pin_hash,pin_salt,role,created_at,updated_at) VALUES(?,?,'x','x','admin',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
            .bind(id).bind(id).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO counter_accounts(id,full_name,pin_hash,pin_salt,role,active,created_at,updated_at) VALUES(?,?,'x','x',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
            .bind(id).bind(id).bind(role).bind(active).execute(pool).await.unwrap();
    }

    fn session(id: &str, role: &str) -> CounterSession {
        let session = CounterSession::default();
        session
            .set(SessionActor {
                id: id.into(),
                role: role.into(),
            })
            .unwrap();
        session
    }

    async fn open() -> (DatabaseState, PathBuf) {
        let path = fixture_path();
        let db = DatabaseState::open(path.clone()).await;
        add_account(&db, "admin-1", "admin", 1).await;
        add_account(&db, "staff-1", "staff", 1).await;
        add_account(&db, "staff-off", "staff", 0).await;
        add_account(&db, "admin-off", "admin", 0).await;
        (db, path)
    }

    fn cleanup(db: DatabaseState, path: PathBuf) {
        drop(db);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    fn input() -> ShopSettings {
        ShopSettings {
            shop_name: "Sunrise Cleaners".into(),
            shop_address: "12 MG Road, Pune".into(),
            shop_phone: "020 5550 1234".into(),
            receipt_footer: "Visit again soon".into(),
            order_prefix: "sr".into(),
            print_shop_name_on_bill: true,
            print_shop_address: true,
            print_shop_phone: true,
            print_customer_phone: true,
            print_received_at: true,
            print_ready_by: true,
            print_shop_name_on_tags: false,
            tag_line: String::new(),
            tag_length_tenths_mm: DEFAULT_TAG_LENGTH_TENTHS_MM,
        }
    }

    async fn setting(db: &DatabaseState, key: &str) -> Option<String> {
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key=?")
            .bind(key)
            .fetch_optional(db.writer_pool().unwrap())
            .await
            .unwrap()
    }

    async fn audit_rows(db: &DatabaseState) -> Vec<(String, String, String)> {
        sqlx::query_as("SELECT actor_id,action,details_json FROM counter_audit WHERE action='shop_settings_changed' ORDER BY created_at")
            .fetch_all(db.writer_pool().unwrap())
            .await
            .unwrap()
    }

    #[test]
    fn defaults_are_returned_for_a_fresh_database() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            let got = get_shop_settings(&db, &session("staff-1", "staff"))
                .await
                .unwrap();
            assert_eq!(got.shop_name, "Smart Laundry");
            assert_eq!(got.order_prefix, "LA");
            assert_eq!(got.shop_address, "");
            cleanup(db, path);
        });
    }

    #[test]
    fn blank_or_missing_rows_read_back_as_defaults() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            sqlx::query(
                "UPDATE app_settings SET value='  ' WHERE key IN ('shop_name','order_prefix')",
            )
            .execute(db.writer_pool().unwrap())
            .await
            .unwrap();
            sqlx::query("DELETE FROM app_settings WHERE key='receipt_footer'")
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            let got = get_shop_settings(&db, &session("admin-1", "admin"))
                .await
                .unwrap();
            assert_eq!(got.shop_name, "Smart Laundry");
            assert_eq!(got.order_prefix, "LA");
            assert_eq!(got.receipt_footer, "");
            cleanup(db, path);
        });
    }

    #[test]
    fn get_works_for_every_logged_in_role_and_refuses_no_session() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            for (id, role) in [("admin-1", "admin"), ("staff-1", "staff")] {
                get_shop_settings(&db, &session(id, role)).await.unwrap();
            }
            let none = CounterSession::default();
            assert!(get_shop_settings(&db, &none)
                .await
                .unwrap_err()
                .contains("Log in"));
            cleanup(db, path);
        });
    }

    #[test]
    fn admin_saves_normalised_values_and_get_returns_them() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            let admin = session("admin-1", "admin");
            let mut padded = input();
            padded.shop_name = "  Sunrise Cleaners  ".into();
            let saved = save_shop_settings(&db, &admin, &padded).await.unwrap();
            assert_eq!(saved.shop_name, "Sunrise Cleaners");
            assert_eq!(saved.order_prefix, "SR");
            let staff = session("staff-1", "staff");
            assert_eq!(get_shop_settings(&db, &staff).await.unwrap(), saved);
            assert_eq!(setting(&db, "order_prefix").await.as_deref(), Some("SR"));
            cleanup(db, path);
        });
    }

    #[test]
    fn only_a_live_active_administrator_may_save() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            let before = get_shop_settings(&db, &session("admin-1", "admin"))
                .await
                .unwrap();
            let cases = [
                ("no session", CounterSession::default(), "Log in"),
                ("staff", session("staff-1", "staff"), "Administrator access"),
                (
                    "inactive staff",
                    session("staff-off", "staff"),
                    "Administrator access",
                ),
                (
                    "forged admin role on a staff account",
                    session("staff-1", "admin"),
                    "no longer valid",
                ),
                (
                    "forged admin on an unknown id",
                    session("ghost", "admin"),
                    "no longer valid",
                ),
                (
                    "deactivated admin with a stale session",
                    session("admin-off", "admin"),
                    "no longer valid",
                ),
            ];
            for (label, who, expected) in cases {
                let error = save_shop_settings(&db, &who, &input()).await.unwrap_err();
                assert!(error.contains(expected), "{label}: {error}");
            }
            assert_eq!(
                get_shop_settings(&db, &session("admin-1", "admin"))
                    .await
                    .unwrap(),
                before
            );
            assert!(audit_rows(&db).await.is_empty());
            cleanup(db, path);
        });
    }

    #[test]
    fn an_admin_demoted_after_login_is_refused_inside_the_write() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            let stale = session("admin-1", "admin");
            sqlx::query("UPDATE counter_accounts SET role='staff' WHERE id='admin-1'")
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            let error = save_shop_settings(&db, &stale, &input()).await.unwrap_err();
            assert!(error.contains("no longer valid"), "{error}");
            assert_eq!(
                setting(&db, "shop_name").await.as_deref(),
                Some("Smart Laundry")
            );
            cleanup(db, path);
        });
    }

    #[test]
    fn invalid_values_are_refused_and_change_nothing() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            let admin = session("admin-1", "admin");
            let mutations: Vec<(&str, Mutation)> = vec![
                ("blank name", Box::new(|s| s.shop_name = "  ".into())),
                ("long name", Box::new(|s| s.shop_name = "n".repeat(61))),
                ("name newline", Box::new(|s| s.shop_name = "a\nb".into())),
                (
                    "long address",
                    Box::new(|s| s.shop_address = "a".repeat(121)),
                ),
                (
                    "address control",
                    Box::new(|s| s.shop_address = "a\u{7}b".into()),
                ),
                ("long phone", Box::new(|s| s.shop_phone = "1".repeat(21))),
                ("phone tab", Box::new(|s| s.shop_phone = "1\t2".into())),
                (
                    "long footer",
                    Box::new(|s| s.receipt_footer = "f".repeat(121)),
                ),
                (
                    "footer newline",
                    Box::new(|s| s.receipt_footer = "a\r\nb".into()),
                ),
                ("blank prefix", Box::new(|s| s.order_prefix = " ".into())),
                (
                    "long prefix",
                    Box::new(|s| s.order_prefix = "ABCDEFG".into()),
                ),
                ("hyphen prefix", Box::new(|s| s.order_prefix = "A-B".into())),
                ("space prefix", Box::new(|s| s.order_prefix = "A B".into())),
                ("symbol prefix", Box::new(|s| s.order_prefix = "A/".into())),
                (
                    "non ascii prefix",
                    Box::new(|s| s.order_prefix = "\u{e9}A".into()),
                ),
            ];
            for (label, mutate) in mutations {
                let mut bad = input();
                mutate(&mut bad);
                assert!(
                    save_shop_settings(&db, &admin, &bad).await.is_err(),
                    "{label} should be refused"
                );
            }
            assert_eq!(
                setting(&db, "shop_name").await.as_deref(),
                Some("Smart Laundry")
            );
            assert!(audit_rows(&db).await.is_empty());
            cleanup(db, path);
        });
    }

    #[test]
    fn limits_are_inclusive_and_unicode_counts_characters() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            let admin = session("admin-1", "admin");
            let edge = ShopSettings {
                shop_name: "\u{938}".repeat(60),
                shop_address: "a".repeat(120),
                shop_phone: "+91 98765 43210 x12 ".trim().into(),
                receipt_footer: "f".repeat(120),
                order_prefix: "ab12cd".into(),
                ..input()
            };
            let saved = save_shop_settings(&db, &admin, &edge).await.unwrap();
            assert_eq!(saved.order_prefix, "AB12CD");
            assert_eq!(saved.shop_name.chars().count(), 60);
            let mut empty_optionals = input();
            empty_optionals.shop_address = String::new();
            empty_optionals.shop_phone = String::new();
            empty_optionals.receipt_footer = String::new();
            let saved = save_shop_settings(&db, &admin, &empty_optionals)
                .await
                .unwrap();
            assert_eq!(saved.receipt_footer, "");
            cleanup(db, path);
        });
    }

    #[test]
    fn unknown_fields_are_rejected_so_other_settings_cannot_be_written() {
        let good = serde_json::json!({
            "shopName": "A", "shopAddress": "", "shopPhone": "",
            "receiptFooter": "", "orderPrefix": "LA"
        });
        assert!(serde_json::from_value::<ShopSettings>(good.clone()).is_ok());
        for key in ["deviceId", "device_id", "backup_last_at", "gstNumber"] {
            let mut forged = good.clone();
            forged[key] = serde_json::json!("x");
            assert!(
                serde_json::from_value::<ShopSettings>(forged).is_err(),
                "{key} must not parse"
            );
        }
        assert_eq!(EDITABLE_KEYS.len(), 14);
    }

    #[test]
    fn saving_never_touches_device_or_backup_settings() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            let pool = db.writer_pool().unwrap();
            sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES('backup_last_at','2026-01-01','2026-01-01') ON CONFLICT(key) DO UPDATE SET value=excluded.value")
                .execute(pool).await.unwrap();
            let snapshot = |db: &DatabaseState| {
                let pool = db.writer_pool().unwrap().clone();
                async move {
                    sqlx::query_as::<_, (String, String, String)>(
                        "SELECT key,value,updated_at FROM app_settings WHERE key NOT IN ('shop_name','shop_address','shop_phone','receipt_footer','order_prefix','print_shop_name_on_bill','print_shop_address','print_shop_phone','print_customer_phone','print_received_at','print_ready_by','print_shop_name_on_tags','tag_line','tag_length_mm') ORDER BY key",
                    )
                    .fetch_all(&pool)
                    .await
                    .unwrap()
                }
            };
            let before = snapshot(&db).await;
            assert!(before.iter().any(|(k, _, _)| k == "device_id"));
            save_shop_settings(&db, &session("admin-1", "admin"), &input())
                .await
                .unwrap();
            assert_eq!(snapshot(&db).await, before);
            let shown = serde_json::to_value(
                get_shop_settings(&db, &session("staff-1", "staff"))
                    .await
                    .unwrap(),
            )
            .unwrap();
            let mut keys: Vec<_> = shown.as_object().unwrap().keys().cloned().collect();
            keys.sort();
            assert_eq!(
                keys,
                [
                    "orderPrefix",
                    "printCustomerPhone",
                    "printReadyBy",
                    "printReceivedAt",
                    "printShopAddress",
                    "printShopNameOnBill",
                    "printShopNameOnTags",
                    "printShopPhone",
                    "receiptFooter",
                    "shopAddress",
                    "shopName",
                    "shopPhone",
                    "tagLengthMm",
                    "tagLine"
                ]
            );
            cleanup(db, path);
        });
    }

    #[test]
    fn each_change_is_audited_with_old_and_new_values_and_unchanged_saves_are_not() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            let admin = session("admin-1", "admin");
            save_shop_settings(&db, &admin, &input()).await.unwrap();
            let rows = audit_rows(&db).await;
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].0, "admin-1");
            let details: serde_json::Value = serde_json::from_str(&rows[0].2).unwrap();
            assert_eq!(details["changes"]["shop_name"]["old"], "Smart Laundry");
            assert_eq!(details["changes"]["shop_name"]["new"], "Sunrise Cleaners");
            assert_eq!(details["changes"]["order_prefix"]["old"], "LA");
            assert_eq!(details["changes"]["order_prefix"]["new"], "SR");

            // Saving identical values again records nothing.
            save_shop_settings(&db, &admin, &input()).await.unwrap();
            assert_eq!(audit_rows(&db).await.len(), 1);

            // A single-field edit records only that field.
            let mut one = input();
            one.shop_phone = "9999".into();
            save_shop_settings(&db, &admin, &one).await.unwrap();
            let rows = audit_rows(&db).await;
            assert_eq!(rows.len(), 2);
            let details: serde_json::Value = serde_json::from_str(&rows[1].2).unwrap();
            let changes = details["changes"].as_object().unwrap();
            assert_eq!(changes.len(), 1);
            assert_eq!(changes["shop_phone"]["old"], "020 5550 1234");
            cleanup(db, path);
        });
    }

    #[test]
    fn a_staged_restore_blocks_saving() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            std::fs::write(
                crate::storage::pending_restore_path_for_tests(&path),
                b"staged",
            )
            .unwrap();
            let error = save_shop_settings(&db, &session("admin-1", "admin"), &input())
                .await
                .unwrap_err();
            assert!(error.contains("restore is staged"), "{error}");
            cleanup(db, path);
        });
    }

    fn order() -> OrderInput {
        OrderInput {
            customer: CustomerInput {
                name: "Fixture Customer".into(),
                phone: "9990000000".into(),
                customer_id: None,
            },
            items: vec![LineInput {
                garment_id: "g-shirt".into(),
                service_id: "svc-wash".into(),
                quantity: 1,
            }],
        }
    }

    async fn save(
        db: &DatabaseState,
        who: &CounterSession,
        key: &str,
    ) -> crate::counter::SavedOrder {
        let reviewed_quote = quote(db, who, &order()).await.unwrap();
        let payment = Some(PaymentInput {
            amount_minor: reviewed_quote.total_minor,
            method: "cash".into(),
            reference: None,
        });
        save_order(
            db,
            who,
            SaveInput {
                order: order(),
                reviewed_quote,
                idempotency_key: key.into(),
                payment,
            },
        )
        .await
        .unwrap()
    }

    async fn bill_header_of(db: &DatabaseState, order_id: &str) -> BillHeader {
        let payload: String = sqlx::query_scalar(
            "SELECT payload_json FROM print_jobs WHERE order_id=? AND kind='bill' AND source_job_id IS NULL",
        )
        .bind(order_id)
        .fetch_one(db.writer_pool().unwrap())
        .await
        .unwrap();
        match serde_json::from_str::<PrintDocument>(&payload).unwrap() {
            PrintDocument::Bill(bill) => bill.header,
            PrintDocument::Tags(_) => unreachable!("bill job"),
        }
    }

    async fn tag_document_of(db: &DatabaseState, order_id: &str) -> crate::printing::TagDocument {
        let payload: String = sqlx::query_scalar(
            "SELECT payload_json FROM print_jobs WHERE order_id=? AND kind='tags' AND source_job_id IS NULL",
        )
        .bind(order_id)
        .fetch_one(db.writer_pool().unwrap())
        .await
        .unwrap();
        match serde_json::from_str::<PrintDocument>(&payload).unwrap() {
            PrintDocument::Tags(tags) => tags,
            PrintDocument::Bill(_) => unreachable!("tag job"),
        }
    }

    #[test]
    fn changing_the_prefix_mid_year_never_repeats_or_skips_a_bill_number() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            let admin = session("admin-1", "admin");
            let staff = session("staff-1", "staff");
            let first = save(&db, &staff, "k1").await;
            let mut changed = input();
            changed.order_prefix = "NL".into();
            save_shop_settings(&db, &admin, &changed).await.unwrap();
            let second = save(&db, &staff, "k2").await;
            changed.order_prefix = "LA".into();
            save_shop_settings(&db, &admin, &changed).await.unwrap();
            let third = save(&db, &staff, "k3").await;

            let numbers = [&first, &second, &third].map(|o| o.order_number.clone());
            let parts: Vec<Vec<&str>> = numbers.iter().map(|n| n.split('-').collect()).collect();
            assert_eq!(parts[0][0], "LA");
            assert_eq!(parts[1][0], "NL");
            assert_eq!(parts[2][0], "LA");
            let sequence: Vec<u32> = parts.iter().map(|p| p[2].parse().unwrap()).collect();
            assert_eq!(
                sequence,
                [1, 2, 3],
                "one running number whatever the prefix"
            );
            assert_eq!(parts[0][1], parts[2][1]);
            let unique: std::collections::HashSet<_> = numbers.iter().collect();
            assert_eq!(unique.len(), 3);
            // The piece ids of the three bills never collide either.
            let mut piece_ids: Vec<_> = [&first, &second, &third]
                .iter()
                .flat_map(|o| o.pieces.iter().map(|p| p.short_id.clone()))
                .collect();
            piece_ids.sort();
            piece_ids.dedup();
            assert_eq!(piece_ids.len(), 3);
            cleanup(db, path);
        });
    }

    #[test]
    fn a_blank_stored_prefix_still_numbers_orders_with_the_default() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            sqlx::query("UPDATE app_settings SET value=' ' WHERE key='order_prefix'")
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            let saved = save(&db, &session("staff-1", "staff"), "blank").await;
            assert!(
                saved.order_number.starts_with("LA-"),
                "{}",
                saved.order_number
            );
            sqlx::query("DELETE FROM app_settings WHERE key='order_prefix'")
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            let again = save(&db, &session("staff-1", "staff"), "missing").await;
            assert!(again.order_number.starts_with("LA-"));
            cleanup(db, path);
        });
    }

    #[test]
    fn the_bill_header_is_snapshotted_at_save_and_survives_reprints() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            let admin = session("admin-1", "admin");
            let staff = session("staff-1", "staff");
            save_shop_settings(&db, &admin, &input()).await.unwrap();
            let first = save(&db, &staff, "snap-1").await;
            let expected = BillHeader {
                shop_name: "Sunrise Cleaners".into(),
                address: "12 MG Road, Pune".into(),
                phone: "020 5550 1234".into(),
                footer: "Visit again soon".into(),
                ..BillHeader::default()
            };
            assert_eq!(bill_header_of(&db, &first.order_id).await, expected);

            let mut renamed = input();
            renamed.shop_name = "Moonrise Wash".into();
            renamed.receipt_footer = String::new();
            save_shop_settings(&db, &admin, &renamed).await.unwrap();

            assert_eq!(
                bill_header_of(&db, &first.order_id).await,
                expected,
                "editing the settings does not rewrite a saved bill"
            );
            let reprint = reprint_output(&db, &staff, &first.order_id, "bill", vec![], "rp-1")
                .await
                .unwrap();
            let payload: String =
                sqlx::query_scalar("SELECT payload_json FROM print_jobs WHERE id=?")
                    .bind(&reprint.id)
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            let PrintDocument::Bill(reprinted) = serde_json::from_str(&payload).unwrap() else {
                unreachable!("bill reprint")
            };
            assert_eq!(reprinted.header, expected, "a reprint matches the original");

            let second = save(&db, &staff, "snap-2").await;
            let later = bill_header_of(&db, &second.order_id).await;
            assert_eq!(later.shop_name, "Moonrise Wash");
            assert_eq!(later.footer, "");
            cleanup(db, path);
        });
    }

    #[test]
    fn print_visibility_branding_and_tag_length_are_snapshotted_and_reprinted() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            let admin = session("admin-1", "admin");
            let staff = session("staff-1", "staff");
            let mut first_settings = input();
            first_settings.print_shop_name_on_bill = false;
            first_settings.print_customer_phone = false;
            first_settings.print_received_at = false;
            first_settings.print_shop_name_on_tags = true;
            first_settings.tag_line = "Sort carefully".into();
            first_settings.tag_length_tenths_mm = 1234;
            save_shop_settings(&db, &admin, &first_settings)
                .await
                .unwrap();
            let first = save(&db, &staff, "tag-snapshot-1").await;
            let original_bill = bill_header_of(&db, &first.order_id).await;
            assert!(!original_bill.show_shop_name);
            assert!(!original_bill.show_customer_phone);
            assert!(!original_bill.show_received_at);
            let original_tags = tag_document_of(&db, &first.order_id).await;
            assert!(original_tags.show_shop_name);
            assert_eq!(original_tags.shop_name, "Sunrise Cleaners");
            assert_eq!(original_tags.tag_line, "Sort carefully");
            assert_eq!(original_tags.tag_length_tenths_mm, 1234);

            let mut changed = first_settings;
            changed.print_shop_name_on_tags = false;
            changed.tag_line = "Updated line".into();
            changed.tag_length_tenths_mm = 800;
            save_shop_settings(&db, &admin, &changed).await.unwrap();
            assert_eq!(tag_document_of(&db, &first.order_id).await, original_tags);

            let reprint = reprint_output(
                &db,
                &staff,
                &first.order_id,
                "tags",
                vec![first.pieces[0].short_id.clone()],
                "tag-snapshot-reprint",
            )
            .await
            .unwrap();
            let payload: String =
                sqlx::query_scalar("SELECT payload_json FROM print_jobs WHERE id=?")
                    .bind(&reprint.id)
                    .fetch_one(db.writer_pool().unwrap())
                    .await
                    .unwrap();
            let PrintDocument::Tags(reprinted) = serde_json::from_str(&payload).unwrap() else {
                unreachable!("tag reprint")
            };
            assert!(reprinted.show_shop_name);
            assert_eq!(reprinted.tag_line, "Sort carefully");
            assert_eq!(reprinted.tag_length_tenths_mm, 1234);
            assert_eq!(reprinted.pieces.len(), 1);
            cleanup(db, path);
        });
    }

    #[test]
    fn the_bill_header_clamps_oversized_legacy_values() {
        tauri::async_runtime::block_on(async {
            let (db, path) = open().await;
            sqlx::query("UPDATE app_settings SET value=? WHERE key='shop_address'")
                .bind("a".repeat(500))
                .execute(db.writer_pool().unwrap())
                .await
                .unwrap();
            let mut tx = db.begin_counter_write().await.unwrap();
            let header = bill_header(&mut tx).await.unwrap();
            assert_eq!(header.address.chars().count(), MAX_HEADER_FIELD_CHARS);
            drop(tx);
            // The clamped header still passes the printer's validation.
            let saved = save(&db, &session("staff-1", "staff"), "clamp").await;
            assert_eq!(
                bill_header_of(&db, &saved.order_id)
                    .await
                    .address
                    .chars()
                    .count(),
                MAX_HEADER_FIELD_CHARS
            );
            cleanup(db, path);
        });
    }
}
