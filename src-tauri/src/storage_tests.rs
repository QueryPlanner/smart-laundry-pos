use super::*;

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static TEMP_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TempDatabase {
    directory: PathBuf,
    path: PathBuf,
}

impl TempDatabase {
    fn new() -> Self {
        for _ in 0..100 {
            let sequence = TEMP_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be available")
                .as_nanos();
            let directory = std::env::temp_dir().join(format!(
                "smart-laundry-storage-test-{}-{timestamp}-{sequence}",
                std::process::id()
            ));
            match fs::create_dir(&directory) {
                Ok(()) => {
                    return Self {
                        path: directory.join("laundry.db"),
                        directory,
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("could not create temporary database directory: {error}"),
            }
        }
        panic!("could not choose a unique temporary database directory");
    }
}

impl Drop for TempDatabase {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn execute(sql: &str, values: Vec<Value>) -> SqlStatement {
    SqlStatement {
        sql: sql.to_string(),
        values,
        expected_rows: None,
        error: None,
        mode: None,
    }
}

fn select(sql: &str, values: Vec<Value>) -> SqlStatement {
    SqlStatement {
        sql: sql.to_string(),
        values,
        expected_rows: None,
        error: None,
        mode: Some(StatementMode::Select),
    }
}

fn with_expected_rows(mut statement: SqlStatement, count: u64, error: &str) -> SqlStatement {
    statement.expected_rows = Some(count);
    statement.error = Some(error.to_string());
    statement
}

async fn open(path: &Path) -> DatabaseState {
    DatabaseState::open(path.to_path_buf()).await
}

async fn seed_marker(state: &DatabaseState, key: &str, value: &str) {
    state
        .local_batch(vec![execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
            vec![
                Value::String(key.to_string()),
                Value::String(value.to_string()),
            ],
        )])
        .await
        .expect("marker insert should commit");
}

async fn marker_value(state: &DatabaseState, key: &str) -> Option<String> {
    state
        .local_select(
            "SELECT value FROM app_settings WHERE key = ?".to_string(),
            vec![Value::String(key.to_string())],
        )
        .await
        .expect("marker query should work")
        .first()
        .and_then(|row| row.get("value"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

async fn create_schema_file(path: &Path, version: i64) {
    let pool = connect_writer_pool(path, false, 1)
        .await
        .expect("temporary schema database should open");
    let mut connection = pool.acquire().await.expect("connection should open");
    sqlx::raw_sql(MIGRATION_SQL)
        .execute(&mut *connection)
        .await
        .expect("initial migration should create the schema");
    sqlx::query(&format!("PRAGMA user_version = {version}"))
        .execute(&mut *connection)
        .await
        .expect("user_version should be set");
    drop(connection);
    pool.close().await;
}

async fn create_schema_file_from_sql(path: &Path, schema: &str, version: i64) {
    let pool = connect_writer_pool(path, false, 1)
        .await
        .expect("temporary schema database should open");
    sqlx::raw_sql(schema)
        .execute(&pool)
        .await
        .expect("fixture schema should execute");
    sqlx::query(&format!("PRAGMA user_version = {version}"))
        .execute(&pool)
        .await
        .expect("user_version should be set");
    pool.close().await;
}

fn migration_without_constraints() -> String {
    let mut schema = MIGRATION_SQL.replace(" UNIQUE", "");
    for constraint in [
        "CHECK (role IN ('admin'))",
        "CHECK (customer_type IN ('regular', 'student', 'hostel', 'other'))",
        "CHECK (active IN (0, 1))",
        "CHECK (order_type IN ('piece', 'weight', 'combined'))",
        "CHECK (status IN ('received', 'washing', 'drying', 'ironing', 'quality_check', 'packing', 'ready', 'collected', 'cancelled'))",
        "CHECK (discount_type IN ('fixed', 'percentage'))",
        "CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid', 'overpaid'))",
        "CHECK (service_type IN ('piece', 'weight', 'combined'))",
        "CHECK (amount > 0)",
        "CHECK (method IN ('cash', 'upi', 'card', 'bank_transfer', 'credit', 'other'))",
        "CHECK (payment_method IN ('cash', 'upi', 'card', 'bank_transfer', 'other'))",
        "CHECK (change_quantity <> 0)",
        "CHECK (transaction_type IN ('stock_in', 'stock_out', 'adjustment'))",
    ] {
        schema = schema.replace(constraint, "");
    }
    assert!(
        !schema.contains("CHECK ("),
        "all CHECK constraints should be removed"
    );
    assert!(
        !schema.contains(" UNIQUE"),
        "all UNIQUE constraints should be removed"
    );
    schema
}

async fn create_database_with_marker(path: &Path, value: &str) {
    let state = open(path).await;
    assert_eq!(state.info().error, None);
    seed_marker(&state, "restore-marker", value).await;
    drop(state);
}

#[test]
fn startup_failures_are_reported_without_overwriting_blocking_paths() {
    tauri::async_runtime::block_on(async {
        let blocked_parent = TempDatabase::new();
        let parent_file = blocked_parent.directory.join("database-parent-file");
        fs::write(&parent_file, b"keep this file").unwrap();
        let blocked_path = parent_file.join("laundry.db");

        let blocked = open(&blocked_path).await;
        let directory_error = blocked
            .info()
            .error
            .expect("a file used as a database directory should fail startup");
        assert!(directory_error.contains("Could not create the local database directory"));
        assert_eq!(fs::read(&parent_file).unwrap(), b"keep this file");
        assert_eq!(
            blocked
                .local_select("SELECT 1".to_string(), vec![])
                .await
                .unwrap_err(),
            directory_error
        );
        assert_eq!(
            blocked.local_read_batch(vec![]).await.unwrap_err(),
            directory_error
        );
        assert_eq!(
            blocked.local_batch(vec![]).await.unwrap_err(),
            directory_error
        );
        assert_eq!(
            blocked.backup_database().await.unwrap_err(),
            directory_error
        );
        assert_eq!(
            blocked
                .restore_database("unused.db".to_string())
                .apply()
                .await
                .unwrap_err(),
            directory_error
        );

        let blocked_lock = TempDatabase::new();
        fs::create_dir(sibling_named(&blocked_lock.path, "laundry.lock")).unwrap();
        let lock_failure = open(&blocked_lock.path).await;
        let lock_error = lock_failure
            .info()
            .error
            .expect("a directory at the lock-file path should fail startup");
        assert!(lock_error.contains("Could not open the database instance lock"));
        assert!(!blocked_lock.path.exists());
        assert!(sibling_named(&blocked_lock.path, "laundry.lock").is_dir());

        let unavailable = DatabaseState::unavailable("app config directory unavailable");
        assert_eq!(
            unavailable.info().error.as_deref(),
            Some("app config directory unavailable")
        );
        assert_eq!(
            unavailable
                .local_select("SELECT 1".to_string(), vec![])
                .await
                .unwrap_err(),
            "app config directory unavailable"
        );
        assert_eq!(
            unavailable
                .restore_database("unused.db".to_string())
                .apply()
                .await
                .unwrap_err(),
            "app config directory unavailable"
        );
    });
}

#[test]
fn fresh_database_migrates_seeds_and_repairs_device_identifier_once() {
    tauri::async_runtime::block_on(async {
        let temporary = TempDatabase::new();
        let state = open(&temporary.path).await;
        assert_eq!(state.info().error, None);
        assert!(!state.info().restore_pending);

        let first = marker_value(&state, "device_id")
            .await
            .expect("device id seeded");
        assert_eq!(first.len(), 32);
        assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));

        let mut connection = state
            .pools()
            .expect("pools should be initialized")
            .writer
            .acquire()
            .await
            .expect("writer should open");
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&mut *connection)
            .await
            .expect("schema version should be readable");
        assert_eq!(version, SCHEMA_VERSION);
        sqlx::query("UPDATE app_settings SET value = '' WHERE key = 'device_id'")
            .execute(&mut *connection)
            .await
            .expect("device id should be repairable");
        drop(connection);
        drop(state);

        let repaired_state = open(&temporary.path).await;
        let repaired = marker_value(&repaired_state, "device_id")
            .await
            .expect("empty device id should be repaired at startup");
        assert_eq!(repaired.len(), 32);
        assert_ne!(repaired, "");
        drop(repaired_state);

        let second_reopen = open(&temporary.path).await;
        assert_eq!(
            marker_value(&second_reopen, "device_id").await,
            Some(repaired)
        );
    });
}

#[test]
fn version_zero_complete_legacy_database_migrates_without_losing_rows() {
    tauri::async_runtime::block_on(async {
        let temporary = TempDatabase::new();
        let state = open(&temporary.path).await;
        seed_marker(&state, "legacy-marker", "keep-me").await;
        let mut connection = state.pools().unwrap().writer.acquire().await.unwrap();
        sqlx::query("PRAGMA user_version = 0")
            .execute(&mut *connection)
            .await
            .unwrap();
        drop(connection);
        drop(state);

        let migrated = open(&temporary.path).await;
        assert_eq!(migrated.info().error, None);
        assert_eq!(
            marker_value(&migrated, "legacy-marker").await.as_deref(),
            Some("keep-me")
        );
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&migrated.pools().unwrap().writer)
            .await
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    });
}

#[test]
fn failed_legacy_migration_rolls_back_schema_changes() {
    tauri::async_runtime::block_on(async {
        let temporary = TempDatabase::new();
        let pool = connect_writer_pool(&temporary.path, false, 1)
            .await
            .expect("the isolated legacy database should open");
        sqlx::query(
            "CREATE VIEW app_settings AS SELECT 'legacy' AS key, 'value' AS value, CURRENT_TIMESTAMP AS updated_at",
        )
        .execute(&pool)
        .await
        .expect("the view should allow the seed insert to fail during migration");
        pool.close().await;

        let failed = open(&temporary.path).await;
        let error = failed
            .info()
            .error
            .expect("the migration should reject writes to a view named app_settings");
        assert!(error.contains("local database migration failed"), "{error}");

        let verification_pool = connect_reader_pool(&temporary.path, 1).await.unwrap();
        let object_type: String =
            sqlx::query_scalar("SELECT type FROM sqlite_master WHERE name = 'app_settings'")
                .fetch_one(&verification_pool)
                .await
                .unwrap();
        assert_eq!(object_type, "view");
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&verification_pool)
            .await
            .unwrap();
        assert_eq!(version, 0);
        let created_tables: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .fetch_one(&verification_pool)
        .await
        .unwrap();
        assert_eq!(created_tables, 0, "failed migration changes must roll back");
        verification_pool.close().await;
    });
}

#[test]
fn batch_returns_insert_and_select_results_and_read_batch_returns_nested_rows() {
    tauri::async_runtime::block_on(async {
        let temporary = TempDatabase::new();
        let state = open(&temporary.path).await;
        let initial_setting_count = state
            .local_select(
                "SELECT COUNT(*) AS count FROM app_settings".to_string(),
                vec![],
            )
            .await
            .unwrap()[0]["count"]
            .as_i64()
            .unwrap();
        let results = state
            .local_batch(vec![
                execute(
                    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                    vec![json!("batch-marker"), json!("saved")],
                ),
                select(
                    "SELECT value FROM app_settings WHERE key = ?",
                    vec![json!("batch-marker")],
                ),
            ])
            .await
            .expect("write transaction should commit");
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].rows_affected, 1);
        assert!(results[0].last_insert_id.is_some());
        assert_eq!(results[0].rows, None);
        assert_eq!(results[1].rows_affected, 1);
        assert_eq!(results[1].last_insert_id, None);
        assert_eq!(
            results[1].rows.as_ref().unwrap()[0]["value"],
            json!("saved")
        );

        let read_results = state
            .local_read_batch(vec![
                select(
                    "SELECT key, value FROM app_settings WHERE key = ?",
                    vec![json!("batch-marker")],
                ),
                select("SELECT COUNT(*) AS count FROM app_settings", vec![]),
            ])
            .await
            .expect("read batch should return each query result");
        assert_eq!(read_results.len(), 2);
        assert_eq!(read_results[0][0]["key"], json!("batch-marker"));
        assert_eq!(
            read_results[1][0]["count"].as_i64(),
            Some(initial_setting_count + 1)
        );
        assert_eq!(
            state.local_read_batch(vec![]).await.unwrap(),
            Vec::<SqlRows>::new()
        );
        assert_eq!(
            state.local_batch(vec![]).await.unwrap(),
            Vec::<SqlExecutionResult>::new()
        );
    });
}

