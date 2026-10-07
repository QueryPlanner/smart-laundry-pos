use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteRow,
};
use sqlx::{Column, Connection, Row, TypeInfo, ValueRef};

const MIGRATION_SQL: &str = include_str!("../migrations/001_initial_schema.sql");
const SCHEMA_VERSION: i64 = 1;
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const WRITER_CONNECTIONS: u32 = 1;
const READER_CONNECTIONS: u32 = 4;
const BACKUP_LIMIT: usize = 30;

static TEMP_PATH_SEQUENCE: AtomicU64 = AtomicU64::new(0);

const REQUIRED_TABLES: &[(&str, &[&str])] = &[
    ("app_meta", &["key", "value", "updated_at"]),
    (
        "local_users",
        &[
            "id",
            "full_name",
            "pin_hash",
            "pin_salt",
            "role",
            "created_at",
            "updated_at",
        ],
    ),
    ("app_settings", &["key", "value", "updated_at"]),
    (
        "customers",
        &[
            "id",
            "customer_code",
            "name",
            "phone",
            "alternate_phone",
            "address",
            "customer_type",
            "notes",
            "created_at",
            "updated_at",
            "version",
            "origin_device_id",
        ],
    ),
    (
        "services",
        &[
            "id",
            "name",
            "description",
            "category",
            "price_per_piece",
            "price_per_kg",
            "active",
            "created_at",
            "updated_at",
            "version",
            "origin_device_id",
        ],
    ),
    ("order_sequences", &["year", "next_number"]),
    (
        "orders",
        &[
            "id",
            "order_number",
            "customer_id",
            "customer_name",
            "customer_phone",
            "order_type",
            "received_at",
            "expected_ready_at",
            "status",
            "subtotal",
            "discount_type",
            "discount_value",
            "discount_amount",
            "total_amount",
            "payment_status",
            "special_instructions",
            "damage_notes",
            "internal_notes",
            "created_by",
            "created_at",
            "updated_at",
            "version",
            "origin_device_id",
        ],
    ),
    (
        "order_items",
        &[
            "id",
            "order_id",
            "service_id",
            "item_name",
            "service_name",
            "service_type",
            "quantity",
            "weight_kg",
            "rate",
            "line_total",
            "created_at",
        ],
    ),
    (
        "payments",
        &[
            "id",
            "order_id",
            "amount",
            "method",
            "reference_number",
            "notes",
            "recorded_at",
            "recorded_by",
            "voided_at",
            "voided_by",
            "void_reason",
            "created_at",
            "updated_at",
            "version",
            "origin_device_id",
        ],
    ),
    (
        "order_status_history",
        &[
            "id",
            "order_id",
            "previous_status",
            "new_status",
            "changed_at",
            "changed_by",
            "notes",
        ],
    ),
    (
        "expenses",
        &[
            "id",
            "expense_date",
            "category",
            "description",
            "amount",
            "payment_method",
            "notes",
            "created_by",
            "created_at",
            "updated_at",
            "version",
            "origin_device_id",
        ],
    ),
    (
        "inventory_items",
        &[
            "id",
            "name",
            "current_quantity",
            "unit",
            "minimum_quantity",
            "purchase_cost",
            "notes",
            "created_at",
            "updated_at",
            "version",
            "origin_device_id",
        ],
    ),
    (
        "inventory_transactions",
        &[
            "id",
            "inventory_item_id",
            "change_quantity",
            "transaction_type",
            "reason",
            "created_by",
            "created_at",
        ],
    ),
    (
        "machines",
        &[
            "id",
            "name",
            "machine_type",
            "capacity",
            "purchase_date",
            "last_maintenance_date",
            "next_maintenance_date",
            "notes",
            "created_at",
            "updated_at",
            "version",
            "origin_device_id",
        ],
    ),
    (
        "audit_log",
        &[
            "id",
            "entity_type",
            "entity_id",
            "action",
            "details_json",
            "user_id",
            "created_at",
        ],
    ),
];

const REQUIRED_FOREIGN_KEYS: &[(&str, &str, &str, &str)] = &[
    ("orders", "customers", "customer_id", "SET NULL"),
    ("orders", "local_users", "created_by", "NO ACTION"),
    ("order_items", "orders", "order_id", "CASCADE"),
    ("order_items", "services", "service_id", "SET NULL"),
    ("payments", "orders", "order_id", "CASCADE"),
    ("payments", "local_users", "recorded_by", "NO ACTION"),
    ("payments", "local_users", "voided_by", "NO ACTION"),
    ("order_status_history", "orders", "order_id", "CASCADE"),
    (
        "order_status_history",
        "local_users",
        "changed_by",
        "NO ACTION",
    ),
    ("expenses", "local_users", "created_by", "NO ACTION"),
    (
        "inventory_transactions",
        "inventory_items",
        "inventory_item_id",
        "CASCADE",
    ),
    (
        "inventory_transactions",
        "local_users",
        "created_by",
        "NO ACTION",
    ),
    ("audit_log", "local_users", "user_id", "NO ACTION"),
];

