use std::path::PathBuf;

use tauri::{AppHandle, Builder, Manager, Runtime, State};

mod storage;

pub use storage::{DatabaseState, LocalDatabaseInfo, SqlExecutionResult, SqlStatement};

fn database_path_from_config_dir<E: std::fmt::Display>(
    app_config_dir: Result<PathBuf, E>,
) -> Result<PathBuf, String> {
    app_config_dir
        .map(|directory| directory.join("laundry.db"))
        .map_err(|error| format!("Could not find the local database directory: {error}"))
}

fn app_database_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    database_path_from_config_dir(app.path().app_config_dir())
}

fn app_builder<R, F>(builder: Builder<R>, database_path: F) -> Builder<R>
where
    R: Runtime,
    F: FnOnce(&AppHandle<R>) -> Result<PathBuf, String> + Send + 'static,
{
    builder
        .setup(move |app| {
            let state = match database_path(app.handle()) {
                Ok(path) => tauri::async_runtime::block_on(DatabaseState::open(path)),
                Err(error) => DatabaseState::unavailable(error),
            };
            app.manage(state);
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            local_select,
            local_read_batch,
            local_batch,
            local_database_info,
            backup_database,
            restore_database
        ])
}

#[tauri::command]
async fn local_select(
    state: State<'_, DatabaseState>,
    query: String,
    values: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    state.local_select(query, values).await
}

#[tauri::command]
async fn local_read_batch(
    state: State<'_, DatabaseState>,
    statements: Vec<SqlStatement>,
) -> Result<Vec<Vec<serde_json::Value>>, String> {
    state.local_read_batch(statements).await
}

#[tauri::command]
async fn local_batch(
    state: State<'_, DatabaseState>,
    statements: Vec<SqlStatement>,
) -> Result<Vec<SqlExecutionResult>, String> {
    state.local_batch(statements).await
}

#[tauri::command]
fn local_database_info(state: State<'_, DatabaseState>) -> LocalDatabaseInfo {
    state.info()
}

#[tauri::command]
async fn backup_database(state: State<'_, DatabaseState>) -> Result<String, String> {
    state.backup_database().await
}

#[tauri::command]
async fn restore_database(
    state: State<'_, DatabaseState>,
    source_path: String,
) -> Result<String, String> {
    let request = state.restore_database(source_path);
    tauri::async_runtime::spawn_blocking(move || tauri::async_runtime::block_on(request.apply()))
        .await
        .map_err(|error| format!("The database restore task failed: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app_builder(tauri::Builder::default(), app_database_path)
        .run(tauri::generate_context!())
        .expect("error while running Smart Laundry POS");
}

#[cfg(test)]
mod app_tests;
