use super::*;

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::webview::InvokeRequest;
use tauri::{AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

static TEMP_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TempDirectory {
    path: PathBuf,
}

impl TempDirectory {
    fn new() -> Self {
        for _ in 0..100 {
            let sequence = TEMP_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be available")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "smart-laundry-app-test-{}-{timestamp}-{sequence}",
                std::process::id()
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Self { path },
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("could not create temporary app-test directory: {error}"),
            }
        }
        panic!("could not choose a unique temporary app-test directory");
    }

    fn database_path(&self) -> PathBuf {
        self.path.join("laundry.db")
    }
}

impl Drop for TempDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn run_mock_app<F>(database_path: F, requests: Vec<(String, Value)>) -> Vec<Result<Value, Value>>
where
    F: FnOnce(&AppHandle<MockRuntime>) -> Result<PathBuf, String> + Send + 'static,
{
    run_mock_app_with(database_path, requests, None, Duration::ZERO)
}

/// Like `run_mock_app`, optionally starting the periodic backup thread and keeping the app alive
/// for `linger` after the requests so that background work can happen.
fn run_mock_app_with<F>(
    database_path: F,
    mut requests: Vec<(String, Value)>,
    backup_every: Option<Duration>,
    linger: Duration,
) -> Vec<Result<Value, Value>>
where
    F: FnOnce(&AppHandle<MockRuntime>) -> Result<PathBuf, String> + Send + 'static,
{
    let app = app_builder(mock_builder(), database_path, backup_every)
        .build(mock_context(noop_assets()))
        .expect("mock Tauri app should build");
    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::App("index.html".into()))
        .build()
        .expect("mock webview should build");
    let responses = Arc::new(Mutex::new(Vec::new()));
    let recorded_responses = Arc::clone(&responses);

    app.run_return(move |_app, event| {
        if matches!(event, tauri::RunEvent::Ready) {
            _app.state::<crate::counter::CounterSession>().set(crate::counter::SessionActor { id: "fixture-admin".into(), role: "admin".into() }).expect("test session should be initialized");
            if let Ok(pool) = _app.state::<DatabaseState>().writer_pool() {
                tauri::async_runtime::block_on(async {
                    sqlx::query("INSERT OR IGNORE INTO counter_accounts(id,full_name,pin_hash,pin_salt,role,active,created_at,updated_at) VALUES('fixture-admin','Fixture Admin','hash','salt','admin',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
                        .execute(pool).await.expect("fixture administrator should be seeded");
                });
            }
            let mut results = recorded_responses
                .lock()
                .expect("IPC response storage should not be poisoned");
            let pending_requests = std::mem::take(&mut requests);
            for (command, payload) in pending_requests {
                results.push(invoke(&window, &command, payload));
            }
            std::thread::sleep(linger);
            window.destroy().expect("mock window should be destroyed");
        }
    });

    Arc::try_unwrap(responses)
        .expect("Tauri event loop should release IPC response storage")
        .into_inner()
        .expect("IPC response storage should not be poisoned")
}