type SqlRows = Vec<Value>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlStatement {
    pub sql: String,
    #[serde(default)]
    pub values: Vec<Value>,
    #[serde(default)]
    pub expected_rows: Option<u64>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub mode: Option<StatementMode>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StatementMode {
    Execute,
    Select,
}

impl Default for StatementMode {
    fn default() -> Self {
        Self::Execute
    }
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SqlExecutionResult {
    pub rows_affected: u64,
    pub last_insert_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<SqlRows>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalDatabaseInfo {
    pub path: String,
    pub restore_pending: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

struct DatabasePools {
    writer: SqlitePool,
    reader: SqlitePool,
}

pub struct DatabaseState {
    database_path: PathBuf,
    pools: Result<DatabasePools, String>,
    _lock_file: Option<File>,
    restore_pending: Arc<AtomicBool>,
    startup_warning: Option<String>,
}

pub struct RestoreRequest {
    database_path: PathBuf,
    source_path: String,
    writer_pool: Option<SqlitePool>,
    prior_error: Option<String>,
    lock_available: bool,
    restore_pending: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ApplyPhase {
    Prepared,
    OriginalMoved,
    ReplacementInstalled,
}

#[derive(Debug, Deserialize, Serialize)]
struct ApplyJournal {
    phase: ApplyPhase,
    old_database: Option<String>,
    recovery_snapshot: Option<String>,
}

impl DatabaseState {
    pub async fn open(database_path: PathBuf) -> Self {
        let database_path = absolute_path(database_path);
        let pending_path = pending_restore_path(&database_path);
        if let Some(directory) = database_path.parent() {
            if let Err(error) = fs::create_dir_all(directory) {
                return Self::failed(
                    database_path,
                    format!("Could not create the local database directory: {error}"),
                    None,
                    pending_path.exists(),
                );
            }
        }

        let lock_file = match acquire_instance_lock(&database_path) {
            Ok(file) => file,
            Err(error) => return Self::failed(database_path, error, None, pending_path.exists()),
        };

        let open_result = Self::open_pools_and_recover(&database_path).await;
        match open_result {
            Ok((pools, startup_warning)) => Self {
                database_path,
                pools: Ok(pools),
                _lock_file: Some(lock_file),
                restore_pending: Arc::new(AtomicBool::new(pending_path.exists())),
                startup_warning,
            },
            Err(error) => {
                Self::failed(database_path, error, Some(lock_file), pending_path.exists())
            }
        }
    }

    pub fn unavailable(error: impl Into<String>) -> Self {
        Self::failed(PathBuf::from("unavailable"), error.into(), None, false)
    }

    fn failed(
        database_path: PathBuf,
        error: String,
        lock_file: Option<File>,
        restore_pending: bool,
    ) -> Self {
        Self {
            database_path,
            pools: Err(error),
            _lock_file: lock_file,
            restore_pending: Arc::new(AtomicBool::new(restore_pending)),
            startup_warning: None,
        }
    }

    async fn open_pools_and_recover(
        database_path: &Path,
    ) -> Result<(DatabasePools, Option<String>), String> {
        let startup_warning = apply_pending_restore(database_path).await?;
        let pool_result = async {
            let existed = database_path.exists();
            let bootstrap = connect_writer_pool(database_path, false, WRITER_CONNECTIONS).await?;
            initialize_schema(&bootstrap, existed).await?;
            bootstrap.close().await;
            validate_database(database_path).await?;

            let writer = connect_writer_pool(database_path, true, WRITER_CONNECTIONS).await?;
            let connection = writer
                .acquire()
                .await
                .map_err(|error| format!("Could not open the writable database: {error}"))?;
            drop(connection);

            let reader = connect_reader_pool(database_path, READER_CONNECTIONS).await?;
            Ok::<_, String>(DatabasePools { writer, reader })
        }
        .await;

        match pool_result {
            Ok(pools) => Ok((pools, startup_warning)),
            Err(error) => Err(match startup_warning {
                Some(warning) => format!("{error} {warning}"),
                None => error,
            }),
        }
    }

    fn pools(&self) -> Result<&DatabasePools, String> {
        self.pools.as_ref().map_err(Clone::clone)
    }

    pub fn info(&self) -> LocalDatabaseInfo {
        let error = self.pools.as_ref().err().cloned();
        LocalDatabaseInfo {
            path: self.database_path.to_string_lossy().to_string(),
            restore_pending: self.restore_pending.load(Ordering::Acquire)
                || pending_restore_path(&self.database_path).exists(),
            error,
            warning: self.startup_warning.clone(),
        }
    }

    pub async fn local_select(&self, query: String, values: Vec<Value>) -> Result<SqlRows, String> {
        validate_sql(&query, SqlOperation::Select)?;
        let pool = &self.pools()?.reader;
        let rows = bind_values(sqlx::query(&query), &values)?
            .fetch_all(pool)
            .await
            .map_err(|error| format!("Database query failed: {error}"))?;
        rows_to_json(rows)
    }

    pub async fn local_read_batch(
        &self,
        statements: Vec<SqlStatement>,
    ) -> Result<Vec<SqlRows>, String> {
        let pool = &self.pools()?.reader;
        let mut connection = pool.acquire().await.map_err(|error| {
            format!("Could not acquire a read-only database connection: {error}")
        })?;
        let mut transaction = connection
            .begin_with("BEGIN")
            .await
            .map_err(|error| format!("Could not begin the read snapshot: {error}"))?;

        let result = async {
            let mut output = Vec::with_capacity(statements.len());
            for statement in statements {
                validate_sql(&statement.sql, SqlOperation::Select)?;
                let rows = bind_values(sqlx::query(&statement.sql), &statement.values)?
                    .fetch_all(&mut *transaction)
                    .await
                    .map_err(|error| format!("Database read failed: {error}"))?;
                output.push(rows_to_json(rows)?);
            }
            Ok::<_, String>(output)
        }
        .await;

        match result {
            Ok(output) => {
                transaction
                    .commit()
                    .await
                    .map_err(|error| format!("Could not finish the read snapshot: {error}"))?;
                Ok(output)
            }
            Err(error) => match transaction.rollback().await {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(format!(
                    "{error} The read snapshot rollback also failed: {rollback_error}"
                )),
            },
        }
    }

    pub async fn local_batch(
        &self,
        statements: Vec<SqlStatement>,
    ) -> Result<Vec<SqlExecutionResult>, String> {
        let pools = self.pools()?;
        let mut connection = pools.writer.acquire().await.map_err(|error| {
            format!("Could not acquire the writable database connection: {error}")
        })?;

        if self.restore_pending.load(Ordering::Acquire)
            || pending_restore_path(&self.database_path).exists()
        {
            return Err(
                "A restore is staged. Close and reopen the app before writing.".to_string(),
            );
        }

        if statements.is_empty() {
            return Ok(Vec::new());
        }

        let mut transaction = connection
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(|error| format!("Could not begin the write transaction: {error}"))?;

        let result = async {
            let mut output = Vec::with_capacity(statements.len());
            for statement in statements {
                let mode = statement.mode.unwrap_or_default();
                let operation = if mode == StatementMode::Select {
                    SqlOperation::Select
                } else {
                    SqlOperation::Write
                };
                validate_sql(&statement.sql, operation)?;
                let query = bind_values(sqlx::query(&statement.sql), &statement.values)?;

                let execution = if mode == StatementMode::Select {
                    let rows = query
                        .fetch_all(&mut *transaction)
                        .await
                        .map_err(|error| format!("Database batch read failed: {error}"))?;
                    let rows = rows_to_json(rows)?;
                    SqlExecutionResult {
                        rows_affected: rows.len() as u64,
                        last_insert_id: None,
                        rows: Some(rows),
                    }
                } else {
                    let result = query
                        .execute(&mut *transaction)
                        .await
                        .map_err(|error| format!("Database batch write failed: {error}"))?;
                    SqlExecutionResult {
                        rows_affected: result.rows_affected(),
                        last_insert_id: Some(result.last_insert_rowid()),
                        rows: None,
                    }
                };

                if let Some(expected_rows) = statement.expected_rows {
                    if execution.rows_affected != expected_rows {
                        return Err(statement.error.unwrap_or_else(|| {
                            format!(
                                "Expected {expected_rows} affected row(s), got {}.",
                                execution.rows_affected
                            )
                        }));
                    }
                }
                output.push(execution);
            }
            Ok::<_, String>(output)
        }
        .await;

        match result {
            Ok(output) => {
                transaction
                    .commit()
                    .await
                    .map_err(|error| format!("Could not commit the write transaction: {error}"))?;
                Ok(output)
            }
            Err(error) => match transaction.rollback().await {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(format!(
                    "{error} The write transaction rollback also failed: {rollback_error}"
                )),
            },
        }
    }

    pub async fn backup_database(&self) -> Result<String, String> {
        let pools = self.pools()?;
        let mut connection = pools.writer.acquire().await.map_err(|error| {
            format!("Could not acquire the writable database connection: {error}")
        })?;
        let destination = new_backup_path(&self.database_path, "laundry")?;

        let result = async {
            vacuum_into(&mut connection, &destination).await?;
            sync_file(&destination)?;
            sync_parent_directory(&destination)?;
            validate_database(&destination).await?;
            prune_backups(&self.database_path, BACKUP_LIMIT)?;
            Ok::<_, String>(destination.clone())
        }
        .await;

        match result {
            Ok(path) => Ok(path.to_string_lossy().to_string()),
            Err(error) => {
                let _ = remove_database_files(&destination);
                Err(error)
            }
        }
    }

    pub fn restore_database(&self, source_path: String) -> RestoreRequest {
        RestoreRequest {
            database_path: self.database_path.clone(),
            source_path,
            writer_pool: self.pools.as_ref().ok().map(|pools| pools.writer.clone()),
            prior_error: self.pools.as_ref().err().cloned(),
            lock_available: self._lock_file.is_some(),
            restore_pending: Arc::clone(&self.restore_pending),
        }
    }
}

impl RestoreRequest {
    pub async fn apply(self) -> Result<String, String> {
        let Self {
            database_path,
            source_path,
            writer_pool,
            prior_error,
            lock_available,
            restore_pending,
        } = self;
        async move {
            if !lock_available {
                return Err(prior_error
                    .unwrap_or_else(|| "The database instance lock is unavailable.".to_string()));
            }

            let source = PathBuf::from(source_path);
            ensure_not_live_database(&source, &database_path)?;
            let ready_snapshot = match prepare_restore_snapshot(&source, &database_path).await {
                Ok(path) => path,
                Err(error) => return Err(error),
            };

            let mut writer_connection = if let Some(pool) = writer_pool.as_ref() {
                let mut connection = match pool.acquire().await {
                    Ok(connection) => connection,
                    Err(error) => {
                        let _ = remove_database_files(&ready_snapshot);
                        return Err(format!(
                            "Could not acquire the writable database connection: {error}"
                        ));
                    }
                };
                if restore_pending.load(Ordering::Acquire)
                    || pending_restore_path(&database_path).exists()
                {
                    let _ = remove_database_files(&ready_snapshot);
                    return Err("A database restore is already staged.".to_string());
                }
                if let Err(error) =
                    create_backup_on_connection(&mut connection, &database_path).await
                {
                    let _ = remove_database_files(&ready_snapshot);
                    return Err(error);
                }
                Some(connection)
            } else {
                None
            };

            let stage_result = async {
                if writer_pool.is_none() && pending_restore_path(&database_path).exists() {
                    quarantine_database_file(&pending_restore_path(&database_path)).map_err(
                        |error| format!("Could not preserve the previous staged restore: {error}"),
                    )?;
                }

                publish_pending_snapshot(&ready_snapshot, &database_path)?;
                restore_pending.store(true, Ordering::Release);
                Ok::<_, String>(())
            }
            .await;
            drop(writer_connection.take());

            if let Err(error) = stage_result {
                let _ = remove_database_files(&ready_snapshot);
                return Err(error);
            }

            Ok("Restore staged. Close and reopen the app to apply it.".to_string())
        }
        .await
    }
}

async fn connect_writer_pool(
    database_path: &Path,
    wal: bool,
    max_connections: u32,
) -> Result<SqlitePool, String> {
    let mut options = SqliteConnectOptions::new()
        .filename(database_path)
        .create_if_missing(true)
        .foreign_keys(true)
        .busy_timeout(BUSY_TIMEOUT);
    if wal {
        options = options.journal_mode(SqliteJournalMode::Wal);
    }
    SqlitePoolOptions::new()
        .max_connections(max_connections)
        .connect_with(options)
        .await
        .map_err(|error| format!("Could not open the writable local database: {error}"))
}

async fn connect_reader_pool(
    database_path: &Path,
    max_connections: u32,
) -> Result<SqlitePool, String> {
    SqlitePoolOptions::new()
        .max_connections(max_connections)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(database_path)
                .read_only(true)
                .create_if_missing(false)
                .foreign_keys(true)
                .busy_timeout(BUSY_TIMEOUT),
        )
        .await
        .map_err(|error| format!("Could not open the read-only local database: {error}"))
}

async fn initialize_schema(pool: &SqlitePool, existed: bool) -> Result<(), String> {
    let mut connection = pool
        .acquire()
        .await
        .map_err(|error| format!("Could not inspect the local database: {error}"))?;
    let version = sqlx::query_scalar::<_, i64>("PRAGMA user_version")
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| format!("Could not read the local schema version: {error}"))?;

    if !(0..=SCHEMA_VERSION).contains(&version) {
        return Err(format!(
            "The local database uses unsupported schema version {version}. This app supports versions 0 and {SCHEMA_VERSION}."
        ));
    }

    if version == SCHEMA_VERSION {
        validate_schema(&mut connection).await?;
        validate_integrity_and_foreign_keys(&mut connection).await?;
    } else {
        let app_tables = count_app_tables(&mut connection).await?;
        if existed && app_tables > 0 {
            validate_schema(&mut connection).await?;
            validate_integrity_and_foreign_keys(&mut connection).await?;
        } else {
            validate_integrity_and_foreign_keys(&mut connection).await?;
        }
        let mut transaction = connection
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(|error| format!("Could not begin the schema migration: {error}"))?;
        let migration_result = async {
            sqlx::raw_sql(MIGRATION_SQL)
                .execute(&mut *transaction)
                .await
                .map_err(|error| format!("The local database migration failed: {error}"))?;
            sqlx::query("PRAGMA user_version = 1")
                .execute(&mut *transaction)
                .await
                .map_err(|error| format!("Could not record the local schema version: {error}"))?;
            Ok::<_, String>(())
        }
        .await;
        if let Err(error) = migration_result {
            return match transaction.rollback().await {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(format!(
                    "{error} The schema migration rollback also failed: {rollback_error}"
                )),
            };
        }
        transaction
            .commit()
            .await
            .map_err(|error| format!("Could not commit the local schema migration: {error}"))?;
        validate_schema(&mut connection).await?;
        validate_integrity_and_foreign_keys(&mut connection).await?;
    }

    sqlx::query(
        "INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES ('device_id', lower(hex(randomblob(16))), CURRENT_TIMESTAMP)",
    )
    .execute(&mut *connection)
    .await
    .map_err(|error| format!("Could not initialize the device identifier: {error}"))?;
    sqlx::query(
        "UPDATE app_settings SET value = lower(hex(randomblob(16))), updated_at = CURRENT_TIMESTAMP WHERE key = 'device_id' AND trim(value) = ''",
    )
    .execute(&mut *connection)
    .await
    .map_err(|error| format!("Could not repair the device identifier: {error}"))?;
    Ok(())
}

async fn count_app_tables(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
) -> Result<i64, String> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_sqlx_migrations'",
    )
    .fetch_one(&mut **connection)
    .await
    .map_err(|error| format!("Could not inspect the local schema: {error}"))
}

async fn validate_schema(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
) -> Result<(), String> {
    for (table, required_columns) in REQUIRED_TABLES {
        let sql = format!("PRAGMA table_info(\"{table}\")");
        let rows = sqlx::query(&sql)
            .fetch_all(&mut **connection)
            .await
            .map_err(|error| format!("Could not inspect table {table}: {error}"))?;
        let columns = rows
            .iter()
            .map(|row| row.try_get::<String, _>("name"))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Could not read table {table}: {error}"))?;
        if columns.is_empty() {
            return Err(format!("The local database is missing table {table}."));
        }
        for required in *required_columns {
            if !columns
                .iter()
                .any(|column| column.eq_ignore_ascii_case(required))
            {
                return Err(format!(
                    "The local database table {table} is missing required column {required}."
                ));
            }
        }
    }

    for (table, parent, column, on_delete) in REQUIRED_FOREIGN_KEYS {
        let sql = format!("PRAGMA foreign_key_list(\"{table}\")");
        let rows = sqlx::query(&sql)
            .fetch_all(&mut **connection)
            .await
            .map_err(|error| format!("Could not inspect foreign keys for {table}: {error}"))?;
        let mut found = false;
        for row in rows {
            let row_table: String = row
                .try_get("table")
                .map_err(|error| format!("Could not read foreign keys for {table}: {error}"))?;
            let from: String = row
                .try_get("from")
                .map_err(|error| format!("Could not read foreign keys for {table}: {error}"))?;
            let action: String = row
                .try_get("on_delete")
                .map_err(|error| format!("Could not read foreign keys for {table}: {error}"))?;
            if row_table.eq_ignore_ascii_case(parent)
                && from.eq_ignore_ascii_case(column)
                && action.eq_ignore_ascii_case(on_delete)
            {
                found = true;
                break;
            }
        }
        if !found {
            return Err(format!(
                "The local database is missing a compatible foreign key on {table}.{column}."
            ));
        }
    }

    validate_schema_contract(connection).await
}

async fn validate_schema_contract(
    actual_connection: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
) -> Result<(), String> {
    let expected_pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(":memory:")
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .map_err(|error| format!("Could not prepare the schema contract: {error}"))?;
    let expected_result = async {
        sqlx::raw_sql(MIGRATION_SQL)
            .execute(&expected_pool)
            .await
            .map_err(|error| format!("Could not prepare the schema contract: {error}"))?;
        let mut connection = expected_pool
            .acquire()
            .await
            .map_err(|error| format!("Could not inspect the schema contract: {error}"))?;
        schema_object_definitions(&mut connection).await
    }
    .await;
    expected_pool.close().await;
    let expected = expected_result?;
    let actual = schema_object_definitions(actual_connection).await?;

    for (object, expected_sql) in &expected {
        match actual.get(object) {
            Some(actual_sql) if actual_sql == expected_sql => {}
            Some(_) => {
                return Err(format!(
                    "The local database schema object {object} has an incompatible definition."
                ));
            }
            None => {
                return Err(format!(
                    "The local database is missing schema object {object}."
                ));
            }
        }
    }
    if let Some(object) = actual.keys().find(|object| !expected.contains_key(*object)) {
        return Err(format!(
            "The local database contains unsupported schema object {object}."
        ));
    }
    Ok(())
}

async fn schema_object_definitions(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
) -> Result<BTreeMap<String, String>, String> {
    let rows = sqlx::query(
        "SELECT type, name, sql FROM sqlite_master WHERE substr(name, 1, 7) != 'sqlite_' AND name != '_sqlx_migrations' AND substr(name, 1, length('_sqlx_migrations_')) != '_sqlx_migrations_' ORDER BY type, name",
    )
    .fetch_all(&mut **connection)
    .await
    .map_err(|error| format!("Could not inspect database schema definitions: {error}"))?;
    let mut definitions = BTreeMap::new();
    for row in rows {
        let kind: String = row
            .try_get("type")
            .map_err(|error| format!("Could not read a database schema object: {error}"))?;
        let name: String = row
            .try_get("name")
            .map_err(|error| format!("Could not read a database schema object: {error}"))?;
        let sql: Option<String> = row
            .try_get("sql")
            .map_err(|error| format!("Could not read a database schema definition: {error}"))?;
        let key = format!(
            "{}:{}",
            kind.to_ascii_lowercase(),
            name.to_ascii_lowercase()
        );
        let normalized = sql
            .as_deref()
            .map(normalize_schema_sql)
            .unwrap_or_else(|| "<sqlite-managed-index>".to_string());
        definitions.insert(key, normalized);
    }
    Ok(definitions)
}

fn normalize_schema_sql(sql: &str) -> String {
    let chars = sql.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(sql.len());
    let mut index = 0;
    while index < chars.len() {
        let current = chars[index];
        if current.is_whitespace() {
            index += 1;
            continue;
        }
        if current == '-' && chars.get(index + 1) == Some(&'-') {
            index += 2;
            while index < chars.len() && chars[index] != '\n' {
                index += 1;
            }
            continue;
        }
        if current == '/' && chars.get(index + 1) == Some(&'*') {
            index += 2;
            while index + 1 < chars.len() && !(chars[index] == '*' && chars[index + 1] == '/') {
                index += 1;
            }
            index = (index + 2).min(chars.len());
            continue;
        }
        if current == '\'' {
            output.push_str("S{");
            output.push('\'');
            index += 1;
            while index < chars.len() {
                let character = chars[index];
                output.push(character);
                index += 1;
                if character == '\'' {
                    if chars.get(index) == Some(&'\'') {
                        output.push('\'');
                        index += 1;
                    } else {
                        break;
                    }
                }
            }
            output.push_str("};");
            continue;
        }
        if matches!(current, '"' | '`' | '[') {
            let closing = if current == '[' { ']' } else { current };
            let mut identifier = String::new();
            index += 1;
            while index < chars.len() {
                let character = chars[index];
                index += 1;
                if character == closing {
                    if chars.get(index) == Some(&closing) {
                        identifier.push(closing);
                        index += 1;
                    } else {
                        break;
                    }
                } else {
                    identifier.push(character);
                }
            }
            output.push_str("Q{");
            output.push_str(&identifier.to_ascii_lowercase());
            output.push_str("};");
            continue;
        }
        if current.is_alphanumeric() || current == '_' || current == '$' {
            output.push_str("I{");
            while index < chars.len()
                && (chars[index].is_alphanumeric() || matches!(chars[index], '_' | '$'))
            {
                output.extend(chars[index].to_lowercase());
                index += 1;
            }
            output.push_str("};");
            continue;
        }
        output.push(current);
        index += 1;
    }
    output
}

async fn validate_database(database_path: &Path) -> Result<(), String> {
    let pool = connect_reader_pool(database_path, 1).await?;
    let result = validate_database_pool(&pool).await;
    pool.close().await;
    result
}

async fn validate_database_pool(pool: &SqlitePool) -> Result<(), String> {
    let mut connection = pool
        .acquire()
        .await
        .map_err(|error| format!("Could not inspect the database file: {error}"))?;
    let version = sqlx::query_scalar::<_, i64>("PRAGMA user_version")
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| format!("Could not read the database schema version: {error}"))?;
    if !(0..=SCHEMA_VERSION).contains(&version) {
        return Err(format!(
            "The database uses unsupported schema version {version}. This app supports versions 0 and {SCHEMA_VERSION}."
        ));
    }
    validate_schema(&mut connection).await?;

    validate_integrity_and_foreign_keys(&mut connection).await
}