#[test]
fn expected_row_failure_rolls_back_order_items_payment_audit_and_sequence() {
    tauri::async_runtime::block_on(async {
        let temporary = TempDatabase::new();
        let state = open(&temporary.path).await;
        let statements = vec![
            execute(
                "INSERT INTO local_users (id, full_name, pin_hash, pin_salt, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                vec![json!("user-1"), json!("Cashier"), json!("hash"), json!("salt")],
            ),
            execute(
                "INSERT INTO customers (id, customer_code, name, phone, created_at, updated_at, origin_device_id) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)",
                vec![json!("customer-1"), json!("C0001"), json!("Rita"), json!("9990000000"), json!("device-1")],
            ),
            execute(
                "INSERT INTO order_sequences (year, next_number) VALUES (?, ?)",
                vec![json!(2026), json!(2)],
            ),
            execute(
                "INSERT INTO orders (id, order_number, customer_id, customer_name, customer_phone, order_type, received_at, status, subtotal, discount_type, discount_value, discount_amount, total_amount, payment_status, created_by, created_at, updated_at, origin_device_id) VALUES (?, ?, ?, ?, ?, 'piece', CURRENT_TIMESTAMP, 'received', 10, 'fixed', 0, 0, 10, 'unpaid', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)",
                vec![json!("order-1"), json!("2026-00001"), json!("customer-1"), json!("Rita"), json!("9990000000"), json!("user-1"), json!("device-1")],
            ),
            execute(
                "INSERT INTO order_items (id, order_id, item_name, service_name, service_type, quantity, weight_kg, rate, line_total, created_at) VALUES (?, ?, ?, ?, 'piece', 1, 0, 10, 10, CURRENT_TIMESTAMP)",
                vec![json!("item-1"), json!("order-1"), json!("Shirt"), json!("Wash")],
            ),
            execute(
                "INSERT INTO payments (id, order_id, amount, method, recorded_at, recorded_by, created_at, updated_at, origin_device_id) VALUES (?, ?, 10, 'cash', CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)",
                vec![json!("payment-1"), json!("order-1"), json!("user-1"), json!("device-1")],
            ),
            execute(
                "INSERT INTO audit_log (id, entity_type, entity_id, action, details_json, user_id, created_at) VALUES (?, 'order', ?, 'created', '{}', ?, CURRENT_TIMESTAMP)",
                vec![json!("audit-1"), json!("order-1"), json!("user-1")],
            ),
            with_expected_rows(
                execute(
                    "UPDATE order_sequences SET next_number = 3 WHERE year = ?",
                    vec![json!(2026)],
                ),
                1,
                "order sequence missing",
            ),
            with_expected_rows(
                select("SELECT id FROM customers WHERE id = ?", vec![json!("missing")]),
                1,
                "Customer does not exist.",
            ),
        ];

        let error = state
            .local_batch(statements)
            .await
            .expect_err("the guarded select should abort the whole order write");
        assert_eq!(error, "Customer does not exist.");
        for table in [
            "local_users",
            "customers",
            "order_sequences",
            "orders",
            "order_items",
            "payments",
            "audit_log",
        ] {
            let query = format!("SELECT COUNT(*) AS count FROM {table}");
            let count = state.local_select(query, vec![]).await.unwrap()[0]["count"]
                .as_i64()
                .unwrap();
            assert_eq!(count, 0, "{table} must roll back with the batch");
        }
    });
}

#[test]
fn bound_scalar_values_decode_without_sql_interpolation() {
    tauri::async_runtime::block_on(async {
        let temporary = TempDatabase::new();
        let state = open(&temporary.path).await;
        let rows = state
            .local_select(
                "SELECT ? AS null_value, ? AS bool_value, ? AS integer_value, ? AS real_value, ? AS text_value, X'01ff' AS blob_value".to_string(),
                vec![Value::Null, json!(true), json!(42), json!(2.5), json!("laundry")],
            )
            .await
            .expect("JSON scalar parameters should bind");
        let row = &rows[0];
        assert_eq!(row["null_value"], Value::Null);
        assert_eq!(row["bool_value"], json!(1));
        assert_eq!(row["integer_value"], json!(42));
        assert_eq!(row["real_value"], json!(2.5));
        assert_eq!(row["text_value"], json!("laundry"));
        assert_eq!(row["blob_value"], json!([1, 255]));

        let error = state
            .local_select("SELECT ?".to_string(), vec![json!([1, 2])])
            .await
            .unwrap_err();
        assert!(error.contains("must be a scalar or null"));
        let error = state
            .local_select("SELECT ?".to_string(), vec![json!(u64::MAX)])
            .await
            .unwrap_err();
        assert!(error.contains("larger than SQLite's integer range"));

        let numeric = state
            .local_select(
                "SELECT CAST(1 AS NUMERIC) AS numeric_value".to_string(),
                vec![],
            )
            .await
            .expect("SQLite NUMERIC affinity should return an integer value");
        assert_eq!(numeric[0]["numeric_value"], json!(1));
        let invalid_text = state
            .local_select(
                "SELECT CAST(X'ff' AS TEXT) AS invalid_utf8".to_string(),
                vec![],
            )
            .await
            .unwrap_err();
        assert!(invalid_text.contains("Could not decode SQLite text"));

        let infinite_real = state
            .local_select("SELECT 1e999 AS infinite_real".to_string(), vec![])
            .await
            .unwrap_err();
        assert!(
            infinite_real.contains("non-finite real value"),
            "unexpected error for a non-finite SQLite REAL: {infinite_real}"
        );
    });
}

#[test]
fn query_failures_roll_back_batches_and_report_unexpected_row_counts() {
    tauri::async_runtime::block_on(async {
        let temporary = TempDatabase::new();
        let state = open(&temporary.path).await;

        let malformed = state
            .local_select("SELECT FROM app_settings".to_string(), vec![])
            .await
            .unwrap_err();
        assert!(malformed.contains("Database query failed"), "{malformed}");

        let read_batch_error = state
            .local_read_batch(vec![
                select("SELECT 1 AS value", vec![]),
                select("SELECT FROM app_settings", vec![]),
            ])
            .await
            .unwrap_err();
        assert!(
            read_batch_error.contains("Database read failed"),
            "{read_batch_error}"
        );
        assert_eq!(
            state
                .local_select("SELECT 1 AS value".to_string(), vec![])
                .await
                .unwrap()[0]["value"],
            json!(1),
            "a failed read batch should roll back its read snapshot"
        );

        let batch_read_error = state
            .local_batch(vec![select("SELECT FROM app_settings", vec![])])
            .await
            .unwrap_err();
        assert!(
            batch_read_error.contains("Database batch read failed"),
            "{batch_read_error}"
        );

        let batch_write_error = state
            .local_batch(vec![
                execute(
                    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                    vec![json!("rolled-back-marker"), json!("must not persist")],
                ),
                execute(
                    "INSERT INTO missing_table (value) VALUES (?)",
                    vec![json!("force a SQLite execution error")],
                ),
            ])
            .await
            .unwrap_err();
        assert!(
            batch_write_error.contains("Database batch write failed"),
            "{batch_write_error}"
        );
        assert_eq!(marker_value(&state, "rolled-back-marker").await, None);

        let mut missing_row = execute(
            "UPDATE app_settings SET value = value WHERE key = ? AND value = ?",
            vec![json!("missing-marker"), json!("old value")],
        );
        missing_row.expected_rows = Some(1);
        assert_eq!(
            state.local_batch(vec![missing_row]).await.unwrap_err(),
            "Expected 1 affected row(s), got 0."
        );
    });
}

#[test]
fn trigger_rollback_reports_failed_transaction_rollback_without_persisting_writes() {
    tauri::async_runtime::block_on(async {
        let temporary = TempDatabase::new();
        let state = open(&temporary.path).await;
        seed_marker(&state, "preexisting-marker", "keep").await;

        sqlx::query(
            "CREATE TRIGGER rollback_test_insert BEFORE INSERT ON app_settings WHEN NEW.key = 'rollback-trigger' BEGIN SELECT RAISE(ROLLBACK, 'trigger requested rollback'); END",
        )
        .execute(&state.pools().unwrap().writer)
        .await
        .expect("the rollback trigger should be installed after schema validation");

        let error = state
            .local_batch(vec![execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES ('rollback-trigger', 'discard', CURRENT_TIMESTAMP)",
                vec![],
            )])
            .await
            .expect_err("RAISE(ROLLBACK) should abort the whole write transaction");
        assert!(error.contains("trigger requested rollback"), "{error}");
        assert!(
            error.contains("The write transaction rollback also failed"),
            "SQLite already rolled back the transaction: {error}"
        );
        assert_eq!(marker_value(&state, "rollback-trigger").await, None);
        assert_eq!(
            marker_value(&state, "preexisting-marker").await.as_deref(),
            Some("keep")
        );
    });
}

#[test]
fn closed_database_pools_report_errors_and_preserve_the_active_database() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        create_database_with_marker(&live.path, "still-active").await;
        create_database_with_marker(&source.path, "staged-source").await;
        let state = open(&live.path).await;

        state.pools().unwrap().writer.close().await;
        let write_error = state
            .local_batch(vec![execute("DELETE FROM app_settings", vec![])])
            .await
            .unwrap_err();
        assert!(
            write_error.contains("Could not acquire the writable database connection"),
            "{write_error}"
        );
        let backup_error = state.backup_database().await.unwrap_err();
        assert!(
            backup_error.contains("Could not acquire the writable database connection"),
            "{backup_error}"
        );

        let restore_error = state
            .restore_database(source.path.to_string_lossy().to_string())
            .apply()
            .await
            .unwrap_err();
        assert!(
            restore_error.contains("Could not acquire the writable database connection"),
            "{restore_error}"
        );
        assert!(!pending_restore_path(&live.path).exists());
        assert_eq!(
            marker_value(&state, "restore-marker").await.as_deref(),
            Some("still-active")
        );

        state.pools().unwrap().reader.close().await;
        let select_error = state
            .local_select("SELECT 1".to_string(), vec![])
            .await
            .unwrap_err();
        assert!(
            select_error.contains("Database query failed"),
            "{select_error}"
        );
        let read_batch_error = state.local_read_batch(vec![]).await.unwrap_err();
        assert!(
            read_batch_error.contains("Could not acquire a read-only database connection"),
            "{read_batch_error}"
        );
        drop(state);

        let verification_pool = connect_reader_pool(&live.path, 1).await.unwrap();
        let marker: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'restore-marker'")
                .fetch_one(&verification_pool)
                .await
                .unwrap();
        assert_eq!(marker, "still-active");
        verification_pool.close().await;
    });
}