fn invoke(
    window: &WebviewWindow<MockRuntime>,
    command: &str,
    payload: Value,
) -> Result<Value, Value> {
    let request = InvokeRequest {
        cmd: command.to_string(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: "tauri://localhost".parse().unwrap(),
        body: InvokeBody::Json(payload),
        headers: Default::default(),
        invoke_key: tauri::test::INVOKE_KEY.to_string(),
    };
    let (sender, receiver) = sync_channel(1);
    window.as_ref().clone().on_message(
        request,
        Box::new(move |_window, _command, response, _callback, _error| {
            sender
                .send(response)
                .expect("IPC response receiver should remain available");
        }),
    );

    match receiver
        .recv_timeout(Duration::from_secs(10))
        .expect("Tauri command should respond within 10 seconds")
    {
        InvokeResponse::Ok(body) => Ok(body
            .deserialize::<Value>()
            .expect("IPC response should serialize as JSON")),
        InvokeResponse::Err(error) => Err(error.0),
    }
}

async fn insert_marker(state: &DatabaseState, key: &str, value: &str) {
    let result = state
        .local_batch(vec![SqlStatement {
            sql:
                "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)"
                    .to_string(),
            values: vec![json!(key), json!(value)],
            expected_rows: Some(1),
            error: Some("test marker should be inserted".to_string()),
            mode: None,
        }])
        .await
        .expect("test marker should be written");
    assert_eq!(result[0].rows_affected, 1);
}

#[test]
fn commands_round_trip_through_mock_ipc() {
    let live = TempDirectory::new();
    let source = TempDirectory::new();
    let live_path = live.database_path();
    let source_path = source.database_path();
    tauri::async_runtime::block_on(async {
        let source_state = DatabaseState::open(source_path.clone()).await;
        assert_eq!(source_state.info().error, None);
        insert_marker(&source_state, "restore-marker", "from-source").await;
    });

    let resolver_path = live_path.clone();
    let responses = run_mock_app(
        move |_| Ok(resolver_path),
        vec![
            ("counter_bootstrap".to_string(), json!({})),
            ("counter_backup_now".to_string(), json!({})),
            (
                "counter_restore_backup".to_string(),
                json!({"sourcePath": live_path.to_string_lossy()}),
            ),
            (
                "counter_restore_backup".to_string(),
                json!({"sourcePath": source_path.to_string_lossy()}),
            ),
            ("counter_bootstrap".to_string(), json!({})),
            (
                "counter_set_backup_mirror".to_string(),
                json!({"directory": null}),
            ),
        ],
    );

    let info = responses[0]
        .as_ref()
        .expect("bootstrap should serialize as JSON");
    assert_eq!(info["restorePending"], false);
    assert_eq!(info["authenticated"], true);

    let backup = responses[1]
        .as_ref()
        .expect("backup command should return the backup settings");
    assert!(backup["lastBackupAt"].is_string());
    let folder = PathBuf::from(
        backup["folder"]
            .as_str()
            .expect("backup folder should serialize as a string"),
    );
    assert!(folder.exists());
    assert!(
        responses[2].is_err(),
        "the active database is not a valid backup to restore"
    );
    assert_eq!(
        responses[3]
            .as_ref()
            .expect("restore command should stage the replacement")
            .as_str(),
        Some("Restore staged. Close and reopen the app to apply it.")
    );
    let staged = responses[4]
        .as_ref()
        .expect("bootstrap should serialize after staging");
    assert_eq!(staged["restorePending"], true);
    assert!(responses[5]
        .as_ref()
        .expect_err("writes are blocked once a restore is staged")
        .as_str()
        .is_some_and(|message| message.contains("restore is staged")),);
}

#[test]
fn the_raw_sql_bridge_and_unguarded_backup_commands_are_not_registered() {
    let live = TempDirectory::new();
    let path = live.database_path();
    let retired = [
        "local_select",
        "local_read_batch",
        "local_batch",
        "local_database_info",
        "backup_database",
        "restore_database",
    ];
    let requests = retired
        .iter()
        .map(|name| {
            (
                name.to_string(),
                json!({"query": "SELECT 1", "values": [], "statements": [], "sourcePath": "x.db"}),
            )
        })
        .collect();
    let responses = run_mock_app(move |_| Ok(path), requests);
    for (name, response) in retired.iter().zip(responses) {
        let error = response.expect_err("a retired command must not be callable");
        assert!(
            error.to_string().contains("not found"),
            "{name} should be unknown, got {error}"
        );
    }
}

#[test]
fn a_staff_session_cannot_restore_or_back_up_through_the_ipc_layer() {
    let live = TempDirectory::new();
    let path = live.database_path();
    let source = TempDirectory::new();
    let source_path = source.database_path();
    tauri::async_runtime::block_on(async {
        assert_eq!(
            DatabaseState::open(source_path.clone()).await.info().error,
            None
        );
    });
    let staff_source = source_path.to_string_lossy().into_owned();
    let app = app_builder(mock_builder(), move |_| Ok(path), None)
        .build(mock_context(noop_assets()))
        .expect("mock Tauri app should build");
    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::App("index.html".into()))
        .build()
        .expect("mock webview should build");
    let responses = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&responses);
    app.run_return(move |app, event| {
        if matches!(event, tauri::RunEvent::Ready) {
            app.state::<crate::counter::CounterSession>()
                .set(crate::counter::SessionActor {
                    id: "fixture-staff".into(),
                    role: "staff".into(),
                })
                .expect("test session should be initialized");
            let mut results = recorded.lock().expect("response storage");
            results.push(invoke(
                &window,
                "counter_restore_backup",
                json!({"sourcePath": staff_source}),
            ));
            results.push(invoke(&window, "counter_backup_now", json!({})));
            window.destroy().expect("mock window should be destroyed");
        }
    });
    let responses = Arc::try_unwrap(responses)
        .expect("event loop released the responses")
        .into_inner()
        .expect("response storage");
    for response in responses {
        let error = response.expect_err("staff cannot restore or back up");
        assert!(
            error.to_string().contains("Administrator access"),
            "{error}"
        );
    }
}

