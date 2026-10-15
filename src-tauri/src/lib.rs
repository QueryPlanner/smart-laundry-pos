use std::path::PathBuf;

use counter::{AccountInput, CounterSession};
use tauri::{AppHandle, Builder, Manager, Runtime, State};

mod counter;
mod printing;
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
            let _ = tauri::async_runtime::block_on(counter::recover_submitting(&state));
            app.manage(state);
            app.manage(CounterSession::default());
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            counter_bootstrap,
            counter_setup_admin,
            counter_login,
            counter_lock,
            counter_list_staff,
            counter_create_staff,
            counter_set_staff_active,
            counter_reset_staff_pin,
            counter_get_catalogue,
            counter_search_customers,
            counter_set_rate,
            counter_quote_order,
            counter_save_order,
            counter_get_order_pieces,
            counter_match_order_pieces,
            counter_enumerate_printers,
            counter_set_printer_profiles,
            counter_get_printer_profiles,
            counter_list_print_jobs,
            counter_dispatch_print_jobs,
            counter_retry_print_job,
            counter_reprint_output,
            local_select,
            local_read_batch,
            local_batch,
            local_database_info,
            backup_database,
            restore_database
        ])
}

#[tauri::command]
async fn counter_bootstrap(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
) -> Result<counter::Bootstrap, String> {
    counter::bootstrap(&state, &session).await
}
#[tauri::command]
async fn counter_setup_admin(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    input: AccountInput,
) -> Result<counter::Account, String> {
    counter::setup_admin(&state, &session, input).await
}
#[tauri::command]
async fn counter_login(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    user_id: String,
    pin: String,
) -> Result<counter::Account, String> {
    counter::login(&state, &session, user_id, pin).await
}
#[tauri::command]
fn counter_lock(session: State<'_, CounterSession>) {
    session.lock();
}
#[tauri::command]
async fn counter_list_staff(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
) -> Result<Vec<counter::Account>, String> {
    counter::list_staff(&state, &session).await
}
#[tauri::command]
async fn counter_create_staff(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    input: AccountInput,
) -> Result<counter::Account, String> {
    counter::create_staff(&state, &session, input).await
}
#[tauri::command]
async fn counter_set_staff_active(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    user_id: String,
    active: bool,
) -> Result<(), String> {
    counter::update_staff(&state, &session, &user_id, Some(active), None).await
}
#[tauri::command]
async fn counter_reset_staff_pin(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    user_id: String,
    pin: String,
) -> Result<(), String> {
    counter::update_staff(&state, &session, &user_id, None, Some(&pin)).await
}

#[tauri::command]
async fn counter_get_catalogue(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
) -> Result<counter::Catalogue, String> {
    counter::catalogue(&state, &session).await
}
#[tauri::command]
async fn counter_search_customers(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    phone: String,
) -> Result<Vec<serde_json::Value>, String> {
    counter::search_customers(&state, &session, &phone).await
}
#[tauri::command]
async fn counter_set_rate(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    garment_id: String,
    service_id: String,
    price_minor: Option<i64>,
    available: bool,
) -> Result<(), String> {
    counter::set_rate(
        &state,
        &session,
        &garment_id,
        &service_id,
        price_minor,
        available,
    )
    .await
}
#[tauri::command]
async fn counter_quote_order(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    input: counter::OrderInput,
) -> Result<counter::Quote, String> {
    counter::quote(&state, &session, &input).await
}
#[tauri::command]
async fn counter_save_order(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    input: counter::SaveInput,
) -> Result<counter::SavedOrder, String> {
    counter::save_order(&state, &session, input).await
}
#[tauri::command]
async fn counter_get_order_pieces(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    order_id: String,
) -> Result<Vec<counter::Piece>, String> {
    counter::pieces(&state, &session, &order_id).await
}
#[tauri::command]
async fn counter_match_order_pieces(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    order_id: String,
    piece_ids: Vec<String>,
) -> Result<counter::MatchResult, String> {
    counter::match_pieces(&state, &session, &order_id, piece_ids).await
}
#[tauri::command]
async fn counter_enumerate_printers(
    session: State<'_, CounterSession>,
) -> Result<Vec<printing::PrinterInfo>, String> {
    counter::enumerate_printers(&session).await
}
#[tauri::command]
async fn counter_set_printer_profiles(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    profiles: counter::ProfilesInput,
) -> Result<(), String> {
    counter::set_profiles(&state, &session, profiles).await
}
#[tauri::command]
async fn counter_get_printer_profiles(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
) -> Result<serde_json::Value, String> {
    counter::get_profiles(&state, &session)
        .await
        .map(|x| serde_json::to_value(x).unwrap_or(serde_json::Value::Null))
}
#[tauri::command]
async fn counter_list_print_jobs(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    order_id: Option<String>,
) -> Result<Vec<counter::PrintJob>, String> {
    counter::list_jobs(&state, &session, order_id.as_deref()).await
}
#[tauri::command]
async fn counter_dispatch_print_jobs(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    order_id: String,
) -> Result<Vec<counter::PrintJob>, String> {
    counter::dispatch_jobs(&state, &session, &order_id).await
}
#[tauri::command]
async fn counter_retry_print_job(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    job_id: String,
    confirm_uncertain: bool,
) -> Result<counter::PrintJob, String> {
    counter::retry_job(&state, &session, &job_id, confirm_uncertain).await
}

#[tauri::command]
async fn counter_reprint_output(
    state: State<'_, DatabaseState>,
    session: State<'_, counter::CounterSession>,
    order_id: String,
    kind: String,
    piece_ids: Vec<String>,
    request_id: String,
) -> Result<counter::PrintJob, String> {
    counter::reprint_output(&state, &session, &order_id, &kind, piece_ids, &request_id).await
}

#[tauri::command]
async fn local_select(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    query: String,
    values: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    counter::authorize_sql(&state, &session).await?;
    state.local_select(query, values).await
}

#[tauri::command]
async fn local_read_batch(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    statements: Vec<SqlStatement>,
) -> Result<Vec<Vec<serde_json::Value>>, String> {
    counter::authorize_sql(&state, &session).await?;
    state.local_read_batch(statements).await
}

#[tauri::command]
async fn local_batch(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    statements: Vec<SqlStatement>,
) -> Result<Vec<SqlExecutionResult>, String> {
    counter::authorize_sql(&state, &session).await?;
    state.local_batch(statements).await
}

#[tauri::command]
fn local_database_info(state: State<'_, DatabaseState>) -> LocalDatabaseInfo {
    state.info()
}

#[tauri::command]
async fn backup_database(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
) -> Result<String, String> {
    counter::authorize_sql(&state, &session).await?;
    state.backup_database().await
}

#[tauri::command]
async fn restore_database(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    source_path: String,
) -> Result<String, String> {
    counter::authorize_sql(&state, &session).await?;
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