#[test]
fn sql_guard_rejects_controls_comments_writes_and_multiple_statements() {
    tauri::async_runtime::block_on(async {
        let temporary = TempDatabase::new();
        let state = open(&temporary.path).await;
        for query in [
            "UPDATE app_settings SET value = 'x'",
            "PRAGMA user_version",
            "ATTACH DATABASE 'x' AS x",
            "SELECT 1; DELETE FROM app_settings",
            "SELECT 1 -- hidden suffix",
            "SELECT 1 /* hidden suffix */",
            "SELECT 'unterminated",
            "WITH row AS (SELECT 1) SELECT * FROM row",
        ] {
            assert!(
                state.local_select(query.to_string(), vec![]).await.is_err(),
                "{query}"
            );
        }
        let literal = state
            .local_select("SELECT 'semi;colon' AS value".to_string(), vec![])
            .await
            .expect("a separator inside a quoted literal is data");
        assert_eq!(literal[0]["value"], json!("semi;colon"));

        let leading_whitespace = state
            .local_select(" \n\tSELECT 1 AS value".to_string(), vec![])
            .await
            .expect("leading whitespace should not hide a SELECT statement");
        assert_eq!(leading_whitespace[0]["value"], json!(1));

        let escaped_identifier_quote = state
            .local_select(r#"SELECT 'quoted' AS "semi"";--/*""#.to_string(), vec![])
            .await
            .expect("escaped quotes and comment tokens inside an identifier are data");
        assert_eq!(escaped_identifier_quote[0]["semi\";--/*"], json!("quoted"));

        let bracket_identifier = state
            .local_select(r#"SELECT 'bracket' AS [semi;--/*]"#.to_string(), vec![])
            .await
            .expect("bracket-quoted comment tokens and separators are data");
        assert_eq!(bracket_identifier[0]["semi;--/*"], json!("bracket"));

        let empty_error = state
            .local_select(" \n\t".to_string(), vec![])
            .await
            .expect_err("an empty statement should fail the leading keyword guard");
        assert_eq!(empty_error, "Only SELECT statements are allowed for reads.");

        let error = state
            .local_batch(vec![execute("SELECT 1", vec![])])
            .await
            .unwrap_err();
        assert!(error.contains("Only INSERT"));

        let mut read_only = state.pools().unwrap().reader.acquire().await.unwrap();
        assert!(
            sqlx::query("UPDATE app_settings SET value = 'x' WHERE key = 'device_id'")
                .execute(&mut *read_only)
                .await
                .is_err()
        );
    });
}

#[test]
fn concurrent_sequence_batches_allocate_unique_contiguous_numbers() {
    let temporary = TempDatabase::new();
    let state = tauri::async_runtime::block_on(open(&temporary.path));
    let numbers = std::thread::scope(|scope| {
        let workers = 16;
        let handles = (0..workers)
            .map(|_| {
                scope.spawn(|| {
                    tauri::async_runtime::block_on(state.local_batch(vec![
                        execute(
                            "INSERT INTO order_sequences (year, next_number) VALUES (2026, 1) ON CONFLICT(year) DO NOTHING",
                            vec![],
                        ),
                        with_expected_rows(
                            select("SELECT next_number FROM order_sequences WHERE year = 2026", vec![]),
                            1,
                            "sequence row missing",
                        ),
                        with_expected_rows(
                            execute("UPDATE order_sequences SET next_number = next_number + 1 WHERE year = 2026", vec![]),
                            1,
                            "sequence update failed",
                        ),
                    ]))
                    .expect("each sequence transaction should commit")[1]
                        .rows
                        .as_ref()
                        .unwrap()[0]["next_number"]
                        .as_i64()
                        .unwrap()
                })
            })
            .collect::<Vec<_>>();
        handles
            .into_iter()
            .map(|handle| handle.join().expect("worker should complete"))
            .collect::<Vec<_>>()
    });

    let mut sorted = numbers;
    sorted.sort_unstable();
    assert_eq!(sorted, (1..=16).collect::<Vec<_>>());
    let next = tauri::async_runtime::block_on(state.local_select(
        "SELECT next_number FROM order_sequences WHERE year = 2026".to_string(),
        vec![],
    ))
    .unwrap();
    assert_eq!(next[0]["next_number"], json!(17));
}

#[test]
fn second_database_instance_is_rejected_without_changing_live_data() {
    tauri::async_runtime::block_on(async {
        let temporary = TempDatabase::new();
        let first = open(&temporary.path).await;
        seed_marker(&first, "instance-marker", "first").await;

        let second = open(&temporary.path).await;
        assert!(second
            .info()
            .error
            .as_deref()
            .unwrap()
            .contains("Another Smart Laundry POS instance"));
        let error = second
            .local_batch(vec![execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES ('blocked', 'yes', CURRENT_TIMESTAMP)",
                vec![],
            )])
            .await
            .unwrap_err();
        assert!(error.contains("Another Smart Laundry POS instance"));
        assert_eq!(
            marker_value(&first, "instance-marker").await.as_deref(),
            Some("first")
        );
        assert_eq!(marker_value(&first, "blocked").await, None);
    });
}

#[test]
fn startup_rejects_future_schema_and_foreign_key_corruption_before_repair() {
    tauri::async_runtime::block_on(async {
        let future = TempDatabase::new();
        create_schema_file(&future.path, SCHEMA_VERSION + 1).await;
        let future_state = open(&future.path).await;
        assert!(future_state
            .info()
            .error
            .as_deref()
            .unwrap()
            .contains("unsupported schema version"));
        assert!(future_state
            .local_select("SELECT 1".to_string(), vec![])
            .await
            .is_err());
        drop(future_state);

        let corrupt = TempDatabase::new();
        create_schema_file(&corrupt.path, SCHEMA_VERSION).await;
        let setup = connect_writer_pool(&corrupt.path, false, 1).await.unwrap();
        let mut connection = setup.acquire().await.unwrap();
        sqlx::query("UPDATE app_settings SET value = '' WHERE key = 'device_id'")
            .execute(&mut *connection)
            .await
            .unwrap();
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&mut *connection)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO order_items (id, order_id, item_name, service_name, service_type, created_at) VALUES ('orphan', 'missing-order', 'Shirt', 'Wash', 'piece', CURRENT_TIMESTAMP)",
        )
        .execute(&mut *connection)
        .await
        .unwrap();
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&mut *connection)
            .await
            .unwrap();
        drop(connection);
        setup.close().await;

        let invalid = open(&corrupt.path).await;
        assert!(invalid
            .info()
            .error
            .as_deref()
            .unwrap()
            .contains("foreign-key violation"));
        drop(invalid);
        let verify_pool = connect_reader_pool(&corrupt.path, 1).await.unwrap();
        let device_id: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'device_id'")
                .fetch_one(&verify_pool)
                .await
                .unwrap();
        assert_eq!(
            device_id, "",
            "startup must validate before device-id repair"
        );
        verify_pool.close().await;
    });
}

#[test]
fn database_validation_rejects_a_corrupt_sqlite_index_root_page() {
    tauri::async_runtime::block_on(async {
        let temporary = TempDatabase::new();
        create_database_with_marker(&temporary.path, "corruption-fixture").await;

        let pool = connect_writer_pool(&temporary.path, false, 1)
            .await
            .expect("the valid fixture database should open before corruption");
        sqlx::query("PRAGMA writable_schema = ON")
            .execute(&pool)
            .await
            .expect("the test connection should allow a controlled schema corruption");
        let changed = sqlx::query(
            "UPDATE sqlite_master SET rootpage = (SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'customers') WHERE type = 'index' AND name = 'idx_customers_phone'",
        )
        .execute(&pool)
        .await
        .expect("the target index metadata should be updated in the isolated fixture");
        assert_eq!(changed.rows_affected(), 1);
        sqlx::query("PRAGMA writable_schema = OFF")
            .execute(&pool)
            .await
            .expect("writable_schema should be disabled after the fixture mutation");
        pool.close().await;

        let error = validate_database(&temporary.path)
            .await
            .expect_err("integrity_check should reject an index sharing a table root page");
        assert!(error.contains("integrity_check"), "{error}");
    });
}

#[test]
fn failed_startup_can_stage_a_restore_and_recover_after_database_lock_releases() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        create_database_with_marker(&live.path, "locked-original").await;
        create_database_with_marker(&source.path, "replacement-after-startup-error").await;

        let journal_pool = connect_writer_pool(&live.path, false, 1)
            .await
            .expect("the live database should open to prepare the locking fixture");
        let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode = DELETE")
            .fetch_one(&journal_pool)
            .await
            .expect("the database should switch to rollback-journal mode");
        assert_eq!(journal_mode.to_ascii_lowercase(), "delete");
        journal_pool.close().await;

        let locking_pool = connect_writer_pool(&live.path, false, 1)
            .await
            .expect("the live database should open before the exclusive lock");
        let mut locking_connection = locking_pool.acquire().await.unwrap();
        sqlx::query("BEGIN EXCLUSIVE")
            .execute(&mut *locking_connection)
            .await
            .expect("the fixture should prevent startup from reading the database");

        let failed_startup = open(&live.path).await;
        let startup_error = failed_startup
            .info()
            .error
            .expect("an exclusive SQLite lock should fail startup");
        assert!(
            startup_error.contains("locked") || startup_error.contains("busy"),
            "{startup_error}"
        );

        failed_startup
            .restore_database(source.path.to_string_lossy().to_string())
            .apply()
            .await
            .expect("a failed startup with the instance lock should still stage a valid backup");
        assert!(pending_restore_path(&live.path).exists());

        sqlx::query("ROLLBACK")
            .execute(&mut *locking_connection)
            .await
            .expect("the external SQLite lock should release without changing live data");
        drop(locking_connection);
        locking_pool.close().await;
        drop(failed_startup);

        let verify_pool = connect_reader_pool(&live.path, 1)
            .await
            .expect("the original database should remain readable after the lock releases");
        let original_marker: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'restore-marker'")
                .fetch_one(&verify_pool)
                .await
                .unwrap();
        assert_eq!(original_marker, "locked-original");
        verify_pool.close().await;

        let restored = open(&live.path).await;
        assert_eq!(restored.info().error, None);
        assert_eq!(restored.info().warning, None);
        assert!(!restored.info().restore_pending);
        assert_eq!(
            marker_value(&restored, "restore-marker").await.as_deref(),
            Some("replacement-after-startup-error")
        );
    });
}

#[test]
fn backup_is_consistent_and_restore_stages_before_apply() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        create_database_with_marker(&live.path, "original").await;
        create_database_with_marker(&source.path, "restored").await;

        let live_state = open(&live.path).await;
        let existing_snapshot = live.directory.join("existing-snapshot.db");
        fs::write(&existing_snapshot, b"preserve the existing snapshot target").unwrap();
        let mut writer = live_state.pools().unwrap().writer.acquire().await.unwrap();
        assert_eq!(
            vacuum_into(&mut writer, &existing_snapshot)
                .await
                .unwrap_err(),
            "The database snapshot target already exists."
        );
        assert_eq!(
            fs::read(&existing_snapshot).unwrap(),
            b"preserve the existing snapshot target"
        );
        drop(writer);

        let backup = live_state
            .backup_database()
            .await
            .expect("VACUUM INTO backup should succeed");
        let backup_path = PathBuf::from(&backup);
        assert!(backup_path.exists());
        validate_database(&backup_path)
            .await
            .expect("the backup should pass full SQLite validation");
        assert_eq!(
            marker_value(&live_state, "restore-marker").await.as_deref(),
            Some("original")
        );

        let message = live_state
            .restore_database(source.path.to_string_lossy().to_string())
            .apply()
            .await
            .expect("restore should stage after validating the source");
        assert!(message.contains("Close and reopen"));
        assert!(live_state.info().restore_pending);
        assert_eq!(
            marker_value(&live_state, "restore-marker").await.as_deref(),
            Some("original"),
            "staging must leave the live database unchanged until restart"
        );
        let duplicate_restore = live_state
            .restore_database(source.path.to_string_lossy().to_string())
            .apply()
            .await
            .unwrap_err();
        assert!(duplicate_restore.contains("A database restore is already staged."));
        assert!(pending_restore_path(&live.path).exists());
        let ready_snapshot = live.directory.join("another-ready-snapshot.db");
        fs::write(&ready_snapshot, b"keep the staged snapshot").unwrap();
        assert_eq!(
            publish_pending_snapshot(&ready_snapshot, &live.path).unwrap_err(),
            "A database restore is already staged."
        );
        assert_eq!(
            fs::read(&ready_snapshot).unwrap(),
            b"keep the staged snapshot"
        );
        assert_eq!(
            marker_value(&live_state, "restore-marker").await.as_deref(),
            Some("original"),
            "a second restore request must not replace the staged restore"
        );
        let blocked = live_state
            .local_batch(vec![execute("DELETE FROM app_settings", vec![])])
            .await
            .unwrap_err();
        assert!(blocked.contains("restore is staged"));
        drop(live_state);

        let restored = open(&live.path).await;
        assert_eq!(restored.info().error, None);
        assert!(!restored.info().restore_pending);
        assert_eq!(
            marker_value(&restored, "restore-marker").await.as_deref(),
            Some("restored")
        );
        let recovery_backups = fs::read_dir(live.directory.join("backups"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("laundry-recovery-")
            })
            .count();
        assert_eq!(recovery_backups, 1);
    });
}

