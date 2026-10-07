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

fn run_mock_app<F>(
    database_path: F,
    mut requests: Vec<(String, Value)>,
) -> Vec<Result<Value, Value>>
where
    F: FnOnce(&AppHandle<MockRuntime>) -> Result<PathBuf, String> + Send + 'static,
{
    let app = app_builder(mock_builder(), database_path)
        .build(mock_context(noop_assets()))
        .expect("mock Tauri app should build");
    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::App("index.html".into()))
        .build()
        .expect("mock webview should build");
    let responses = Arc::new(Mutex::new(Vec::new()));
    let recorded_responses = Arc::clone(&responses);

    app.run_return(move |_app, event| {
        if matches!(event, tauri::RunEvent::Ready) {
            let mut results = recorded_responses
                .lock()
                .expect("IPC response storage should not be poisoned");
            let pending_requests = std::mem::take(&mut requests);
            for (command, payload) in pending_requests {
                results.push(invoke(&window, &command, payload));
            }
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
            (
                "local_select".to_string(),
                json!({"query": "SELECT 1 AS answer", "values": []}),
            ),
            (
                "local_read_batch".to_string(),
                json!({
                    "statements": [
                        {"sql": "SELECT 2 AS answer", "values": [], "mode": "select"}
                    ]
                }),
            ),
            (
                "local_read_batch".to_string(),
                json!({"statements": [{"sql": "DELETE FROM app_settings", "mode": "select"}]}),
            ),
            (
                "local_batch".to_string(),
                json!({
                    "statements": [
                        {
                            "sql": "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                            "values": ["ipc-marker", "before-restore"],
                            "expectedRows": 1,
                            "error": "IPC insert should affect one row"
                        }
                    ]
                }),
            ),
            (
                "local_batch".to_string(),
                json!({"statements": [{"sql": "SELECT 1"}]}),
            ),
            ("local_database_info".to_string(), json!({})),
            ("backup_database".to_string(), json!({})),
            (
                "restore_database".to_string(),
                json!({"sourcePath": live_path.to_string_lossy()}),
            ),
            (
                "restore_database".to_string(),
                json!({"sourcePath": source_path.to_string_lossy()}),
            ),
            ("local_database_info".to_string(), json!({})),
            ("local_batch".to_string(), json!({"statements": []})),
        ],
    );

    assert_eq!(responses[0], Ok(json!([{"answer": 1}])));
    assert_eq!(responses[1], Ok(json!([[{"answer": 2}]])));
    assert!(responses[2].is_err());
    let batch = responses[3]
        .as_ref()
        .expect("local batch should return a serialized result");
    assert_eq!(batch[0]["rowsAffected"], 1);
    assert!(batch[0].get("lastInsertId").is_some());
    assert!(responses[4].is_err());

    let info = responses[5]
        .as_ref()
        .expect("database info should serialize as JSON");
    assert_eq!(info["path"], live_path.to_string_lossy().as_ref());
    assert_eq!(info["restorePending"], false);
    assert!(info.get("error").is_none());

    let backup_path = responses[6]
        .as_ref()
        .expect("backup command should return its path");
    let backup_path = PathBuf::from(
        backup_path
            .as_str()
            .expect("backup path should serialize as a string"),
    );
    assert!(backup_path.exists());
    assert!(responses[7].is_err());
    let staged_restore = &responses[8];
    assert_eq!(
        staged_restore
            .as_ref()
            .expect("restore command should stage the replacement")
            .as_str(),
        Some("Restore staged. Close and reopen the app to apply it.")
    );
    let staged_info = responses[9]
        .as_ref()
        .expect("database info should serialize after staging");
    assert_eq!(staged_info["restorePending"], true);
    assert!(responses[10].is_err());
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

    let resolver_path = live_path;
    let responses = run_mock_app(
        move |_| Ok(resolver_path),
        vec![
            ("local_database_info".to_string(), json!({})),
            (
                "local_select".to_string(),
                json!({
                    "query": "SELECT value FROM app_settings WHERE key = ?",
                    "values": ["restore-marker"]
                }),
            ),
        ],
    );
    let info = responses[0]
        .as_ref()
        .expect("database info should serialize after startup recovery");
    assert_eq!(info["restorePending"], false);
    assert!(info.get("error").is_none());
    assert_eq!(responses[1], Ok(json!([{"value": "from-source"}])));
}

#[test]
fn unavailable_database_state_is_serialized_through_every_command() {
    let failure = "injected app config directory failure".to_string();
    let resolver_failure = failure.clone();
    let requests = vec![
        ("local_database_info".to_string(), json!({})),
        (
            "local_select".to_string(),
            json!({"query": "SELECT 1", "values": []}),
        ),
        (
            "local_read_batch".to_string(),
            json!({"statements": [{"sql": "SELECT 1", "mode": "select"}]}),
        ),
        (
            "local_batch".to_string(),
            json!({"statements": [{"sql": "INSERT INTO app_settings (key, value, updated_at) VALUES ('k', 'v', CURRENT_TIMESTAMP)"}]}),
        ),
        ("backup_database".to_string(), json!({})),
        (
            "restore_database".to_string(),
            json!({"sourcePath": "unused.db"}),
        ),
    ];
    let responses = run_mock_app(move |_| Err(resolver_failure), requests);

    let info = responses[0]
        .as_ref()
        .expect("unavailable database info should serialize");
    assert_eq!(info["error"], failure);

    for (index, command) in [
        "local_select",
        "local_read_batch",
        "local_batch",
        "backup_database",
        "restore_database",
    ]
    .into_iter()
    .enumerate()
    {
        let error = responses[index + 1]
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
