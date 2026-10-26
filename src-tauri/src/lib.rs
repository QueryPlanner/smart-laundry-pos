use std::path::PathBuf;
use std::time::Duration;

use counter::{AccountInput, CounterSession};
use tauri::{AppHandle, Builder, Manager, Runtime, State};

mod counter;
mod insights;
mod office;
mod print_layout;
mod printing;
mod shop_settings;
mod storage;

pub use storage::{DatabaseState, LocalDatabaseInfo};
#[cfg(test)]
pub use storage::{SqlExecutionResult, SqlStatement};

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

/// How often the running app saves a backup, in addition to the one taken at every start. A shop
/// computer may stay on for weeks, so start-up backups alone would leave a long unprotected gap.
const PERIODIC_BACKUP_INTERVAL: Duration = Duration::from_secs(4 * 60 * 60);

/// A restart within this time of the last backup does not make another one, so a computer that
/// keeps crashing and restarting cannot push real history out of the retained backups.
const RECENT_BACKUP_WINDOW_MINUTES: i64 = 10;

fn run_backup(state: &DatabaseState) {
    let info = state.info();
    if info.error.is_none() && !info.restore_pending {
        // A failure is recorded by the backup itself and shown to the owner at the next sign-in.
        let _ = tauri::async_runtime::block_on(state.backup_database());
    }
}

/// Backups run on their own thread so a slow or unplugged second drive can never delay the
/// window opening: one soon after start-up (unless a very recent one exists), then one every
/// `every` while the app stays open.
fn spawn_backup_thread<R: Runtime>(handle: AppHandle<R>, every: Option<Duration>) {
    let _ = std::thread::Builder::new()
        .name("backup".into())
        .spawn(move || {
            let state = handle.state::<DatabaseState>();
            let recent = tauri::async_runtime::block_on(
                state.backed_up_within(chrono::Duration::minutes(RECENT_BACKUP_WINDOW_MINUTES)),
            );
            if !recent {
                run_backup(&state);
            }
            let Some(every) = every else { return };
            loop {
                std::thread::sleep(every);
                run_backup(&state);
            }
        });
}