#[test]
fn restore_waits_for_the_writer_before_backing_up_and_staging_the_selected_snapshot() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        create_database_with_marker(&live.path, "original").await;
        create_database_with_marker(&source.path, "selected-replacement").await;

        let active = open(&live.path).await;
        let mut writer = active.pools().unwrap().writer.acquire().await.unwrap();
        sqlx::query("BEGIN IMMEDIATE")
            .execute(&mut *writer)
            .await
            .expect("the fixture should hold the sole writer transaction");
        sqlx::query(
            "INSERT INTO app_settings (key, value, updated_at) VALUES ('overlap-marker', 'committed-after-snapshot', CURRENT_TIMESTAMP)",
        )
        .execute(&mut *writer)
        .await
        .expect("the marker should remain uncommitted while restore prepares its snapshot");

        let request = active.restore_database(source.path.to_string_lossy().to_string());
        let (result_sender, result_receiver) = std::sync::mpsc::sync_channel(1);
        let restore_task = std::thread::spawn(move || {
            let result = tauri::async_runtime::block_on(request.apply());
            let _ = result_sender.send(result);
        });

        let deadline = Instant::now() + Duration::from_secs(10);
        let mut ready_snapshot_exists = false;
        while Instant::now() < deadline {
            ready_snapshot_exists = fs::read_dir(&live.directory)
                .unwrap()
                .filter_map(Result::ok)
                .any(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("laundry-restore-ready-")
                });
            if ready_snapshot_exists || restore_task.is_finished() {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }

        sqlx::query("COMMIT")
            .execute(&mut *writer)
            .await
            .expect("the writer should commit before restore creates its safety backup");
        drop(writer);

        let restore_result = result_receiver
            .recv_timeout(Duration::from_secs(10))
            .expect("restore should finish after the sole writer connection is released");
        restore_task
            .join()
            .expect("the restore worker should return without panicking");
        assert!(
            ready_snapshot_exists,
            "restore should prepare the selected snapshot before waiting for the writer; result: {restore_result:?}"
        );
        let message = restore_result.expect("restore should stage the selected snapshot");
        assert!(message.contains("Close and reopen"));

        let pending = pending_restore_path(&live.path);
        assert!(pending.exists());
        let selected_pool = connect_reader_pool(&pending, 1)
            .await
            .expect("the selected snapshot should be readable");
        let selected_marker: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'restore-marker'")
                .fetch_one(&selected_pool)
                .await
                .unwrap();
        let selected_overlap_marker: Option<String> =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'overlap-marker'")
                .fetch_optional(&selected_pool)
                .await
                .unwrap();
        selected_pool.close().await;
        assert_eq!(selected_marker, "selected-replacement");
        assert_eq!(selected_overlap_marker, None);

        let backups = fs::read_dir(backup_directory(&live.path).unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                name.starts_with("laundry-")
                    && !name.starts_with("laundry-recovery-")
                    && entry
                        .path()
                        .extension()
                        .is_some_and(|extension| extension == "db")
            })
            .map(|entry| entry.path())
            .collect::<Vec<_>>();
        assert_eq!(backups.len(), 1, "restore should create one safety backup");
        let safety_backup = connect_reader_pool(&backups[0], 1)
            .await
            .expect("the safety backup should be readable");
        let backed_up_marker: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'overlap-marker'")
                .fetch_one(&safety_backup)
                .await
                .unwrap();
        safety_backup.close().await;
        assert_eq!(backed_up_marker, "committed-after-snapshot");

        let rejected_write = active
            .local_batch(vec![execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES ('blocked-after-stage', 'no', CURRENT_TIMESTAMP)",
                vec![],
            )])
            .await
            .unwrap_err();
        assert!(rejected_write.contains("restore is staged"));
        drop(active);

        let restored = open(&live.path).await;
        assert_eq!(restored.info().error, None);
        assert_eq!(
            marker_value(&restored, "restore-marker").await.as_deref(),
            Some("selected-replacement")
        );
        assert_eq!(marker_value(&restored, "overlap-marker").await, None);
        assert_eq!(marker_value(&restored, "blocked-after-stage").await, None);
    });
}

#[test]
fn checkpoint_refuses_to_truncate_wal_while_a_reader_holds_a_snapshot() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        create_database_with_marker(&live.path, "before-reader-checkpoint").await;
        let state = open(&live.path).await;
        let reader_pool = connect_reader_pool(&live.path, 1).await.unwrap();
        let mut reader = reader_pool.acquire().await.unwrap();
        sqlx::query("BEGIN")
            .execute(&mut *reader)
            .await
            .expect("the read-only connection should begin a snapshot");
        sqlx::query("SELECT value FROM app_settings WHERE key = 'restore-marker'")
            .fetch_one(&mut *reader)
            .await
            .expect("the read should pin the original WAL snapshot");

        state
            .local_batch(vec![execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES ('after-reader-snapshot', 'pending-wal-frame', CURRENT_TIMESTAMP)",
                vec![],
            )])
            .await
            .expect("the writer should add a frame after the pinned reader snapshot");

        let error = checkpoint_database(&live.path)
            .await
            .expect_err("a pinned reader must prevent WAL truncation");
        assert!(error.contains("database is busy"), "{error}");

        sqlx::query("ROLLBACK")
            .execute(&mut *reader)
            .await
            .expect("the fixture should release its read snapshot");
        drop(reader);
        reader_pool.close().await;
        checkpoint_database(&live.path)
            .await
            .expect("checkpoint should complete after the reader releases its snapshot");
        assert_eq!(
            marker_value(&state, "after-reader-snapshot")
                .await
                .as_deref(),
            Some("pending-wal-frame")
        );
    });
}

#[test]
fn backup_and_restore_prune_errors_remove_new_snapshot_files() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        create_database_with_marker(&live.path, "original-after-backup-error").await;
        create_database_with_marker(&source.path, "replacement-not-staged").await;

        let backup_directory = backup_directory(&live.path).unwrap();
        fs::create_dir_all(&backup_directory).unwrap();
        fs::create_dir(backup_directory.join("laundry-000.db")).unwrap();
        for index in 1..=BACKUP_LIMIT {
            fs::write(
                backup_directory.join(format!("laundry-{index:03}.db")),
                b"old backup fixture",
            )
            .unwrap();
        }

        let state = open(&live.path).await;
        let backup_error = state.backup_database().await.unwrap_err();
        assert!(
            backup_error.contains("Could not remove an expired database backup"),
            "{backup_error}"
        );
        let restore_error = state
            .restore_database(source.path.to_string_lossy().to_string())
            .apply()
            .await
            .unwrap_err();
        assert!(
            restore_error.contains("Could not remove an expired database backup"),
            "{restore_error}"
        );

        let retained_fixture_count = fs::read_dir(&backup_directory)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                name.starts_with("laundry-")
                    && entry
                        .path()
                        .extension()
                        .is_some_and(|extension| extension == "db")
            })
            .count();
        assert_eq!(
            retained_fixture_count,
            BACKUP_LIMIT + 1,
            "failed operations must remove their new backup and ready snapshot"
        );
        assert!(!pending_restore_path(&live.path).exists());
        assert_eq!(
            marker_value(&state, "restore-marker").await.as_deref(),
            Some("original-after-backup-error")
        );
    });
}

#[test]
fn invalid_backup_and_live_database_paths_are_rejected_without_touching_live_data() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        create_database_with_marker(&live.path, "keep").await;
        let state = open(&live.path).await;

        let same_file_error = state
            .restore_database(live.path.to_string_lossy().to_string())
            .apply()
            .await
            .unwrap_err();
        assert!(same_file_error.contains("Choose a backup file"));

        let corrupt = source.directory.join("corrupt.db");
        fs::write(&corrupt, b"not a SQLite database").unwrap();
        assert!(state
            .restore_database(corrupt.to_string_lossy().to_string())
            .apply()
            .await
            .is_err());

        let missing = source.directory.join("missing.db");
        assert!(state
            .restore_database(missing.to_string_lossy().to_string())
            .apply()
            .await
            .unwrap_err()
            .contains("selected database backup does not exist"));

        let future = source.directory.join("future.db");
        create_schema_file(&future, SCHEMA_VERSION + 1).await;
        assert!(state
            .restore_database(future.to_string_lossy().to_string())
            .apply()
            .await
            .unwrap_err()
            .contains("unsupported schema version"));

        let incomplete = source.directory.join("incomplete.db");
        let pool = connect_writer_pool(&incomplete, false, 1).await.unwrap();
        sqlx::query("CREATE TABLE customers (id TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        assert!(state
            .restore_database(incomplete.to_string_lossy().to_string())
            .apply()
            .await
            .is_err());

        let missing_column = source.directory.join("missing-column.db");
        let schema = MIGRATION_SQL
            .replace("  phone TEXT NOT NULL,\n", "")
            .replace(
                "CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);\n",
                "",
            );
        assert_ne!(schema, MIGRATION_SQL);
        let pool = connect_writer_pool(&missing_column, false, 1)
            .await
            .unwrap();
        sqlx::raw_sql(&schema).execute(&pool).await.unwrap();
        pool.close().await;
        let error = state
            .restore_database(missing_column.to_string_lossy().to_string())
            .apply()
            .await
            .unwrap_err();
        assert!(error.contains("missing required column phone"), "{error}");

        assert!(!state.info().restore_pending);
        assert_eq!(
            marker_value(&state, "restore-marker").await.as_deref(),
            Some("keep")
        );
    });
}

#[test]
fn restore_rejects_schema_with_weakened_check_and_unique_constraints() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let weakened = TempDatabase::new();
        create_database_with_marker(&live.path, "keep-active").await;

        let schema = migration_without_constraints();
        let weak_pool = connect_writer_pool(&weakened.path, false, 1)
            .await
            .expect("the altered schema database should open");
        sqlx::raw_sql(&schema)
            .execute(&weak_pool)
            .await
            .expect("the schema should keep all tables, columns, and foreign keys");
        weak_pool.close().await;

        let active = open(&live.path).await;
        let error = active
            .restore_database(weakened.path.to_string_lossy().to_string())
            .apply()
            .await
            .expect_err("a schema without required CHECK and UNIQUE constraints is unsafe");
        assert!(error.contains("incompatible definition"), "{error}");
        assert!(!active.info().restore_pending);
        assert!(!pending_restore_path(&live.path).exists());
        assert_eq!(active.info().error, None);
        assert_eq!(
            marker_value(&active, "restore-marker").await.as_deref(),
            Some("keep-active"),
            "rejecting the weak backup must leave the active database unchanged"
        );
    });
}