async fn validate_integrity_and_foreign_keys(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
) -> Result<(), String> {
    let integrity_rows = sqlx::query("PRAGMA integrity_check")
        .fetch_all(&mut **connection)
        .await
        .map_err(|error| format!("Could not check database integrity: {error}"))?;
    if integrity_rows.len() != 1
        || integrity_rows[0]
            .try_get::<String, _>(0)
            .map_err(|error| format!("Could not read database integrity status: {error}"))?
            != "ok"
    {
        return Err("The database failed SQLite integrity_check.".to_string());
    }

    let foreign_key_rows = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut **connection)
        .await
        .map_err(|error| format!("Could not check database foreign keys: {error}"))?;
    if !foreign_key_rows.is_empty() {
        return Err(format!(
            "The database contains {} foreign-key violation(s).",
            foreign_key_rows.len()
        ));
    }
    Ok(())
}

async fn apply_pending_restore(database_path: &Path) -> Result<Option<String>, String> {
    let mut warning = recover_interrupted_restore(database_path).await?;
    let pending = pending_restore_path(database_path);
    if !pending.exists() {
        return Ok(warning);
    }

    if let Err(error) = validate_database(&pending).await {
        if !database_path.exists() {
            return Err(format!(
                "The staged restore failed validation and there is no original database to open. The staged file was preserved at {}. Details: {error}",
                pending.display()
            ));
        }
        let rejected = quarantine_database_file(&pending)?;
        warning = Some(format!(
            "The staged database restore failed validation and was preserved at {}. The active database was not replaced. Select a valid backup to try again. Details: {error}",
            rejected.display()
        ));
        return Ok(warning);
    }

    let apply_result = async {
        let old_path = if database_path.exists() {
            Some(unique_sibling_path(
                database_path,
                "restore-original",
                "db",
            )?)
        } else {
            None
        };
        let recovery_snapshot = if database_path.exists() {
            Some(create_recovery_snapshot(database_path).await?)
        } else {
            None
        };

        if database_path.exists() {
            checkpoint_database(database_path).await?;
            quarantine_sidecars(database_path, recovery_snapshot.as_deref())?;
        }

        write_apply_journal(
            database_path,
            &ApplyJournal {
                phase: ApplyPhase::Prepared,
                old_database: old_path
                    .as_ref()
                    .map(|path| file_name_string(path))
                    .transpose()?,
                recovery_snapshot: recovery_snapshot
                    .as_ref()
                    .map(|path| file_name_string(path))
                    .transpose()?,
            },
        )?;
        resume_interrupted_restore(database_path).await
    }
    .await;

    match apply_result {
        Ok(()) => Ok(warning),
        Err(error) => {
            let active_database_is_safe = !apply_journal_path(database_path).exists()
                && database_path.exists()
                && validate_database(database_path).await.is_ok();
            if !active_database_is_safe {
                return Err(error);
            }
            let rejected = if pending.exists() {
                Some(quarantine_database_file(&pending)?)
            } else {
                None
            };
            let rejected_note = rejected
                .as_deref()
                .map(|path| {
                    format!(
                        " The rejected staged file was preserved at {}.",
                        path.display()
                    )
                })
                .unwrap_or_default();
            warning = Some(format!(
                "The staged database restore could not be applied. The original database remains active.{rejected_note} Select a valid backup to try again. Details: {error}"
            ));
            Ok(warning)
        }
    }
}