#[test]
fn mock_startup_applies_staged_restore_before_serving_commands() {
    let live = TempDirectory::new();
    let source = TempDirectory::new();
    let live_path = live.database_path();
    let source_path = source.database_path();

    tauri::async_runtime::block_on(async {
        let live_state = DatabaseState::open(live_path.clone()).await;
        let source_state = DatabaseState::open(source_path.clone()).await;
        assert_eq!(live_state.info().error, None);
        assert_eq!(source_state.info().error, None);
        insert_marker(&live_state, "restore-marker", "before-startup").await;
        insert_marker(&source_state, "restore-marker", "from-source").await;
        let staged = live_state
            .restore_database(source_path.to_string_lossy().into_owned())
            .apply()
            .await
            .expect("valid replacement should stage before app startup");
        assert!(staged.starts_with("Restore staged."));
    });

    let resolver_path = live_path.clone();
    let responses = run_mock_app(
        move |_| Ok(resolver_path),
        vec![("counter_bootstrap".to_string(), json!({}))],
    );
    let info = responses[0]
        .as_ref()
        .expect("bootstrap should serialize after startup recovery");
    assert_eq!(info["restorePending"], false);
    assert!(info.get("error").is_none());

    // The application's own startup ran the staged restore: the replacement's marker is live.
    tauri::async_runtime::block_on(async {
        // The app still holds its instance lock, so read the file directly (read-only).
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&live_path)
            .read_only(true);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("restored database should open read-only");
        let marker: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'restore-marker'")
                .fetch_one(&pool)
                .await
                .expect("restored database should contain the marker");
        assert_eq!(marker, "from-source");
    });
}

#[test]
fn unavailable_database_state_is_serialized_through_every_command() {
    let failure = "injected app config directory failure".to_string();
    let resolver_failure = failure.clone();
    let requests = vec![
        ("counter_bootstrap".to_string(), json!({})),
        ("counter_backup_now".to_string(), json!({})),
        (
            "counter_restore_backup".to_string(),
            json!({"sourcePath": "unused.db"}),
        ),
        (
            "counter_set_backup_mirror".to_string(),
            json!({"directory": null}),
        ),
    ];
    let responses = run_mock_app(move |_| Err(resolver_failure), requests);

    // The start-up failure reaches the screen as the bootstrap error, so the owner is told why.
    for (index, command) in [
        "counter_bootstrap",
        "counter_backup_now",
        "counter_restore_backup",
        "counter_set_backup_mirror",
    ]
    .into_iter()
    .enumerate()
    {
        let error = responses[index]
            .as_ref()
            .expect_err("unavailable database command should return an IPC error");
        assert_eq!(error, &Value::String(failure.clone()), "{command}");
    }
}