#[test]
fn restore_rejects_missing_foreign_keys_and_schema_objects() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let missing_foreign_key = TempDatabase::new();
        let missing_index = TempDatabase::new();
        let extra_table = TempDatabase::new();
        create_database_with_marker(&live.path, "keep-active").await;

        let without_order_item_foreign_key = MIGRATION_SQL.replacen(
            "  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,\n",
            "",
            1,
        );
        assert_ne!(without_order_item_foreign_key, MIGRATION_SQL);
        create_schema_file_from_sql(
            &missing_foreign_key.path,
            &without_order_item_foreign_key,
            SCHEMA_VERSION,
        )
        .await;

        let without_customer_index = MIGRATION_SQL.replace(
            "CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);\n",
            "",
        );
        assert_ne!(without_customer_index, MIGRATION_SQL);
        create_schema_file_from_sql(&missing_index.path, &without_customer_index, SCHEMA_VERSION)
            .await;

        let with_extra_table =
            format!("{MIGRATION_SQL}\nCREATE TABLE unsupported_extension (id TEXT PRIMARY KEY);");
        create_schema_file_from_sql(&extra_table.path, &with_extra_table, SCHEMA_VERSION).await;

        let active = open(&live.path).await;
        let cases = [
            (
                &missing_foreign_key.path,
                "missing a compatible foreign key on order_items.order_id",
            ),
            (
                &missing_index.path,
                "missing schema object index:idx_customers_phone",
            ),
            (
                &extra_table.path,
                "unsupported schema object table:unsupported_extension",
            ),
        ];
        for (backup, expected) in cases {
            let error = active
                .restore_database(backup.to_string_lossy().to_string())
                .apply()
                .await
                .expect_err("schema differences should reject the backup");
            assert!(error.contains(expected), "expected {expected:?}: {error}");
            assert!(!active.info().restore_pending);
            assert_eq!(active.info().error, None);
            assert_eq!(
                marker_value(&active, "restore-marker").await.as_deref(),
                Some("keep-active"),
                "a rejected backup must not change the active database"
            );
        }
    });
}

#[test]
fn restore_rejects_quoted_keywords_that_weaken_not_null_across_sqlite_quote_styles() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        create_database_with_marker(&live.path, "keep-active").await;

        assert_eq!(
            normalize_schema_sql("CREATE TABLE customers (phone TEXT NOT NULL)"),
            normalize_schema_sql(" create table CUSTOMERS ( PHONE text not null ) ")
        );
        let active = open(&live.path).await;
        for (index, quoted_keywords) in [
            "phone TEXT \"NOT\" \"NULL\"",
            "phone TEXT `NOT` `NULL`",
            "phone TEXT [NOT] [NULL]",
        ]
        .into_iter()
        .enumerate()
        {
            assert_ne!(
                normalize_schema_sql("CREATE TABLE customers (phone TEXT NOT NULL)"),
                normalize_schema_sql(&format!("CREATE TABLE customers ({quoted_keywords})")),
                "SQLite quote style {index} must remain distinct from NOT NULL syntax"
            );

            let weakened = TempDatabase::new();
            let altered_schema = MIGRATION_SQL.replacen("phone TEXT NOT NULL", quoted_keywords, 1);
            assert_ne!(altered_schema, MIGRATION_SQL);
            let weak_pool = connect_writer_pool(&weakened.path, false, 1)
                .await
                .expect("the altered schema database should open");
            sqlx::raw_sql(&altered_schema)
                .execute(&weak_pool)
                .await
                .expect("quoted NOT and NULL should be accepted as SQLite column names");
            let customer_columns = sqlx::query("PRAGMA table_info(customers)")
                .fetch_all(&weak_pool)
                .await
                .expect("customer columns should remain available");
            let phone_column = customer_columns
                .iter()
                .find(|row| row.try_get::<String, _>("name").unwrap() == "phone")
                .expect("the phone column should remain present");
            let phone_is_not_null: i64 = phone_column.try_get("notnull").unwrap();
            assert_eq!(
                phone_is_not_null, 0,
                "the quoted keywords weaken the column"
            );
            weak_pool.close().await;

            let error = active
                .restore_database(weakened.path.to_string_lossy().to_string())
                .apply()
                .await
                .expect_err("the weakened NOT NULL constraint must invalidate the backup");
            assert!(error.contains("incompatible definition"), "{error}");
            assert!(!active.info().restore_pending);
            assert!(!pending_restore_path(&live.path).exists());
            assert_eq!(active.info().error, None);
            assert_eq!(
                marker_value(&active, "restore-marker").await.as_deref(),
                Some("keep-active"),
                "rejecting the weakened backup must leave the active database unchanged"
            );
        }
    });
}

#[test]
fn restore_schema_normalization_accepts_ignored_comments_case_and_whitespace() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let equivalent = TempDatabase::new();
        create_database_with_marker(&live.path, "old-database").await;

        let equivalent_schema = MIGRATION_SQL.replacen(
            "phone TEXT NOT NULL",
            "PHONE   text /* harmless comment with NOT NULL and ' tokens */ -- harmless line comment with ' NOT NULL\n   not null",
            1,
        );
        assert_ne!(equivalent_schema, MIGRATION_SQL);
        let pool = connect_writer_pool(&equivalent.path, false, 1)
            .await
            .expect("the equivalent schema database should open");
        sqlx::raw_sql(&equivalent_schema)
            .execute(&pool)
            .await
            .expect("case, comments, and spacing should be accepted by SQLite");
        sqlx::query(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
            .execute(&pool)
            .await
            .expect("the fixture should match the current schema version");
        sqlx::query(
            "INSERT INTO app_settings (key, value, updated_at) VALUES ('restore-marker', 'normalized-replacement', CURRENT_TIMESTAMP)",
        )
        .execute(&pool)
        .await
        .expect("the replacement marker should be written to the fixture");
        pool.close().await;
        validate_database(&equivalent.path)
            .await
            .expect("normalized equivalent schema should satisfy the real database contract");

        let active = open(&live.path).await;
        active
            .restore_database(equivalent.path.to_string_lossy().to_string())
            .apply()
            .await
            .expect("normalization should accept semantically identical SQLite definitions");
        drop(active);

        let restored = open(&live.path).await;
        assert_eq!(restored.info().error, None);
        assert_eq!(
            marker_value(&restored, "restore-marker").await.as_deref(),
            Some("normalized-replacement"),
            "the accepted replacement should become the active database"
        );
        assert!(!pending_restore_path(&live.path).exists());
    });
}

#[test]
fn schema_contract_preserves_escaped_apostrophes_in_string_literals() {
    tauri::async_runtime::block_on(async {
        let altered = TempDatabase::new();
        let schema = MIGRATION_SQL.replacen(
            "CHECK (role IN ('admin'))",
            "CHECK (role IN ('adm''in'))",
            1,
        );
        assert_ne!(schema, MIGRATION_SQL);
        create_schema_file_from_sql(&altered.path, &schema, SCHEMA_VERSION).await;

        let error = validate_database(&altered.path)
            .await
            .expect_err("an escaped apostrophe must remain part of the SQL literal");
        assert!(error.contains("incompatible definition"), "{error}");
        assert_eq!(
            normalize_schema_sql("CREATE TABLE probe (role TEXT CHECK (role = 'adm''in'))"),
            normalize_schema_sql(" create table PROBE ( ROLE text check(role='adm''in') ) "),
            "spacing and case changes must preserve the escaped literal"
        );
    });
}

#[test]
fn schema_normalization_decodes_escaped_identifier_delimiters() {
    assert_eq!(
        normalize_schema_sql(r#"CREATE TABLE "a""b" (value TEXT)"#),
        normalize_schema_sql(r#" create table "A""B" ( VALUE text ) "#)
    );
}

#[test]
fn prepared_restore_installs_without_an_original_database() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        create_database_with_marker(&source.path, "installed-without-original").await;

        let pending = pending_restore_path(&live.path);
        let ready_snapshot = create_recovery_snapshot(&source.path)
            .await
            .expect("the valid source should produce a staged snapshot");
        fs::rename(&ready_snapshot, &pending).unwrap();
        write_apply_journal(
            &live.path,
            &ApplyJournal {
                phase: ApplyPhase::Prepared,
                old_database: None,
                recovery_snapshot: None,
            },
        )
        .unwrap();

        let restored = open(&live.path).await;
        assert_eq!(restored.info().error, None);
        assert_eq!(restored.info().warning, None);
        assert!(!restored.info().restore_pending);
        assert_eq!(
            marker_value(&restored, "restore-marker").await.as_deref(),
            Some("installed-without-original")
        );
        assert!(live.path.exists());
        assert!(!pending.exists());
        assert!(!apply_journal_path(&live.path).exists());
        assert!(validate_database(&live.path).await.is_ok());
    });
}

#[test]
fn staged_restore_installs_without_an_original_database_or_journal() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        create_database_with_marker(&source.path, "installed-from-pending-file").await;

        let pending = pending_restore_path(&live.path);
        let ready_snapshot = create_recovery_snapshot(&source.path)
            .await
            .expect("the valid source should produce a staged snapshot");
        fs::rename(&ready_snapshot, &pending).unwrap();
        assert!(!apply_journal_path(&live.path).exists());

        let restored = open(&live.path).await;
        assert_eq!(restored.info().error, None);
        assert_eq!(restored.info().warning, None);
        assert!(!restored.info().restore_pending);
        assert_eq!(
            marker_value(&restored, "restore-marker").await.as_deref(),
            Some("installed-from-pending-file")
        );
        assert!(live.path.exists());
        assert!(!pending.exists());
        assert!(!apply_journal_path(&live.path).exists());
        assert!(validate_database(&live.path).await.is_ok());
    });
}

#[test]
fn pending_restore_journal_write_error_keeps_original_and_reports_rejected_backup() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        create_database_with_marker(&live.path, "original-after-journal-error").await;
        create_database_with_marker(&source.path, "pending-after-journal-error").await;
        let pending = pending_restore_path(&live.path);
        let replacement = create_recovery_snapshot(&source.path).await.unwrap();
        fs::rename(&replacement, &pending).unwrap();
        let journal_temp = sibling_named(&live.path, "laundry.restore.apply.json.tmp");
        fs::create_dir(&journal_temp).unwrap();

        let recovered = open(&live.path).await;
        let info = recovered.info();
        assert_eq!(info.error, None);
        assert!(!info.restore_pending);
        let warning = info
            .warning
            .expect("startup should report failure to begin the staged replacement");
        assert!(warning.contains("restore reported an error"), "{warning}");
        assert!(
            warning.contains("The active database passed validation."),
            "{warning}"
        );
        assert!(
            warning.contains("Check the database records before continuing."),
            "{warning}"
        );
        assert!(
            warning.contains("Could not write the restore journal"),
            "{warning}"
        );
        assert!(
            warning.contains("rejected staged file was preserved"),
            "{warning}"
        );
        assert!(!pending.exists());
        assert!(!apply_journal_path(&live.path).exists());
        assert_eq!(
            marker_value(&recovered, "restore-marker").await.as_deref(),
            Some("original-after-journal-error")
        );

        let rejected = fs::read_dir(&live.directory)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.starts_with("restore-rejected-") && name.ends_with(".db")
                    })
            })
            .expect("the pending source should be retained after the journal error");
        assert!(validate_database(&rejected).await.is_ok());
        let rejected_pool = connect_reader_pool(&rejected, 1).await.unwrap();
        let rejected_marker: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'restore-marker'")
                .fetch_one(&rejected_pool)
                .await
                .unwrap();
        assert_eq!(rejected_marker, "pending-after-journal-error");
        rejected_pool.close().await;
    });
}

#[test]
fn first_startup_journal_write_error_preserves_valid_pending_restore_for_retry() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        create_database_with_marker(&source.path, "first-startup-retry").await;
        let pending = pending_restore_path(&live.path);
        let replacement = create_recovery_snapshot(&source.path).await.unwrap();
        fs::rename(&replacement, &pending).unwrap();
        let journal_temp = sibling_named(&live.path, "laundry.restore.apply.json.tmp");
        fs::create_dir(&journal_temp).unwrap();

        let failed = open(&live.path).await;
        let info = failed.info();
        let error = info
            .error
            .expect("startup should fail when it cannot create the restore journal");
        assert!(
            error.contains("Could not write the restore journal"),
            "{error}"
        );
        assert!(info.restore_pending);
        assert!(!live.path.exists());
        assert!(pending.exists());
        assert!(!apply_journal_path(&live.path).exists());
        assert!(validate_database(&pending).await.is_ok());
        let pending_pool = connect_reader_pool(&pending, 1).await.unwrap();
        let pending_marker: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'restore-marker'")
                .fetch_one(&pending_pool)
                .await
                .unwrap();
        assert_eq!(pending_marker, "first-startup-retry");
        pending_pool.close().await;

        drop(failed);
        fs::remove_dir(&journal_temp).unwrap();
        let restored = open(&live.path).await;
        assert_eq!(restored.info().error, None);
        assert_eq!(restored.info().warning, None);
        assert!(!restored.info().restore_pending);
        assert_eq!(
            marker_value(&restored, "restore-marker").await.as_deref(),
            Some("first-startup-retry")
        );
    });
}