async fn recover_interrupted_restore(database_path: &Path) -> Result<Option<String>, String> {
    let journal_path = apply_journal_path(database_path);
    if !journal_path.exists() {
        return Ok(None);
    }
    match resume_interrupted_restore(database_path).await {
        Ok(()) => Ok(None),
        Err(error) => {
            let rollback_completed = !journal_path.exists()
                && database_path.exists()
                && validate_database(database_path).await.is_ok();
            if !rollback_completed {
                return Err(error);
            }
            let pending = pending_restore_path(database_path);
            let rejected = if pending.exists() {
                Some(quarantine_database_file(&pending)?)
            } else {
                None
            };
            let rejected_note = rejected
                .as_deref()
                .map(|path| {
                    format!(
                        " The rejected staged file was preserved at {}.",
                        path.display()
                    )
                })
                .unwrap_or_default();
            Ok(Some(format!(
                "An interrupted database restore could not be applied. The original database was restored and remains active.{rejected_note} Details: {error}"
            )))
        }
    }
}

async fn resume_interrupted_restore(database_path: &Path) -> Result<(), String> {
    let mut journal = read_apply_journal(database_path)?;
    let pending = pending_restore_path(database_path);
    let old_path = journal
        .old_database
        .as_deref()
        .map(|name| safe_journal_sibling(database_path, name, "restore-original-"))
        .transpose()?;
    let recovery_snapshot = journal
        .recovery_snapshot
        .as_deref()
        .map(|name| safe_journal_backup_path(database_path, name, "laundry-recovery-"))
        .transpose()?;

    match journal.phase {
        ApplyPhase::Prepared => {
            if database_path.exists() {
                let old = old_path.as_ref().ok_or_else(|| {
                    "The restore journal is missing its original database path.".to_string()
                })?;
                if old.exists() {
                    return Err(
                        "The restore journal found an unexpected original database file."
                            .to_string(),
                    );
                }
                fs::rename(database_path, old)
                    .map_err(|error| format!("Could not preserve the current database: {error}"))?;
                sync_parent_directory(database_path)?;
            } else if old_path.as_ref().is_some_and(|path| !path.exists()) {
                return Err("The restore journal cannot find the original database.".to_string());
            }
            journal.phase = ApplyPhase::OriginalMoved;
            write_apply_journal(database_path, &journal)?;
        }
        ApplyPhase::OriginalMoved | ApplyPhase::ReplacementInstalled => {}
    }

    if journal.phase == ApplyPhase::OriginalMoved {
        if database_path.exists() && !pending.exists() {
            if validate_database(database_path).await.is_ok() {
                journal.phase = ApplyPhase::ReplacementInstalled;
                write_apply_journal(database_path, &journal)?;
            } else {
                return restore_original_after_failed_apply(
                    database_path,
                    old_path.as_deref(),
                    "The replacement database is invalid and was not installed.".to_string(),
                );
            }
        } else {
            if database_path.exists() {
                return Err("The restore journal found an unexpected database file.".to_string());
            }
            if !pending.exists() {
                return restore_original_after_failed_apply(
                    database_path,
                    old_path.as_deref(),
                    "The staged restore file is missing; the original database was preserved."
                        .to_string(),
                );
            }
            if let Err(error) = validate_database(&pending).await {
                return restore_original_after_failed_apply(
                    database_path,
                    old_path.as_deref(),
                    format!("The staged database failed validation: {error}"),
                );
            }
            fs::rename(&pending, database_path)
                .map_err(|error| format!("Could not install the staged database: {error}"))?;
            sync_parent_directory(database_path)?;
            journal.phase = ApplyPhase::ReplacementInstalled;
            write_apply_journal(database_path, &journal)?;
        }
    }

    if let Err(error) = validate_database(database_path).await {
        return restore_original_after_failed_apply(
            database_path,
            old_path.as_deref(),
            format!("The replacement database failed validation: {error}"),
        );
    }

    if let Some(old) = old_path.as_deref() {
        if old.exists() {
            if let Some(recovery_snapshot) = recovery_snapshot.as_deref() {
                if let Err(error) = validate_database(recovery_snapshot).await {
                    return restore_original_after_failed_apply(
                        database_path,
                        old_path.as_deref(),
                        format!(
                            "The recovery snapshot is invalid; the original database was restored: {error}"
                        ),
                    );
                }
            } else {
                return restore_original_after_failed_apply(
                    database_path,
                    old_path.as_deref(),
                    "The restore journal has no recovery snapshot; the original database was restored."
                        .to_string(),
                );
            }
            fs::remove_file(old).map_err(|error| {
                format!("Could not remove the temporary original database: {error}")
            })?;
        }
    }
    remove_apply_journal(database_path)?;
    Ok(())
}