fn app_builder<R, F>(
    builder: Builder<R>,
    database_path: F,
    backup_every: Option<Duration>,
) -> Builder<R>
where
    R: Runtime,
    F: FnOnce(&AppHandle<R>) -> Result<PathBuf, String> + Send + 'static,
{
    builder
        .setup(move |app| {
            let mut state = match database_path(app.handle()) {
                Ok(path) => tauri::async_runtime::block_on(DatabaseState::open(path)),
                Err(error) => DatabaseState::unavailable(error),
            };
            let _ = tauri::async_runtime::block_on(counter::recover_submitting(&state));
            if state.info().error.is_none() {
                if let Some(notice) =
                    tauri::async_runtime::block_on(counter::apply_admin_pin_reset_file(&state))
                {
                    state.set_startup_warning(notice);
                }
            }
            app.manage(state);
            app.manage(CounterSession::default());
            spawn_backup_thread(app.handle().clone(), backup_every);
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
            counter_search_orders,
            counter_order_queue_counts,
            counter_hand_over_items,
            counter_get_order,
            counter_record_payment,
            counter_update_order_status,
            counter_collect_order,
            counter_cancel_order,
            counter_save_rate_card,
            counter_trash_order,
            counter_request_order_trash,
            counter_list_trash_requests,
            counter_dismiss_trash_request,
            counter_list_trashed_orders,
            counter_restore_order,
            counter_clear_all_orders,
            counter_preview_draft_bill,
            counter_preview_order_bill,
            counter_backup_settings,
            counter_set_backup_mirror,
            counter_backup_now,
            counter_list_discounts,
            counter_set_discount,
            counter_quote_order,
            counter_save_order,
            counter_get_order_pieces,
            counter_match_order_pieces,
            counter_enumerate_printers,
            counter_set_printer_profiles,
            counter_get_printer_profiles,
            counter_list_print_jobs,
            counter_dispatch_print_jobs,
            counter_dispatch_print_job,
            counter_retry_print_job,
            counter_reprint_output,
            office::counter_list_customers,
            office::counter_get_customer,
            office::counter_create_customer,
            office::counter_update_customer,
            office::counter_delete_customer,
            office::counter_list_expenses,
            office::counter_create_expense,
            office::counter_delete_expense,
            office::counter_list_inventory,
            office::counter_create_inventory_item,
            office::counter_adjust_inventory,
            office::counter_delete_inventory_item,
            office::counter_list_machines,
            office::counter_create_machine,
            office::counter_update_machine,
            office::counter_delete_machine,
            shop_settings::counter_get_shop_settings,
            shop_settings::counter_save_shop_settings,
            insights::counter_dashboard_overview,
            insights::counter_sales_summary,
            insights::counter_sales_series,
            insights::counter_sales_orders,
            insights::counter_sales_transactions,
            insights::counter_sales_staff_options,
            insights::counter_export_sales_csv,
            counter_restore_backup
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
async fn counter_search_orders(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    query: String,
    offset: u32,
    limit: u32,
    filter: Option<String>,
) -> Result<Vec<counter::OrderSummary>, String> {
    counter::search_orders(&state, &session, &query, offset, limit, filter.as_deref()).await
}
#[tauri::command]
async fn counter_hand_over_items(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    order_id: String,
    item_ids: Vec<String>,
) -> Result<counter::SavedOrder, String> {
    counter::hand_over_items(&state, &session, &order_id, &item_ids).await
}
#[tauri::command]
async fn counter_order_queue_counts(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
) -> Result<counter::QueueCounts, String> {
    counter::order_queue_counts(&state, &session).await
}
#[tauri::command]
async fn counter_get_order(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    order_id: String,
) -> Result<Option<counter::SavedOrder>, String> {
    counter::get_order(&state, &session, &order_id).await
}
#[tauri::command]
async fn counter_record_payment(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    order_id: String,
    input: counter::RecordPaymentInput,
) -> Result<counter::SavedOrder, String> {
    counter::record_payment(&state, &session, &order_id, input).await
}
#[tauri::command]
async fn counter_update_order_status(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    order_id: String,
    status: String,
) -> Result<counter::SavedOrder, String> {
    counter::update_order_status(&state, &session, &order_id, &status).await
}
#[tauri::command]
async fn counter_collect_order(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    order_id: String,
    piece_ids: Vec<String>,
    request_id: String,
    payment: Option<counter::RecordPaymentInput>,
) -> Result<counter::SavedOrder, String> {
    counter::collect_order(&state, &session, &order_id, piece_ids, &request_id, payment).await
}

#[tauri::command]
async fn counter_cancel_order(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    order_id: String,
    reason: String,
) -> Result<counter::SavedOrder, String> {
    counter::cancel_order(&state, &session, &order_id, &reason).await
}

#[tauri::command]
async fn counter_save_rate_card(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    changes: counter::RateCardChanges,
) -> Result<counter::Catalogue, String> {
    counter::save_rate_card(&state, &session, &changes).await
}
#[tauri::command]
async fn counter_trash_order(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    order_id: String,
) -> Result<(), String> {
    counter::trash_order(&state, &session, &order_id).await
}
#[tauri::command]
async fn counter_request_order_trash(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    order_id: String,
    reason: String,
) -> Result<(), String> {
    counter::request_order_trash(&state, &session, &order_id, &reason).await
}
#[tauri::command]
async fn counter_list_trash_requests(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
) -> Result<Vec<counter::TrashRequest>, String> {
    counter::list_trash_requests(&state, &session).await
}
#[tauri::command]
async fn counter_dismiss_trash_request(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    order_id: String,
) -> Result<(), String> {
    counter::dismiss_trash_request(&state, &session, &order_id).await
}
#[tauri::command]
async fn counter_list_trashed_orders(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
) -> Result<Vec<counter::TrashedOrder>, String> {
    counter::list_trashed_orders(&state, &session).await
}
#[tauri::command]
async fn counter_restore_order(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    order_id: String,
) -> Result<(), String> {
    counter::restore_order(&state, &session, &order_id).await
}
#[tauri::command]
async fn counter_clear_all_orders(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    confirmation: String,
) -> Result<counter::ClearedOrders, String> {
    counter::clear_all_orders(&state, &session, &confirmation).await
}
#[tauri::command]
async fn counter_preview_draft_bill(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    input: counter::OrderInput,
) -> Result<printing::BillPreview, String> {
    counter::preview_draft_bill(&state, &session, &input).await
}
#[tauri::command]
async fn counter_preview_order_bill(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    order_id: String,
) -> Result<printing::BillPreview, String> {
    counter::preview_order_bill(&state, &session, &order_id).await
}
#[tauri::command]
async fn counter_backup_settings(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
) -> Result<counter::BackupSettings, String> {
    counter::backup_settings(&state, &session).await
}

#[tauri::command]
async fn counter_set_backup_mirror(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    directory: Option<String>,
) -> Result<(), String> {
    counter::set_backup_mirror(&state, &session, directory.as_deref()).await
}

#[tauri::command]
async fn counter_backup_now(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
) -> Result<counter::BackupSettings, String> {
    counter::backup_now(&state, &session).await
}

#[tauri::command]
async fn counter_list_discounts(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
) -> Result<Vec<counter::DiscountRule>, String> {
    counter::list_discounts(&state, &session).await
}

#[tauri::command]
async fn counter_set_discount(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    customer_id: Option<String>,
    percent_bp: i64,
    active: bool,
    label: String,
) -> Result<(), String> {
    counter::set_discount(
        &state,
        &session,
        customer_id.as_deref(),
        percent_bp,
        active,
        &label,
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
    stage: String,
    piece_ids: Vec<String>,
) -> Result<counter::MatchResult, String> {
    counter::match_pieces(&state, &session, &order_id, &stage, piece_ids).await
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
async fn counter_dispatch_print_job(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    job_id: String,
) -> Result<counter::PrintJob, String> {
    counter::dispatch_job(&state, &session, &job_id).await
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

/// Admin only: stage a backup file to replace the database at the next start.
#[tauri::command]
async fn counter_restore_backup(
    state: State<'_, DatabaseState>,
    session: State<'_, CounterSession>,
    source_path: String,
) -> Result<String, String> {
    counter::restore_backup(&state, &session, source_path).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app_builder(
        tauri::Builder::default(),
        app_database_path,
        Some(PERIODIC_BACKUP_INTERVAL),
    )
    .run(tauri::generate_context!())
    .expect("error while running Smart Laundry POS");
}

#[cfg(test)]
mod app_tests;
#[cfg(test)]
mod demo_seed;