#[test]
fn invalid_staged_restore_without_original_preserves_the_pending_file() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let pending = pending_restore_path(&live.path);
        let invalid_snapshot = b"invalid staged database without an original";
        fs::write(&pending, invalid_snapshot).unwrap();

        let failed = open(&live.path).await;
        let info = failed.info();
        let error = info
            .error
            .expect("startup should fail when there is no valid original to open");
        assert!(
            error.contains("there is no original database to open"),
            "{error}"
        );
        assert!(info.restore_pending);
        assert!(!live.path.exists());
        assert!(pending.exists());
        assert_eq!(fs::read(&pending).unwrap(), invalid_snapshot);
    });
}

#[test]
fn prepared_restore_missing_original_journal_field_preserves_live_database() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        create_database_with_marker(&live.path, "original-with-incomplete-journal").await;
        write_apply_journal(
            &live.path,
            &ApplyJournal {
                phase: ApplyPhase::Prepared,
                old_database: None,
                recovery_snapshot: None,
            },
        )
        .unwrap();

        let error = resume_interrupted_restore(&live.path)
            .await
            .expect_err("a prepared journal must name the original before moving it");
        assert!(
            error.contains("missing its original database path"),
            "{error}"
        );
        assert!(live.path.exists());
        assert!(apply_journal_path(&live.path).exists());
        assert!(validate_database(&live.path).await.is_ok());
        let state = open(&live.path).await;
        assert!(state.info().error.is_some());
        let reader = connect_reader_pool(&live.path, 1).await.unwrap();
        let marker: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'restore-marker'")
                .fetch_one(&reader)
                .await
                .unwrap();
        assert_eq!(marker, "original-with-incomplete-journal");
        reader.close().await;
    });
}

#[test]
fn prepared_restore_missing_old_file_keeps_pending_snapshot_and_journal() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        create_database_with_marker(&source.path, "replacement-remains-pending").await;
        let pending = pending_restore_path(&live.path);
        let replacement = create_recovery_snapshot(&source.path).await.unwrap();
        fs::rename(&replacement, &pending).unwrap();
        let missing_old = unique_sibling_path(&live.path, "restore-original", "db").unwrap();
        write_apply_journal(
            &live.path,
            &ApplyJournal {
                phase: ApplyPhase::Prepared,
                old_database: Some(file_name_string(&missing_old).unwrap()),
                recovery_snapshot: None,
            },
        )
        .unwrap();

        let error = resume_interrupted_restore(&live.path)
            .await
            .expect_err("a prepared journal cannot claim a missing original");
        assert!(
            error.contains("cannot find the original database"),
            "{error}"
        );
        assert!(!live.path.exists());
        assert!(!missing_old.exists());
        assert!(pending.exists());
        assert!(apply_journal_path(&live.path).exists());
        assert!(validate_database(&pending).await.is_ok());
    });
}

#[test]
fn prepared_restore_refuses_an_unexpected_existing_original_file() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        create_database_with_marker(&live.path, "active-original").await;
        let old = unique_sibling_path(&live.path, "restore-original", "db").unwrap();
        create_database_with_marker(&old, "unexpected-old-file").await;
        write_apply_journal(
            &live.path,
            &ApplyJournal {
                phase: ApplyPhase::Prepared,
                old_database: Some(file_name_string(&old).unwrap()),
                recovery_snapshot: None,
            },
        )
        .unwrap();

        let error = resume_interrupted_restore(&live.path)
            .await
            .expect_err("the target original path must not overwrite an existing file");
        assert!(
            error.contains("unexpected original database file"),
            "{error}"
        );
        assert!(live.path.exists());
        assert!(old.exists());
        assert!(apply_journal_path(&live.path).exists());
        let active = connect_reader_pool(&live.path, 1).await.unwrap();
        let active_marker: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'restore-marker'")
                .fetch_one(&active)
                .await
                .unwrap();
        assert_eq!(active_marker, "active-original");
        active.close().await;
        let old_state = connect_reader_pool(&old, 1).await.unwrap();
        let old_marker: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'restore-marker'")
                .fetch_one(&old_state)
                .await
                .unwrap();
        assert_eq!(old_marker, "unexpected-old-file");
        old_state.close().await;
    });
}

#[test]
fn failed_startup_restore_replaces_and_preserves_the_previous_pending_file() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        let invalid_snapshot = b"invalid pending file from the failed startup";
        let pending = pending_restore_path(&live.path);
        fs::write(&pending, invalid_snapshot).unwrap();
        create_database_with_marker(&source.path, "replacement-after-failed-startup").await;

        let failed = open(&live.path).await;
        let info = failed.info();
        assert!(info
            .error
            .as_deref()
            .is_some_and(|error| { error.contains("there is no original database to open") }));
        assert!(info.restore_pending);
        assert!(!live.path.exists());

        let message = failed
            .restore_database(source.path.to_string_lossy().to_string())
            .apply()
            .await
            .expect("a failed startup with the instance lock should accept a valid replacement");
        assert!(message.contains("Restore staged"));
        assert!(pending.exists());
        assert!(validate_database(&pending).await.is_ok());

        let rejected = fs::read_dir(&live.directory)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.starts_with("restore-rejected-") && name.ends_with(".db")
                    })
            })
            .expect("the superseded pending file should be preserved under a rejected name");
        assert_eq!(fs::read(rejected).unwrap(), invalid_snapshot);
        drop(failed);

        let restored = open(&live.path).await;
        assert_eq!(restored.info().error, None);
        assert!(!restored.info().restore_pending);
        assert_eq!(
            marker_value(&restored, "restore-marker").await.as_deref(),
            Some("replacement-after-failed-startup")
        );
    });
}

#[test]
fn rejected_pending_restore_warning_is_preserved_with_a_later_initialization_error() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let future_version = SCHEMA_VERSION + 1;
        create_schema_file(&live.path, future_version).await;
        let pending = pending_restore_path(&live.path);
        fs::write(&pending, b"invalid staged replacement").unwrap();

        let failed = open(&live.path).await;
        let info = failed.info();
        let error = info
            .error
            .expect("the unsupported original schema should fail initialization");
        assert!(error.contains("unsupported schema version"), "{error}");
        assert!(
            error.contains("staged database restore failed validation"),
            "startup must retain the earlier restore warning: {error}"
        );
        assert!(!info.restore_pending);
        assert!(!pending.exists());
        let rejected = fs::read_dir(&live.directory)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.starts_with("restore-rejected-") && name.ends_with(".db")
                    })
            })
            .expect("the invalid pending restore should be preserved");
        assert_eq!(fs::read(rejected).unwrap(), b"invalid staged replacement");

        let reader = connect_reader_pool(&live.path, 1)
            .await
            .expect("the original future-version database should remain readable");
        let stored_version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&reader)
            .await
            .unwrap();
        assert_eq!(stored_version, future_version);
        reader.close().await;
    });
}

#[test]
fn invalid_staged_restore_is_quarantined_and_original_database_reopens() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        create_database_with_marker(&live.path, "original-remains-active").await;
        create_database_with_marker(&source.path, "valid-replacement").await;

        let active = open(&live.path).await;
        active
            .restore_database(source.path.to_string_lossy().to_string())
            .apply()
            .await
            .expect("a valid backup should be staged");
        drop(active);

        let pending = pending_restore_path(&live.path);
        assert!(
            pending.exists(),
            "the staged backup should be ready for restart"
        );
        fs::write(&pending, b"corrupted after validation").unwrap();

        let recovered = open(&live.path).await;
        let info = recovered.info();
        assert_eq!(
            info.error, None,
            "the valid original database must still open"
        );
        assert!(
            !info.restore_pending,
            "the rejected file must not trigger another startup attempt"
        );
        let warning = info
            .warning
            .expect("startup should report the rejected staged restore");
        assert!(warning.contains("restore failed validation"), "{warning}");
        assert!(
            warning.contains("active database was not replaced"),
            "{warning}"
        );
        assert!(
            !pending.exists(),
            "the corrupt staged file should leave the pending path"
        );
        assert_eq!(
            marker_value(&recovered, "restore-marker").await.as_deref(),
            Some("original-remains-active")
        );

        let rejected = fs::read_dir(&live.directory)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.starts_with("restore-rejected-") && name.ends_with(".db")
                    })
            })
            .expect("the corrupt staged database should be preserved under a rejected name");
        assert_eq!(fs::read(&rejected).unwrap(), b"corrupted after validation");
        drop(recovered);

        let reopened = open(&live.path).await;
        assert_eq!(reopened.info().error, None);
        assert_eq!(reopened.info().warning, None);
        assert_eq!(
            marker_value(&reopened, "restore-marker").await.as_deref(),
            Some("original-remains-active"),
            "the next startup should use the original database without a retry loop"
        );
    });
}

#[test]
fn interrupted_restore_after_install_finishes_without_removing_recovery_snapshot() {
    tauri::async_runtime::block_on(async {
        let temporary = TempDatabase::new();
        let source = temporary.directory.join("source.db");
        let pending = pending_restore_path(&temporary.path);
        create_database_with_marker(&temporary.path, "before").await;
        create_database_with_marker(&source, "after").await;
        let replacement_snapshot = create_recovery_snapshot(&source).await.unwrap();
        fs::rename(&replacement_snapshot, &pending).unwrap();

        let recovery = create_recovery_snapshot(&temporary.path).await.unwrap();
        let old = unique_sibling_path(&temporary.path, "restore-original", "db").unwrap();
        fs::rename(&temporary.path, &old).unwrap();
        fs::rename(&pending, &temporary.path).unwrap();
        write_apply_journal(
            &temporary.path,
            &ApplyJournal {
                phase: ApplyPhase::OriginalMoved,
                old_database: Some(file_name_string(&old).unwrap()),
                recovery_snapshot: Some(file_name_string(&recovery).unwrap()),
            },
        )
        .unwrap();

        assert_eq!(
            recover_interrupted_restore(&temporary.path)
                .await
                .expect("valid installed replacement should complete journal recovery"),
            None
        );
        assert!(temporary.path.exists());
        assert!(!old.exists());
        assert!(recovery.exists());
        assert!(!apply_journal_path(&temporary.path).exists());
        validate_database(&temporary.path).await.unwrap();
        let restored = open(&temporary.path).await;
        assert_eq!(
            marker_value(&restored, "restore-marker").await.as_deref(),
            Some("after")
        );
    });
}

#[test]
fn replacement_installed_journal_finishes_after_original_cleanup_already_completed() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        create_database_with_marker(&live.path, "replacement-after-cleanup").await;
        let already_removed_original =
            unique_sibling_path(&live.path, "restore-original", "db").unwrap();
        assert!(!already_removed_original.exists());
        write_apply_journal(
            &live.path,
            &ApplyJournal {
                phase: ApplyPhase::ReplacementInstalled,
                old_database: Some(file_name_string(&already_removed_original).unwrap()),
                recovery_snapshot: None,
            },
        )
        .unwrap();

        let recovered = open(&live.path).await;
        assert_eq!(recovered.info().error, None);
        assert_eq!(recovered.info().warning, None);
        assert!(!recovered.info().restore_pending);
        assert!(!apply_journal_path(&live.path).exists());
        assert_eq!(
            marker_value(&recovered, "restore-marker").await.as_deref(),
            Some("replacement-after-cleanup")
        );
    });
}