fn restore_original_after_failed_apply(
    database_path: &Path,
    old_path: Option<&Path>,
    failure: String,
) -> Result<(), String> {
    let Some(old) = old_path.filter(|path| path.exists()) else {
        return Err(failure);
    };

    if database_path.exists() {
        if let Err(error) = quarantine_database_file(database_path) {
            return Err(format!(
                "{failure} Could not preserve the rejected file: {error}"
            ));
        }
    }
    fs::rename(old, database_path)
        .map_err(|error| format!("{failure} Could not restore the original database: {error}"))?;
    sync_parent_directory(database_path)?;
    remove_apply_journal(database_path)?;
    Err(failure)
}

async fn checkpoint_database(database_path: &Path) -> Result<(), String> {
    let pool = connect_writer_pool(database_path, false, 1).await?;
    let result = async {
        let row = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .fetch_one(&pool)
            .await
            .map_err(|error| format!("Could not checkpoint the database WAL: {error}"))?;
        let busy: i64 = row
            .try_get(0)
            .map_err(|error| format!("Could not read the database checkpoint status: {error}"))?;
        if busy != 0 {
            return Err("The database is busy and its WAL could not be checkpointed.".to_string());
        }
        Ok::<_, String>(())
    }
    .await;
    pool.close().await;
    result?;

    let wal = sidecar_path(database_path, "-wal");
    if wal.exists() && fs::metadata(&wal).map_err(|error| error.to_string())?.len() > 0 {
        return Err("The database WAL still contains data after checkpointing.".to_string());
    }
    Ok(())
}