#[test]
fn app_config_path_mapping_preserves_the_runtime_error() {
    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("mock app should build for path-resolution test");
    let resolved = app_database_path(app.handle());
    assert!(resolved.is_ok());

    let failure = database_path_from_config_dir::<&str>(Err("config path unavailable"))
        .expect_err("config path errors should be reported");
    assert!(failure.contains("Could not find the local database directory"));
    assert!(failure.contains("config path unavailable"));
}

fn backup_files(directory: &TempDirectory) -> usize {
    fs::read_dir(directory.path.join("backups"))
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().starts_with("laundry-"))
                .count()
        })
        .unwrap_or(0)
}

#[test]
fn the_running_app_keeps_backing_up_in_the_background() {
    let live = TempDirectory::new();
    let path = live.database_path();
    let responses = run_mock_app_with(
        move |_| Ok(path),
        vec![("counter_bootstrap".to_string(), json!({}))],
        Some(Duration::from_millis(60)),
        Duration::from_millis(900),
    );
    assert!(responses[0].is_ok());
    assert!(
        backup_files(&live) >= 3,
        "one start-up backup plus periodic ones, found {}",
        backup_files(&live)
    );
}

#[test]
fn without_a_periodic_interval_only_the_startup_backup_is_taken() {
    let live = TempDirectory::new();
    let path = live.database_path();
    run_mock_app_with(
        move |_| Ok(path),
        vec![("counter_bootstrap".to_string(), json!({}))],
        None,
        Duration::from_millis(300),
    );
    assert_eq!(backup_files(&live), 1);
}

#[test]
fn a_reset_file_resets_the_admin_pin_at_startup_and_is_reported_then_deleted() {
    let live = TempDirectory::new();
    let path = live.database_path();
    tauri::async_runtime::block_on(async {
        let state = DatabaseState::open(path.clone()).await;
        let pool = state.writer_pool().unwrap();
        sqlx::query("INSERT INTO local_users(id,full_name,pin_hash,pin_salt,role,created_at,updated_at) VALUES('boss','Owner','old','old','admin',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
            .execute(pool).await.unwrap();
        sqlx::query("INSERT INTO counter_accounts(id,full_name,pin_hash,pin_salt,role,active,created_at,updated_at,failed_attempts,locked_until) VALUES('boss','Owner','old','old','admin',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,5,'2999-01-01T00:00:00Z')")
            .execute(pool).await.unwrap();
    });
    let reset_file = live.path.join(crate::counter::ADMIN_PIN_RESET_FILE);
    fs::write(&reset_file, "  2468\n").unwrap();
    let resolver = path.clone();
    let responses = run_mock_app(
        move |_| Ok(resolver),
        vec![("counter_bootstrap".to_string(), json!({}))],
    );
    let info = responses[0].as_ref().unwrap();
    assert!(
        info["warning"]
            .as_str()
            .is_some_and(|w| w.contains("administrator PIN was reset")),
        "{info}"
    );
    assert!(!reset_file.exists(), "the PIN file is deleted once applied");
}

#[test]
fn a_quick_restart_does_not_make_another_backup() {
    let live = TempDirectory::new();
    let path = live.database_path();
    let first_path = path.clone();
    run_mock_app_with(
        move |_| Ok(first_path),
        vec![("counter_bootstrap".to_string(), json!({}))],
        None,
        Duration::from_millis(400),
    );
    assert_eq!(backup_files(&live), 1, "the first start saves a backup");
    run_mock_app_with(
        move |_| Ok(path),
        vec![("counter_bootstrap".to_string(), json!({}))],
        None,
        Duration::from_millis(400),
    );
    assert_eq!(
        backup_files(&live),
        1,
        "a restart minutes later must not add a near-identical backup"
    );
}