#[test]
fn interrupted_restore_with_missing_pending_file_reopens_the_original_with_warning() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        create_database_with_marker(&live.path, "original-after-missing-pending").await;
        let recovery = create_recovery_snapshot(&live.path)
            .await
            .expect("the original should have a valid recovery snapshot");
        let old = unique_sibling_path(&live.path, "restore-original", "db").unwrap();
        fs::rename(&live.path, &old).unwrap();
        write_apply_journal(
            &live.path,
            &ApplyJournal {
                phase: ApplyPhase::OriginalMoved,
                old_database: Some(file_name_string(&old).unwrap()),
                recovery_snapshot: Some(file_name_string(&recovery).unwrap()),
            },
        )
        .unwrap();
        assert!(!pending_restore_path(&live.path).exists());

        let recovered = open(&live.path).await;
        assert_eq!(recovered.info().error, None);
        assert!(!recovered.info().restore_pending);
        let warning = recovered
            .info()
            .warning
            .expect("startup should report that the interrupted staged file is missing");
        assert!(
            warning.contains("staged restore file is missing"),
            "{warning}"
        );
        assert!(
            warning.contains("The active database passed validation."),
            "{warning}"
        );
        assert!(
            warning.contains("Check the database records before continuing."),
            "{warning}"
        );
        assert!(live.path.exists());
        assert!(!old.exists());
        assert!(!apply_journal_path(&live.path).exists());
        assert_eq!(
            marker_value(&recovered, "restore-marker").await.as_deref(),
            Some("original-after-missing-pending")
        );
        assert!(validate_database(&live.path).await.is_ok());
    });
}

#[test]
fn original_moved_journal_rejects_a_live_database_when_pending_also_exists() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        create_database_with_marker(&live.path, "unexpected-live-file").await;
        create_database_with_marker(&source.path, "pending-replacement").await;
        let old = unique_sibling_path(&live.path, "restore-original", "db").unwrap();
        create_database_with_marker(&old, "preserved-original-file").await;
        let pending = pending_restore_path(&live.path);
        let replacement = create_recovery_snapshot(&source.path).await.unwrap();
        fs::rename(&replacement, &pending).unwrap();
        write_apply_journal(
            &live.path,
            &ApplyJournal {
                phase: ApplyPhase::OriginalMoved,
                old_database: Some(file_name_string(&old).unwrap()),
                recovery_snapshot: None,
            },
        )
        .unwrap();

        let error = resume_interrupted_restore(&live.path)
            .await
            .expect_err("both a live file and pending snapshot conflict with original_moved");
        assert!(error.contains("unexpected database file"), "{error}");
        assert!(live.path.exists());
        assert!(old.exists());
        assert!(pending.exists());
        assert!(apply_journal_path(&live.path).exists());
        for (path, expected) in [
            (&live.path, "unexpected-live-file"),
            (&old, "preserved-original-file"),
            (&pending, "pending-replacement"),
        ] {
            assert!(validate_database(path).await.is_ok());
            let pool = connect_reader_pool(path, 1).await.unwrap();
            let marker: String =
                sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'restore-marker'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(marker, expected);
            pool.close().await;
        }
    });
}

#[test]
fn interrupted_restore_warning_preserves_rejected_pending_after_original_rollback() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        create_database_with_marker(&live.path, "original-after-invalid-pending").await;
        let recovery = create_recovery_snapshot(&live.path).await.unwrap();
        let old = unique_sibling_path(&live.path, "restore-original", "db").unwrap();
        fs::rename(&live.path, &old).unwrap();
        let pending = pending_restore_path(&live.path);
        let invalid_snapshot = b"invalid pending replacement during interrupted restore";
        fs::write(&pending, invalid_snapshot).unwrap();
        write_apply_journal(
            &live.path,
            &ApplyJournal {
                phase: ApplyPhase::OriginalMoved,
                old_database: Some(file_name_string(&old).unwrap()),
                recovery_snapshot: Some(file_name_string(&recovery).unwrap()),
            },
        )
        .unwrap();

        let recovered = open(&live.path).await;
        let info = recovered.info();
        assert_eq!(info.error, None);
        let warning = info
            .warning
            .expect("startup should report the failed interrupted replacement");
        assert!(warning.contains("The active database passed validation."));
        assert!(warning.contains("Check the database records before continuing."));
        assert!(warning.contains("rejected staged file was preserved"));
        assert!(live.path.exists());
        assert!(!old.exists());
        assert!(!pending.exists());
        assert!(!apply_journal_path(&live.path).exists());
        assert_eq!(
            marker_value(&recovered, "restore-marker").await.as_deref(),
            Some("original-after-invalid-pending")
        );

        let rejected = fs::read_dir(&live.directory)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.starts_with("restore-rejected-") && name.ends_with(".db")
                    })
            })
            .expect("the invalid pending file should remain available");
        assert_eq!(fs::read(rejected).unwrap(), invalid_snapshot);
    });
}

#[test]
fn interrupted_restore_compensates_for_corrupt_live_replacement_in_each_phase() {
    tauri::async_runtime::block_on(async {
        for phase in [ApplyPhase::OriginalMoved, ApplyPhase::ReplacementInstalled] {
            let live = TempDatabase::new();
            create_database_with_marker(&live.path, "original-before-corrupt-replacement").await;
            checkpoint_database(&live.path)
                .await
                .expect("the original row should be checkpointed before simulating a crash");
            quarantine_sidecars(&live.path, None)
                .expect("the original database sidecars should be preserved before moving it");
            let old = unique_sibling_path(&live.path, "restore-original", "db").unwrap();
            fs::rename(&live.path, &old).unwrap();
            let original_pool = connect_reader_pool(&old, 1).await.unwrap();
            let original_marker: String =
                sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'restore-marker'")
                    .fetch_one(&original_pool)
                    .await
                    .unwrap();
            assert_eq!(original_marker, "original-before-corrupt-replacement");
            original_pool.close().await;
            let corrupt_replacement = b"corrupt installed replacement";
            fs::write(&live.path, corrupt_replacement).unwrap();
            write_apply_journal(
                &live.path,
                &ApplyJournal {
                    phase,
                    old_database: Some(file_name_string(&old).unwrap()),
                    recovery_snapshot: None,
                },
            )
            .unwrap();

            let recovered = open(&live.path).await;
            let info = recovered.info();
            assert_eq!(info.error, None);
            let warning = info
                .warning
                .expect("startup should report the rejected replacement");
            assert!(
                warning.contains("The active database passed validation."),
                "{phase:?}: {warning}"
            );
            assert!(
                warning.contains("Check the database records before continuing."),
                "{phase:?}: {warning}"
            );
            assert!(live.path.exists());
            assert!(!old.exists());
            assert!(!apply_journal_path(&live.path).exists());
            assert_eq!(
                marker_value(&recovered, "restore-marker").await.as_deref(),
                Some("original-before-corrupt-replacement"),
                "recovery phase {phase:?}"
            );

            let rejected = fs::read_dir(&live.directory)
                .unwrap()
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .find(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| {
                            name.starts_with("restore-rejected-") && name.ends_with(".db")
                        })
                })
                .expect("the corrupt replacement should be preserved");
            assert_eq!(fs::read(rejected).unwrap(), corrupt_replacement);
        }
    });
}

#[test]
fn original_moved_restore_without_original_preserves_invalid_pending_and_journal() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let pending = pending_restore_path(&live.path);
        let invalid_snapshot = b"invalid replacement with no original database";
        fs::write(&pending, invalid_snapshot).unwrap();
        write_apply_journal(
            &live.path,
            &ApplyJournal {
                phase: ApplyPhase::OriginalMoved,
                old_database: None,
                recovery_snapshot: None,
            },
        )
        .unwrap();

        let error = resume_interrupted_restore(&live.path)
            .await
            .expect_err("recovery must fail without an original or valid replacement");
        assert!(error.contains("failed validation"), "{error}");
        assert!(!live.path.exists());
        assert!(pending.exists());
        assert_eq!(fs::read(&pending).unwrap(), invalid_snapshot);
        assert!(apply_journal_path(&live.path).exists());
    });
}

#[test]
fn interrupted_restore_with_invalid_pending_restores_original_and_rejects_unsafe_journal_paths() {
    tauri::async_runtime::block_on(async {
        let temporary = TempDatabase::new();
        let pending = pending_restore_path(&temporary.path);
        create_database_with_marker(&temporary.path, "original").await;
        let recovery = create_recovery_snapshot(&temporary.path).await.unwrap();
        let old = unique_sibling_path(&temporary.path, "restore-original", "db").unwrap();
        fs::rename(&temporary.path, &old).unwrap();
        fs::write(&pending, b"bad staged database").unwrap();
        write_apply_journal(
            &temporary.path,
            &ApplyJournal {
                phase: ApplyPhase::OriginalMoved,
                old_database: Some(file_name_string(&old).unwrap()),
                recovery_snapshot: Some(file_name_string(&recovery).unwrap()),
            },
        )
        .unwrap();

        let error = resume_interrupted_restore(&temporary.path)
            .await
            .expect_err("invalid pending database should abort recovery");
        assert!(error.contains("failed validation"));
        assert!(
            pending.exists(),
            "rejected staged source should remain available"
        );
        assert!(
            !old.exists(),
            "the original file should be restored to its live path"
        );
        assert!(!apply_journal_path(&temporary.path).exists());
        validate_database(&temporary.path).await.unwrap();
        let restored_original = open(&temporary.path).await;
        assert_eq!(
            marker_value(&restored_original, "restore-marker")
                .await
                .as_deref(),
            Some("original")
        );
        drop(restored_original);

        let malicious = ApplyJournal {
            phase: ApplyPhase::OriginalMoved,
            old_database: Some("../outside.db".to_string()),
            recovery_snapshot: None,
        };
        let bytes = serde_json::to_vec(&malicious).unwrap();
        fs::write(apply_journal_path(&temporary.path), bytes).unwrap();
        let path_error = resume_interrupted_restore(&temporary.path)
            .await
            .unwrap_err();
        assert!(path_error.contains("unsafe path"));
    });
}

#[test]
fn unreadable_restore_journal_preserves_the_original_database_and_journal() {
    tauri::async_runtime::block_on(async {
        let temporary = TempDatabase::new();
        create_database_with_marker(&temporary.path, "preserve-on-journal-error").await;
        let journal_path = apply_journal_path(&temporary.path);
        let malformed_journal = b"{ not a restore journal";
        fs::write(&journal_path, malformed_journal).unwrap();

        let state = open(&temporary.path).await;
        let error = state
            .info()
            .error
            .expect("startup should fail safely when its restore journal is malformed");
        assert!(
            error.contains("The restore journal is invalid and was preserved"),
            "{error}"
        );
        assert!(journal_path.exists());
        assert_eq!(fs::read(&journal_path).unwrap(), malformed_journal);
        assert!(validate_database(&temporary.path).await.is_ok());

        let verification_pool = connect_reader_pool(&temporary.path, 1).await.unwrap();
        let marker: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'restore-marker'")
                .fetch_one(&verification_pool)
                .await
                .unwrap();
        assert_eq!(marker, "preserve-on-journal-error");
        verification_pool.close().await;
    });
}