fn quarantine_sidecars(
    database_path: &Path,
    recovery_snapshot: Option<&Path>,
) -> Result<(), String> {
    let base = recovery_snapshot.unwrap_or(database_path);
    for suffix in ["-wal", "-shm"] {
        let sidecar = sidecar_path(database_path, suffix);
        if !sidecar.exists() {
            continue;
        }
        let preserved = unique_sibling_path(base, "pre-restore-sidecar", "tmp")?;
        fs::rename(&sidecar, &preserved)
            .map_err(|error| format!("Could not preserve SQLite sidecar {suffix}: {error}"))?;
        sync_parent_directory(database_path)?;
        sync_parent_directory(&preserved)?;
    }
    Ok(())
}

async fn create_recovery_snapshot(database_path: &Path) -> Result<PathBuf, String> {
    let directory = backup_directory(database_path)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the recovery backup directory: {error}"))?;
    let destination = unique_path_in(&directory, "laundry-recovery", "db")?;
    let pool = connect_writer_pool(database_path, false, 1).await?;
    let result = async {
        let mut connection = pool
            .acquire()
            .await
            .map_err(|error| format!("Could not read the current database: {error}"))?;
        vacuum_into(&mut connection, &destination).await?;
        drop(connection);
        sync_file(&destination)?;
        sync_parent_directory(&destination)?;
        validate_database(&destination).await?;
        Ok::<_, String>(())
    }
    .await;
    pool.close().await;
    if let Err(error) = result {
        let _ = remove_database_files(&destination);
        return Err(error);
    }
    Ok(destination)
}

async fn prepare_restore_snapshot(source: &Path, live_database: &Path) -> Result<PathBuf, String> {
    if !source.exists() {
        return Err("The selected database backup does not exist.".to_string());
    }
    let directory = live_database
        .parent()
        .ok_or_else(|| "The local database directory is unavailable.".to_string())?;
    let work_path = unique_path_in(directory, "laundry-restore-work", "db")?;
    let ready_path = unique_path_in(directory, "laundry-restore-ready", "db")?;

    let preparation = async {
        let source_pool = connect_reader_pool(source, 1).await?;
        let source_validation = validate_database_pool(&source_pool).await;
        if let Err(error) = source_validation {
            source_pool.close().await;
            return Err(error);
        }
        let mut source_connection = source_pool
            .acquire()
            .await
            .map_err(|error| format!("Could not read the selected backup: {error}"))?;
        vacuum_into(&mut source_connection, &work_path).await?;
        drop(source_connection);
        source_pool.close().await;
        sync_file(&work_path)?;
        validate_database(&work_path).await?;

        let work_pool = connect_writer_pool(&work_path, false, 1).await?;
        initialize_schema(&work_pool, true).await?;
        let result = async {
            let mut work_connection = work_pool
                .acquire()
                .await
                .map_err(|error| format!("Could not prepare the selected backup: {error}"))?;
            vacuum_into(&mut work_connection, &ready_path).await?;
            drop(work_connection);
            Ok::<_, String>(())
        }
        .await;
        work_pool.close().await;
        result?;
        sync_file(&ready_path)?;
        validate_database(&ready_path).await?;
        Ok::<_, String>(())
    }
    .await;

    let _ = remove_database_files(&work_path);
    if let Err(error) = preparation {
        let _ = remove_database_files(&ready_path);
        return Err(error);
    }
    Ok(ready_path)
}

async fn create_backup_on_connection(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
    database_path: &Path,
) -> Result<PathBuf, String> {
    let directory = backup_directory(database_path)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the backup directory: {error}"))?;
    let backup = unique_path_in(&directory, "laundry", "db")?;
    let backup_result = async {
        vacuum_into(connection, &backup).await?;
        sync_file(&backup)?;
        sync_parent_directory(&backup)?;
        validate_database(&backup).await?;
        prune_backups(database_path, BACKUP_LIMIT)?;
        Ok::<_, String>(())
    }
    .await;
    if let Err(error) = backup_result {
        let _ = remove_database_files(&backup);
        return Err(error);
    }
    Ok(backup)
}

async fn vacuum_into(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
    destination: &Path,
) -> Result<(), String> {
    if destination.exists() {
        return Err("The database snapshot target already exists.".to_string());
    }
    sqlx::query("VACUUM INTO ?")
        .bind(destination.to_string_lossy().to_string())
        .execute(&mut **connection)
        .await
        .map_err(|error| format!("Could not create a consistent SQLite snapshot: {error}"))?;
    Ok(())
}

fn publish_pending_snapshot(ready_snapshot: &Path, database_path: &Path) -> Result<(), String> {
    let pending = pending_restore_path(database_path);
    if pending.exists() {
        return Err("A database restore is already staged.".to_string());
    }
    fs::rename(ready_snapshot, &pending)
        .map_err(|error| format!("Could not stage the selected database backup: {error}"))?;
    sync_parent_directory(database_path)?;
    Ok(())
}

fn ensure_not_live_database(source: &Path, database_path: &Path) -> Result<(), String> {
    let pending = pending_restore_path(database_path);
    let source_canonical = source.canonicalize().ok();
    let database_canonical = database_path.canonicalize().ok();
    let pending_canonical = pending.canonicalize().ok();
    if source_canonical.is_some() && source_canonical == database_canonical
        || source_canonical.is_some() && source_canonical == pending_canonical
    {
        return Err("Choose a backup file rather than the active database.".to_string());
    }
    Ok(())
}

fn validate_sql(sql: &str, operation: SqlOperation) -> Result<(), String> {
    let bytes = sql.as_bytes();
    let mut index = 0;
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    let keyword_start = index;
    while index < bytes.len() && bytes[index].is_ascii_alphabetic() {
        index += 1;
    }
    let keyword = sql[keyword_start..index].to_ascii_uppercase();
    let allowed = match operation {
        SqlOperation::Select => keyword == "SELECT",
        SqlOperation::Write => matches!(keyword.as_str(), "INSERT" | "UPDATE" | "DELETE"),
    };
    if !allowed {
        return Err(match operation {
            SqlOperation::Select => "Only SELECT statements are allowed for reads.".to_string(),
            SqlOperation::Write => {
                "Only INSERT, UPDATE, DELETE, or SELECT statements are allowed in a batch."
                    .to_string()
            }
        });
    }

    let mut quote = None;
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if let Some(end_quote) = quote {
            if byte == end_quote {
                if index + 1 < bytes.len() && bytes[index + 1] == end_quote {
                    index += 2;
                    continue;
                }
                quote = None;
            }
            index += 1;
            continue;
        }

        match byte {
            b'\'' | b'"' | b'`' => quote = Some(byte),
            b'[' => quote = Some(b']'),
            b';' => return Err("SQL statement separators are not allowed.".to_string()),
            b'-' if index + 1 < bytes.len() && bytes[index + 1] == b'-' => {
                return Err("SQL comments are not allowed.".to_string())
            }
            b'/' if index + 1 < bytes.len() && bytes[index + 1] == b'*' => {
                return Err("SQL comments are not allowed.".to_string())
            }
            _ => {}
        }
        index += 1;
    }

    if quote.is_some() {
        return Err("The SQL statement contains an unclosed quoted value.".to_string());
    }
    if sql[keyword_start..].trim().is_empty() {
        return Err("A SQL statement is required.".to_string());
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum SqlOperation {
    Select,
    Write,
}

fn bind_values<'q>(
    mut query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    values: &[Value],
) -> Result<sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>, String> {
    for (index, value) in values.iter().enumerate() {
        query = match value {
            Value::Null => query.bind(Option::<String>::None),
            Value::Bool(value) => query.bind(i64::from(*value)),
            Value::Number(number) => {
                if let Some(value) = number.as_i64() {
                    query.bind(value)
                } else if let Some(value) = number.as_u64() {
                    let value = i64::try_from(value).map_err(|_| {
                        format!(
                            "SQL value {} is larger than SQLite's integer range.",
                            index + 1
                        )
                    })?;
                    query.bind(value)
                } else if let Some(value) = number.as_f64().filter(|value| value.is_finite()) {
                    query.bind(value)
                } else {
                    return Err(format!("SQL value {} is not a finite number.", index + 1));
                }
            }
            Value::String(value) => query.bind(value.clone()),
            Value::Array(_) | Value::Object(_) => {
                return Err(format!("SQL value {} must be a scalar or null.", index + 1))
            }
        };
    }
    Ok(query)
}

fn rows_to_json(rows: Vec<SqliteRow>) -> Result<SqlRows, String> {
    rows.iter().map(row_to_json).collect()
}

fn row_to_json(row: &SqliteRow) -> Result<Value, String> {
    let mut object = Map::with_capacity(row.columns().len());
    for (index, column) in row.columns().iter().enumerate() {
        let raw = row
            .try_get_raw(index)
            .map_err(|error| format!("Could not read SQLite column {}: {error}", column.name()))?;
        let value = if raw.is_null() {
            Value::Null
        } else {
            match raw.type_info().name() {
                "INTEGER" | "INT4" => Value::Number(Number::from(
                    row.try_get::<i64, _>(index)
                        .map_err(|error| format!("Could not decode SQLite integer: {error}"))?,
                )),
                "BOOLEAN" => Value::Bool(
                    row.try_get::<bool, _>(index)
                        .map_err(|error| format!("Could not decode SQLite boolean: {error}"))?,
                ),
                "REAL" => {
                    let value = row
                        .try_get::<f64, _>(index)
                        .map_err(|error| format!("Could not decode SQLite real: {error}"))?;
                    Value::Number(Number::from_f64(value).ok_or_else(|| {
                        "SQLite returned a non-finite real value that JSON cannot represent."
                            .to_string()
                    })?)
                }
                "BLOB" => {
                    let bytes = row
                        .try_get::<Vec<u8>, _>(index)
                        .map_err(|error| format!("Could not decode SQLite blob: {error}"))?;
                    Value::Array(bytes.into_iter().map(Value::from).collect())
                }
                "TEXT" | "DATE" | "TIME" | "DATETIME" => Value::String(
                    row.try_get::<String, _>(index)
                        .map_err(|error| format!("Could not decode SQLite text: {error}"))?,
                ),
                other => return Err(format!("SQLite returned unsupported column type {other}.")),
            }
        };
        object.insert(column.name().to_string(), value);
    }
    Ok(Value::Object(object))
}

fn acquire_instance_lock(database_path: &Path) -> Result<File, String> {
    let directory = database_path
        .parent()
        .ok_or_else(|| "The local database directory is unavailable.".to_string())?;
    let lock_path = directory.join("laundry.lock");
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|error| format!("Could not open the database instance lock: {error}"))?;
    file.try_lock().map_err(|error| match error {
        std::fs::TryLockError::WouldBlock => {
            "Another Smart Laundry POS instance is using this database.".to_string()
        }
        std::fs::TryLockError::Error(error) => {
            format!("Could not acquire the database instance lock: {error}")
        }
    })?;
    Ok(file)
}