#[test]
fn restore_recovery_preserves_original_after_journal_write_io_error() {
    tauri::async_runtime::block_on(async {
        let temporary = TempDatabase::new();
        create_database_with_marker(&temporary.path, "original-survives-io-error").await;
        let recovery = create_recovery_snapshot(&temporary.path)
            .await
            .expect("recovery snapshot should capture the active database");
        let old = unique_sibling_path(&temporary.path, "restore-original", "db").unwrap();
        write_apply_journal(
            &temporary.path,
            &ApplyJournal {
                phase: ApplyPhase::Prepared,
                old_database: Some(file_name_string(&old).unwrap()),
                recovery_snapshot: Some(file_name_string(&recovery).unwrap()),
            },
        )
        .unwrap();

        let journal_temp = sibling_named(&temporary.path, "laundry.restore.apply.json.tmp");
        fs::create_dir(&journal_temp).unwrap();
        let first_error = recover_interrupted_restore(&temporary.path)
            .await
            .unwrap_err();
        assert!(
            first_error.contains("Could not write the restore journal"),
            "{first_error}"
        );
        assert!(!temporary.path.exists());
        assert!(
            old.exists(),
            "the original file must survive the failed journal write"
        );
        validate_database(&old)
            .await
            .expect("the moved original must remain a valid database");
        assert_eq!(
            read_apply_journal(&temporary.path).unwrap().phase,
            ApplyPhase::Prepared
        );

        fs::remove_dir(&journal_temp).unwrap();
        let warning = recover_interrupted_restore(&temporary.path)
            .await
            .expect("recovery should restore the moved original after IO recovers")
            .expect("startup should report the abandoned restore");
        assert!(
            warning.contains("The active database passed validation."),
            "{warning}"
        );
        assert!(warning.contains("Check the database records before continuing."));
        assert!(temporary.path.exists());
        assert!(!old.exists());
        assert!(!apply_journal_path(&temporary.path).exists());
        validate_database(&temporary.path).await.unwrap();

        let restored = open(&temporary.path).await;
        assert_eq!(restored.info().error, None);
        assert_eq!(
            marker_value(&restored, "restore-marker").await.as_deref(),
            Some("original-survives-io-error")
        );
    });
}

#[test]
fn interrupted_restore_with_missing_recovery_snapshot_restores_original() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        create_database_with_marker(&live.path, "original-before-restore").await;
        create_database_with_marker(&source.path, "replacement-being-rejected").await;

        let pending = pending_restore_path(&live.path);
        let replacement = create_recovery_snapshot(&source.path).await.unwrap();
        fs::rename(&replacement, &pending).unwrap();
        let old = unique_sibling_path(&live.path, "restore-original", "db").unwrap();
        fs::rename(&live.path, &old).unwrap();
        fs::rename(&pending, &live.path).unwrap();
        let missing_recovery = backup_directory(&live.path)
            .unwrap()
            .join("laundry-recovery-missing.db");
        write_apply_journal(
            &live.path,
            &ApplyJournal {
                phase: ApplyPhase::ReplacementInstalled,
                old_database: Some(file_name_string(&old).unwrap()),
                recovery_snapshot: Some(file_name_string(&missing_recovery).unwrap()),
            },
        )
        .unwrap();

        let warning = recover_interrupted_restore(&live.path)
            .await
            .expect("the original should be restored after snapshot validation fails")
            .expect("recovery should report the rejected replacement");
        assert!(
            warning.contains("The active database passed validation."),
            "{warning}"
        );
        assert!(warning.contains("Check the database records before continuing."));
        assert!(live.path.exists());
        assert!(!old.exists());
        assert!(!pending.exists());
        assert!(!apply_journal_path(&live.path).exists());
        validate_database(&live.path).await.unwrap();

        let restored = open(&live.path).await;
        assert_eq!(
            marker_value(&restored, "restore-marker").await.as_deref(),
            Some("original-before-restore")
        );
    });
}

#[test]
fn replacement_installed_journal_without_recovery_snapshot_restores_original() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        let old = unique_sibling_path(&live.path, "restore-original", "db").unwrap();
        create_database_with_marker(&old, "original-from-compensation").await;
        create_database_with_marker(&source.path, "rejected-without-recovery").await;
        let replacement = create_recovery_snapshot(&source.path).await.unwrap();
        fs::rename(&replacement, &live.path).unwrap();
        write_apply_journal(
            &live.path,
            &ApplyJournal {
                phase: ApplyPhase::ReplacementInstalled,
                old_database: Some(file_name_string(&old).unwrap()),
                recovery_snapshot: None,
            },
        )
        .unwrap();

        let error = resume_interrupted_restore(&live.path)
            .await
            .expect_err("an old database without a recovery snapshot must be restored");
        assert!(error.contains("has no recovery snapshot"), "{error}");
        assert!(live.path.exists());
        assert!(!old.exists());
        assert!(!pending_restore_path(&live.path).exists());
        assert!(!apply_journal_path(&live.path).exists());
        assert!(validate_database(&live.path).await.is_ok());
        let restored = open(&live.path).await;
        assert_eq!(
            marker_value(&restored, "restore-marker").await.as_deref(),
            Some("original-from-compensation")
        );

        let rejected = fs::read_dir(&live.directory)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.starts_with("restore-rejected-") && name.ends_with(".db")
                    })
            })
            .expect("the rejected replacement should remain available for inspection");
        assert!(validate_database(&rejected).await.is_ok());
        let rejected_state = connect_reader_pool(&rejected, 1).await.unwrap();
        let rejected_marker: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'restore-marker'")
                .fetch_one(&rejected_state)
                .await
                .unwrap();
        assert_eq!(rejected_marker, "rejected-without-recovery");
        rejected_state.close().await;
    });
}

#[test]
fn replacement_installed_journal_preserves_state_when_original_cleanup_fails() {
    tauri::async_runtime::block_on(async {
        let live = TempDatabase::new();
        let source = TempDatabase::new();
        create_database_with_marker(&source.path, "replacement-remains-active").await;
        let replacement = create_recovery_snapshot(&source.path).await.unwrap();
        fs::rename(&replacement, &live.path).unwrap();

        let old = unique_sibling_path(&live.path, "restore-original", "db").unwrap();
        fs::create_dir(&old).unwrap();
        let recovery = create_recovery_snapshot(&live.path).await.unwrap();
        write_apply_journal(
            &live.path,
            &ApplyJournal {
                phase: ApplyPhase::ReplacementInstalled,
                old_database: Some(file_name_string(&old).unwrap()),
                recovery_snapshot: Some(file_name_string(&recovery).unwrap()),
            },
        )
        .unwrap();

        let error = resume_interrupted_restore(&live.path)
            .await
            .expect_err("the cleanup step should report a directory at the old-file path");
        assert!(
            error.contains("Could not remove the temporary original database"),
            "{error}"
        );
        assert!(live.path.exists());
        assert!(old.is_dir());
        assert!(recovery.exists());
        assert!(apply_journal_path(&live.path).exists());
        let installed_pool = connect_reader_pool(&live.path, 1).await.unwrap();
        let installed_marker: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'restore-marker'")
                .fetch_one(&installed_pool)
                .await
                .unwrap();
        assert_eq!(installed_marker, "replacement-remains-active");
        installed_pool.close().await;
        assert!(validate_database(&recovery).await.is_ok());
    });
}

#[test]
fn restore_sidecars_are_moved_next_to_the_recovery_snapshot() {
    let temporary = TempDatabase::new();
    let recovery_directory = backup_directory(&temporary.path).unwrap();
    fs::create_dir_all(&recovery_directory).unwrap();
    let recovery_snapshot = recovery_directory.join("laundry-recovery-reference.db");
    fs::write(&recovery_snapshot, b"snapshot placeholder").unwrap();
    let wal = sidecar_path(&temporary.path, "-wal");
    let shm = sidecar_path(&temporary.path, "-shm");
    fs::write(&wal, b"wal sidecar contents").unwrap();
    fs::write(&shm, b"shm sidecar contents").unwrap();

    quarantine_sidecars(&temporary.path, Some(&recovery_snapshot)).unwrap();
    assert!(!wal.exists());
    assert!(!shm.exists());

    let mut preserved = fs::read_dir(&recovery_directory)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("pre-restore-sidecar-"))
        })
        .collect::<Vec<_>>();
    preserved.sort();
    assert_eq!(preserved.len(), 2);
    let contents = preserved
        .iter()
        .map(|path| fs::read(path).unwrap())
        .collect::<Vec<_>>();
    assert!(contents.contains(&b"wal sidecar contents".to_vec()));
    assert!(contents.contains(&b"shm sidecar contents".to_vec()));
}

#[test]
fn failed_recovery_snapshot_validation_removes_its_temporary_file() {
    tauri::async_runtime::block_on(async {
        let weak = TempDatabase::new();
        let schema = MIGRATION_SQL.replace(
            "CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);\n",
            "",
        );
        assert_ne!(schema, MIGRATION_SQL);
        create_schema_file_from_sql(&weak.path, &schema, SCHEMA_VERSION).await;

        let error = create_recovery_snapshot(&weak.path)
            .await
            .expect_err("the weak schema must not be accepted as a recovery snapshot");
        assert!(
            error.contains("missing schema object index:idx_customers_phone"),
            "{error}"
        );
        let recovery_directory = backup_directory(&weak.path).unwrap();
        let recovery_files = fs::read_dir(&recovery_directory)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("laundry-recovery-")
            })
            .count();
        assert_eq!(recovery_files, 0, "the invalid snapshot should be removed");
    });
}

#[test]
fn safe_path_helpers_and_backup_retention_keep_only_the_requested_newest_files() {
    let temporary = TempDatabase::new();
    prune_backups(&temporary.path, 0).unwrap();
    let backup_dir = backup_directory(&temporary.path).unwrap();
    fs::create_dir_all(&backup_dir).unwrap();
    let old = backup_dir.join("laundry-a.db");
    let recent = backup_dir.join("laundry-b.db");
    let newest = backup_dir.join("laundry-c.db");
    let unrelated = backup_dir.join("other.db");
    for path in [&old, &recent, &newest, &unrelated] {
        fs::write(path, b"temp").unwrap();
    }
    fs::write(&temporary.path, b"temporary live path").unwrap();
    prune_backups(&temporary.path, 2).unwrap();
    assert!(!old.exists());
    assert!(recent.exists());
    assert!(newest.exists());
    assert!(unrelated.exists());
    assert_eq!(absolute_path(temporary.path.clone()), temporary.path);
    let relative_path = PathBuf::from("relative-database.db");
    assert_eq!(
        absolute_path(relative_path.clone()),
        std::env::current_dir().unwrap().join(relative_path)
    );
    remove_apply_journal(&temporary.path).unwrap();
    assert!(safe_journal_sibling(
        &temporary.path,
        "restore-original-1.db",
        "restore-original-"
    )
    .is_ok());
    assert!(safe_journal_sibling(&temporary.path, "../outside.db", "restore-original-").is_err());
    assert!(safe_journal_sibling(&temporary.path, "other-1.db", "restore-original-").is_err());
    assert!(ensure_not_live_database(&temporary.path, &temporary.path).is_err());
    assert!(
        ensure_not_live_database(&temporary.directory.join("missing.db"), &temporary.path).is_ok()
    );

    let removals = temporary.directory.join("temporary.db");
    fs::write(&removals, b"db").unwrap();
    fs::write(sidecar_path(&removals, "-wal"), b"wal").unwrap();
    fs::write(sidecar_path(&removals, "-shm"), b"shm").unwrap();
    remove_database_files(&removals).unwrap();
    assert!(!removals.exists());
    assert!(!sidecar_path(&removals, "-wal").exists());
    assert!(!sidecar_path(&removals, "-shm").exists());

    let rejected = temporary.directory.join("rejected.db");
    fs::write(&rejected, b"rejected database").unwrap();
    fs::write(sidecar_path(&rejected, "-wal"), b"rejected WAL").unwrap();
    fs::write(sidecar_path(&rejected, "-shm"), b"rejected shared memory").unwrap();
    let preserved = quarantine_database_file(&rejected).unwrap();
    assert!(!rejected.exists());
    assert_eq!(fs::read(&preserved).unwrap(), b"rejected database");
    assert_eq!(
        fs::read(sidecar_path(&preserved, "-wal")).unwrap(),
        b"rejected WAL"
    );
    assert_eq!(
        fs::read(sidecar_path(&preserved, "-shm")).unwrap(),
        b"rejected shared memory"
    );
}