fn pending_restore_path(database_path: &Path) -> PathBuf {
    sibling_named(database_path, "laundry.restore.pending.db")
}

fn apply_journal_path(database_path: &Path) -> PathBuf {
    sibling_named(database_path, "laundry.restore.apply.json")
}

fn backup_directory(database_path: &Path) -> Result<PathBuf, String> {
    database_path
        .parent()
        .ok_or_else(|| "The local database directory is unavailable.".to_string())
        .map(|directory| directory.join("backups"))
}

fn new_backup_path(database_path: &Path, prefix: &str) -> Result<PathBuf, String> {
    let directory = backup_directory(database_path)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the backup directory: {error}"))?;
    unique_path_in(&directory, prefix, "db")
}

fn unique_path_in(directory: &Path, prefix: &str, extension: &str) -> Result<PathBuf, String> {
    for _ in 0..100 {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("System clock is unavailable: {error}"))?
            .as_nanos();
        let sequence = TEMP_PATH_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = directory.join(format!(
            "{prefix}-{timestamp}-{}-{sequence}.{extension}",
            std::process::id(),
        ));
        if !path.exists() {
            return Ok(path);
        }
    }
    Err("Could not choose a unique temporary database path.".to_string())
}

fn unique_sibling_path(
    database_path: &Path,
    prefix: &str,
    extension: &str,
) -> Result<PathBuf, String> {
    let directory = database_path
        .parent()
        .ok_or_else(|| "The local database directory is unavailable.".to_string())?;
    unique_path_in(directory, prefix, extension)
}

fn sibling_named(database_path: &Path, name: &str) -> PathBuf {
    database_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(name)
}

fn sidecar_path(database_path: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}{suffix}", database_path.to_string_lossy()))
}

fn file_name_string(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .ok_or_else(|| "The restore journal path is not valid UTF-8.".to_string())
}

fn safe_journal_sibling(
    database_path: &Path,
    name: &str,
    required_prefix: &str,
) -> Result<PathBuf, String> {
    validate_journal_filename(name, required_prefix)?;
    Ok(sibling_named(database_path, name))
}

fn safe_journal_backup_path(
    database_path: &Path,
    name: &str,
    required_prefix: &str,
) -> Result<PathBuf, String> {
    validate_journal_filename(name, required_prefix)?;
    Ok(backup_directory(database_path)?.join(name))
}

fn validate_journal_filename(name: &str, required_prefix: &str) -> Result<(), String> {
    let path = Path::new(name);
    if path.components().count() != 1
        || path.file_name().and_then(|value| value.to_str()) != Some(name)
        || name == "."
        || name == ".."
        || !name.starts_with(required_prefix)
        || path.extension().and_then(|value| value.to_str()) != Some("db")
    {
        return Err("The restore journal contains an unsafe path.".to_string());
    }
    Ok(())
}

fn write_apply_journal(database_path: &Path, journal: &ApplyJournal) -> Result<(), String> {
    let journal_path = apply_journal_path(database_path);
    let temp = sibling_named(database_path, "laundry.restore.apply.json.tmp");
    let encoded = serde_json::to_vec(journal)
        .map_err(|error| format!("Could not encode the restore journal: {error}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temp)
        .map_err(|error| format!("Could not write the restore journal: {error}"))?;
    file.write_all(&encoded)
        .map_err(|error| format!("Could not write the restore journal: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Could not sync the restore journal: {error}"))?;
    fs::rename(&temp, &journal_path)
        .map_err(|error| format!("Could not publish the restore journal: {error}"))?;
    sync_parent_directory(database_path)
}

fn read_apply_journal(database_path: &Path) -> Result<ApplyJournal, String> {
    let path = apply_journal_path(database_path);
    let mut file = File::open(&path)
        .map_err(|error| format!("Could not read the restore journal: {error}"))?;
    let mut contents = Vec::new();
    file.read_to_end(&mut contents)
        .map_err(|error| format!("Could not read the restore journal: {error}"))?;
    serde_json::from_slice(&contents)
        .map_err(|error| format!("The restore journal is invalid and was preserved: {error}"))
}

fn remove_apply_journal(database_path: &Path) -> Result<(), String> {
    let path = apply_journal_path(database_path);
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Could not remove the completed restore journal: {error}"))?;
        sync_parent_directory(database_path)?;
    }
    Ok(())
}

fn quarantine_database_file(database_path: &Path) -> Result<PathBuf, String> {
    let rejected = unique_sibling_path(database_path, "restore-rejected", "db")?;
    let mut moved_sidecars = Vec::new();
    for suffix in ["-wal", "-shm"] {
        let sidecar = sidecar_path(database_path, suffix);
        if sidecar.exists() {
            let rejected_sidecar = sidecar_path(&rejected, suffix);
            if let Err(error) = fs::rename(&sidecar, &rejected_sidecar) {
                for (original, preserved) in moved_sidecars.into_iter().rev() {
                    let _ = fs::rename(preserved, original);
                }
                return Err(format!(
                    "Could not preserve a rejected database sidecar: {error}"
                ));
            }
            moved_sidecars.push((sidecar, rejected_sidecar));
        }
    }

    if let Err(error) = fs::rename(database_path, &rejected) {
        for (original, preserved) in moved_sidecars.into_iter().rev() {
            let _ = fs::rename(preserved, original);
        }
        return Err(format!(
            "Could not preserve the rejected database file: {error}"
        ));
    }
    sync_parent_directory(database_path)?;
    Ok(rejected)
}

fn prune_backups(database_path: &Path, keep: usize) -> Result<(), String> {
    let directory = backup_directory(database_path)?;
    if !directory.exists() {
        return Ok(());
    }
    let mut backups = fs::read_dir(&directory)
        .map_err(|error| format!("Could not list database backups: {error}"))?
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
        .collect::<Vec<_>>();
    backups.sort_by_key(|entry| entry.file_name());
    while backups.len() > keep {
        let oldest = backups.remove(0);
        fs::remove_file(oldest.path())
            .map_err(|error| format!("Could not remove an expired database backup: {error}"))?;
    }
    Ok(())
}

fn remove_database_files(database_path: &Path) -> Result<(), String> {
    for path in [
        database_path.to_path_buf(),
        sidecar_path(database_path, "-wal"),
        sidecar_path(database_path, "-shm"),
    ] {
        if path.exists() {
            fs::remove_file(path)
                .map_err(|error| format!("Could not remove a temporary database file: {error}"))?;
        }
    }
    Ok(())
}

fn sync_file(path: &Path) -> Result<(), String> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("Could not sync database file {}: {error}", path.display()))
}

fn sync_parent_directory(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The local database directory is unavailable.".to_string())?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Could not sync the local database directory: {error}"))
}

fn absolute_path(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map(|current| current.join(&path))
            .unwrap_or(path)
    }
}

#[cfg(test)]
#[path = "storage_tests.rs"]
mod storage_tests;
