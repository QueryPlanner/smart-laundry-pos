# Desktop app: acceptance status

Updated 2026-10-16 for branch `codex/print-layout-settings`, based on `origin/main` at `9f88df9`. This records the Linux review build and synthetic CUPS UI print run. It replaces the earlier macOS record of 2026-10-07, which described the build before the counter, discounts, backup folder and Windows printing existed (it is in git history).

## Verdict

The app is not accepted for shop use. The automated checks and the Linux review print run were performed on a Linux development machine. The current Windows adapter has not been built or run on Windows. One single-tag tail was physically inspected by the user; the current three-tag strip and bill have only been checked through their rendered PDFs and CUPS jobs. The Windows checklist at the end remains the release gate.

## How the automated checks are run

The commands are listed in [DESKTOP.md](DESKTOP.md#development-commands). The set that CI runs is: `npm test`, `npm run test:desktop:coverage`, `npm run lint:desktop`, `npm run typecheck:desktop`, `npm run build:desktop`, `npm run build`, and in `src-tauri`: `cargo fmt --all -- --check`, `cargo test`, `cargo clippy --all-targets -- -D warnings`. The coverage gate requires 100% for the desktop JavaScript code. There is no coverage gate for Rust. CI starts only for pull requests to `main` and pushes to `codex/**` branches, not for pushes to other branches such as `claude/**`.

For this branch, `npm run test:desktop` passed 413/413 tests, desktop typecheck and lint passed, `cargo test --manifest-path src-tauri/Cargo.toml --lib` passed (233 passed, 2 ignored), the focused print-layout suite passed 24/24, and Rust formatting and `git diff --check` passed. The Windows GNU check could not finish because `x86_64-w64-mingw32-gcc` and `x86_64-w64-mingw32-windres` are not installed. `npm run tauri:build:linux-review` completed and produced the review .deb and Linux release binary.

## What the app does and how each behaviour is verified

"Automated" means a test in the repository exercises it. Native tests are in `src-tauri/src/counter.rs`, `office.rs`, `shop_settings.rs`, `insights/tests.rs`, `storage_tests.rs`, `printing.rs`, `print_layout.rs` and `app_tests.rs`. UI tests are under `src/components/localCounter/`, `src/lib/localFirst/` and `src/pages/`; they run against a mocked native API, so they test the screens, not the native rules.

| Behaviour | Automated verification |
| --- | --- |
| First start creates the admin (name, 4 to 8 digit PIN, confirmed). An admin from an earlier version 1 database keeps working and their PIN is upgraded on first login. | Native tests; UI flow tests. |
| Staff and admin are separate named accounts, in one shared interface. Only the admin can change rates, discounts, printers, staff, backups and restore, shop settings, cancel orders and delete records. The role is checked in native code. There is no command that runs caller-supplied SQL, and no command outside the `counter_*` set is registered. | Native role-gate tests for rates, discounts, backups, restore, cancel, deletes and shop settings (staff, signed-out, forged and deactivated sessions). `app_tests.rs` checks over mock IPC that the retired SQL and unguarded backup commands are unknown, and `commands.guard.test.ts` checks every registered command is `counter_*` with a wrapper. I did not find a test aimed at each of the printer-profile and staff-management role checks. |
| Five wrong PINs lock an account for five minutes; switching a staff account back on clears the lock. | Native test. |
| Staff pick garment pictures and a service (Wash, Iron, Wash + Iron as default, Dry Clean). | UI tests; native tests for unavailable combinations. |
| Limits: 1 to 200 per line, at most 100 lines, 500 pieces, total under Rs 10,00,000, a rate at most Rs 10,000. | Native tests cover lines, pieces, total and the rate cap. I found no direct test of the 1 to 200 per-line limit. |
| Phone number required and normalised to 10 digits; a customer is matched on phone and name; order search accepts any spelling and lists the newest orders when empty. | Native tests. |
| Prices come only from the admin rate card (garment by service, in paise). Shoes are per pair and cannot be ironed. | Native tests (starter rates loaded, shoes refuse Iron and Wash + Iron, quote totals, audit rows with old and new values). |
| Starter rate card: 18 garments by 4 services plus shoes wash and dry clean are preloaded. These prices are my estimates for the Pune range, not a sourced price list. The owner must replace them. The rate screen shows a note saying so. | Native test checks they load. Nothing checks they are sensible, and they were not sourced. |
| Ready time is the received date plus two calendar days at 17:00 Asia/Kolkata. | Native test of the time rule. |
| Admin-only discounts: one shop-wide percentage and optional per-customer percentages. A customer rule replaces the shop rule. The discount is applied automatically, rounded half up to the paisa, and is part of the reviewed quote. If it changes before saving, the save is refused. A shop-wide discount above 50% needs an extra tick. | Native tests (validation, precedence, rounding, inactive fallback, stale quote refused, rule and rate changes audited). UI tests for the Discounts tab and the order summary. |
| Payment is collected in full at save, with no balance. A 100% discount needs no payment. | Native test. |
| Bill shows subtotal, discount, total and paid. | Native test that the bill payload carries the figures; layout tests that the lines appear. Not seen on paper by the current code. |
| Dashboard: today and month-to-date figures, a 14-day graph, ready-and-waiting (over 2 days) and in-process lists, low-stock count, recent orders. Staff and admin see the same data. | Native tests (shop midnight and month start, attention lists, empty database, legacy rows without pieces) and UI tests against a mocked API. |
| Sales: period presets and custom range, filters (method, status, staff, search), summary, graph with hour, day or month buckets, orders and transactions tables. Time is IST with an exclusive end. Billed leaves out cancelled orders unless included; collected, refunded and cancelled follow their own dates; the graph and the transactions add up to the summary. | Native reconciliation tests (series and transactions against the summary, IST midnight and month rollover, cancelled and voided money, legacy timestamp shapes, pagination, search spellings, scale test with an index check) and UI tests against a mocked API. |
| Customers, Expenses, Inventory, Machines: staff and admin can list, create and edit; only admin can delete, with a reason, one transaction and the old record in the audit trail. A customer with orders (by link or by phone) cannot be deleted; staff cannot change the identity of a customer who has a discount; phone numbers are normalised like the order flow; stock cannot go negative even with simultaneous stock-outs; machine "status" is its maintenance record. | Native tests per record type (role matrix, signed-out, forged and inactive sessions, validation, delete audit, restore-staged write block) and UI tests against a mocked API. |
| Shop settings: admin saves shop identity, optional bill fields, tag branding and cut length (nothing else in the settings table is reachable); any role can read; each change is audited; print choices are copied into each new bill and tag document so reprints match. | Native tests, including unknown-field rejection, `device_id` and backup keys untouched, demoted admin refused inside the write, and bill/tag snapshots surviving reprints. UI tests cover preview, save and validation. |
| One tag per physical piece (one per shoe pair). Piece IDs follow the bill sequence, for example `2600123-3`. Tags show only bill number, garment, service, piece position and ID. | Native tests (IDs, shoe pair, partial reprint positions); layout test of tag content. |
| Packing and pickup checklists are manual ticks. Collection needs status `ready`, zero balance and every piece ticked, in one transaction; a duplicate collection request returns the earlier result. | Native tests (incomplete collection changes nothing, durability across reopen, duplicate request). |
| An admin can cancel an uncollected order with a reason of 3 to 200 characters. Payments are voided and the refund amount and reason are audited; the button is hidden for collected and cancelled orders. | Native test and UI tests. |
| Orders are saved once even if a request is repeated. | Native tests for order, payment, collection and reprint keys. |
| Print documents are validated (bill money must add up), laid out before any spool job exists, and errors found there count as `failed`, not `uncertain`. Tag pages wider than about 4.6 inches are refused; the piece ID never prints below 8 pt; at most 500 tags per document. | Native tests of validation and of the pure layout with a stand-in text measurer (wrapping, pagination, tag shrink and fit, too-small and too-wide pages). The Windows code that calls the layout is type-checked only. |
| Windows printer availability: paused, offline, "Use Printer Offline", paper out or jam, door open and error count as unavailable; busy or printing does not. | Native test of the flag logic. Real driver status has not been seen. |
| A per-printer guard refuses a new job while an earlier submission to the same printer is still running. The deadline is 120 s for a bill and grows by 4 s per tag (cap 30 minutes). A send that exceeds it, or whose worker dies, becomes `uncertain`. A job found `submitting` at start becomes `uncertain`. | Native tests of the guard, the deadline sums and the deadline helper, and of start-up recovery. |
| Retry checks and changes the job state atomically; `uncertain` jobs need an explicit confirmation; an unreadable saved document fails visibly; different printers are required for bills and tags. | Native tests (on macOS, where printing is unsupported, a retried job ends `failed`); UI tests of the two-step confirmation and of ignoring a second tap. |
| A backup is taken soon after start (skipped if one finished in the last 10 minutes) and every four hours while the app runs, on its own thread; the newest 90 are kept; backups are written under a temporary name and renamed once verified, and stale partial files are removed at start. | Native tests (consistent snapshot, retention, partial files, recent-backup skip, clock-went-backwards pruning, background timer with a short test interval). |
| A backup failure is recorded, shown as a message at sign-in, and cleared by the next good backup. | Native test. |
| A second backup folder (for example a USB drive) must be on a different Windows drive from the data. Copies go into a per-computer subfolder `SmartLaundry-backups-<id>` created when the folder is chosen; only that subfolder is pruned; a failed copy is recorded and does not fail the backup. | Native tests of copy, clean-up on failure, error recording, drive-letter comparison, folder naming and folder validation. |
| Before the first upgrade of a version 1 database, a verified `pre-upgrade-v1-*.db` copy is written, never auto-pruned; the upgrade is refused if the copy fails. An empty file from an interrupted first run is set up normally. | Native tests, including refusal, the no-prune rule and the empty file. |
| Restore is staged and applied on restart, with a recovery copy and a journal; invalid files are set aside. | Native tests of staging, applying, interruption recovery and rejection. |
| Restore from Admin > Backups is admin only: the session role is checked before the file is touched and the database role again on the writer connection before staging; the request is audited inside the safety copy; writes are blocked afterwards; a banner stays on every screen until the restart, including after an app restart that has not applied it yet; the confirmation and banner warn that old accounts and PINs, including deactivated staff, come back. | Native tests (staff, signed-out, forged and deactivated-admin sessions refused and nothing staged; admin restore audited, safety backup taken, writes blocked, second restore refused; an unopenable database refuses with its own error; bootstrap reports `restorePending` and the start-up error) and mock-IPC tests. UI tests with a mocked dialog and native API (cancelled chooser, declined confirmation, error, success) and of the banner. The real file dialog and a real restart were not exercised. |
| A forgotten admin PIN is reset from `reset-admin-pin.txt` in the data folder: the file is read and deleted first, then applied once and audited; bad files are deleted with a reason; UTF-8, UTF-8 with BOM and UTF-16 files are accepted; a staged restore stops the reset but the file is still deleted. | Native tests, including an end-to-end start-up test. |
| Only one copy of the app can use a data folder. | Native test. |
| A start-up failure (including the database failing to open) shows the error with a "Try again" button instead of a permanent loading message. | Native test that `counter_bootstrap` returns the database's open error; UI tests. |
| A half-entered order asks for confirmation before Lock, New order or another section discards it; the order screen is locked while a save is running. | UI tests. |
| Schema 002 was changed in place before release. A database made by an earlier development build is rejected by the schema check, with no migration. 001 and 002 are now frozen; a later change must be a 003 with an upgrade step. | Schema comparison is tested in general. I did not find a test that opens such an older version 2 file. |

## What is not verified

| Area | Status |
| --- | --- |
| Running on Windows | **Not done.** No Windows launch, install, upgrade or uninstall. The Windows data folder location, file locking, WebView2 and both NSIS installers (production and review) have not been run. The Linux host has the Rust target but lacks `x86_64-w64-mingw32-gcc`, so its Windows GNU cross-check stops while building bundled SQLite. |
| Windows printing | **Not run.** `EnumPrintersW`, device contexts, `StartDocW`, DEVMODE orientation and page drawing have not executed on Windows. Real Canon and TSC driver behaviour remains unknown. |
| Paper output | **Linux PDF/CUPS review complete; three-tag physical inspection pending.** A fresh synthetic UI order submitted `LBP2900-55` (one A4 landscape page) and `TSC_TE244_Test-56` (one 50×100 mm strip with three 30 mm pitches and one 10 mm trailing feed). Captured PDFs were visually inspected and text/bounds checked; both CUPS queues returned idle after accepting the jobs. Tags contain only bill reference, garment/service, piece position/count and internal ID. The user physically confirmed that one tag with a 10 mm final feed leaves enough cutting room (TSC job 54); the current three-tag strip and bill remain unconfirmed on paper. |
| Remote CI | **Not run for these changes.** CI on the previous commit was red: the Windows job needed `src-tauri/icons/icon.ico`, and the macOS job failed the coverage gate. Local fixes exist, but `src-tauri/icons/` and `src-tauri/tauri.windows.conf.json` are untracked and must be committed. CI runs only on PRs to `main` and pushes to `codex/**`. The Windows job now also builds the production installer, which has never been built. |
| Real OS print outcomes | The `submitted` and `uncertain` results of a real Windows or CUPS submission are not exercised by any test. Paper-out, jam, printer off, or a stuck queue after a job is `submitted` are not seen by the app. |
| Restore on Windows | The restore code does not retry if a file is briefly locked (for example by antivirus); it fails and must be tried again. Not tested on Windows. |
| Real use | No one has used the screens as a shop would: staff speed, readability of the garment pictures, Marathi names rendering in the grid on Windows, long names, a day of real orders. |
| Rate card | Starter prices are unsourced estimates. |
| Time and clock | The ready time depends on the laptop's clock being right. Not tested with a wrong clock. |
| Network | No packet capture. The content security policy and design are offline-only, but absence of network traffic was not measured. |
| Dependencies | No dependency or supply-chain review. |
| Other builds | The browser and Android builds are not covered. |
| Not built | Barcode, QR codes and scanners; public bill links; cloud sync; Devanagari on bills and tags; editing saved orders; refunds as a feature (cancelling voids payments and records what to hand back, nothing more); a configurable ready-time rule. |

## Known limits found while reading the code

These are real behaviours as of this writing. The other documents state them rather than hide them.

1. **Order status can skip steps.** Staff can move an order from any status straight to Ready without the packing checklist. Pickup is the only enforced check.
2. **Restore needs a working database and an admin.** It is Admin > Backups > Restore from backup. If the database cannot be opened at all, nobody can sign in, so there is no restore button; a backup must then be put in place by hand. A restore also brings back the old accounts and PINs, including staff deactivated since that backup; the dialog and a banner say so.
3. **Shop identity on the bill is limited to what Shop settings holds.** Name, address, phone and footer print; GST number, receipt width and completion days no longer exist (the old settings were dead and were not ported). Existing installs start with "Smart Laundry" and "Thank you for choosing us." until the admin edits them. The discount label is not printed.
4. **Copies and darkness remain driver settings.** The app requests landscape A4 for bills and custom 50 mm × selected-length tag media. Set both Windows queues to one copy and confirm the driver accepts those requested media dimensions.
5. **A cancelled order's failed print jobs can still be retried, and its bill reprinted.** Nothing blocks it.
6. **Other backup warnings are still quiet.** The sign-in message covers a failed backup. A failed second-folder copy and the "no backup for more than a day" note appear only on the Admin > Backups tab.
7. **Linux printing uses the shared positioned layout but is a development aid only.** Linux CUPS acceptance does not establish Windows driver behaviour or physical alignment.
8. **Money is stored two ways.** Paise in the new tables, floating-point rupees in the version 1 order and payment tables.
9. **Schema changes need a new migration.** The upgrade code only handles version 0 or 1 to version 2.
10. **Not built in this change:** voiding a single payment, exporting sales to a spreadsheet, soft-delete (undo) for expenses and other deletes, and closing older orders that have no individual pieces (they cannot be collected at the counter).
11. **The restore chooser and confirmation use the operating system's dialog,** which no automated test drives.

## Windows hardware acceptance (release gate)

Do this on the real laptop with the real Canon and TSC, using an installer built by CI or on Windows, and a synthetic data folder. Do not use the production data folder until this passes. Record the commit, the installer file name, both driver versions, the tester and the date at the bottom.

**Install and first start**
- [ ] Install the production Windows installer on a clean Windows 10 or 11 laptop with no internet. Note any SmartScreen warning (the installer is unsigned) and whether WebView2 installs without a network.
- [ ] Launch it. Create the admin. Close and reopen: the admin signs in and the PIN rules hold (4 to 8 digits, wrong PIN refused).
- [ ] Locate the data folder, `laundry.db` and `backups\`. Record the real path for [OPERATIONS.md](OPERATIONS.md). Start a second copy: it must refuse, and the first window must keep working.

**Staff and rules**
- [ ] Create a staff account. Staff sees New order, Orders / Pickup, Print queue, Dashboard, Sales, Customers, Expenses, Inventory and Machines, but no Admin or Shop settings, and cannot reach rates, discounts, printers, staff, backups, restore, shop settings, cancel, or any Delete button.
- [ ] Enter five wrong PINs for the staff account: it locks for five minutes and the message says so. Confirm it unlocks after five minutes, and that Activate or Reset PIN by the admin also unlocks it.
- [ ] As admin, review every starter rate and replace them with the shop's real prices.

**Orders and bill**
- [ ] Take an order with several garments and services including shoes (wash, dry clean). Confirm Iron is unavailable for shoes and the phone number is required in several spellings (`98765 43210`, `+91 98765 43210`).
- [ ] Confirm "Ready by" is received date plus two days at 5:00 PM IST.
- [ ] Set a shop-wide discount (for example 10%) and a different customer discount. Confirm the quote, the printed Subtotal, Discount, Total and Paid lines, and half-up rounding on an awkward amount.
- [ ] Change the discount from another session while an order is open: the save must be refused until the new total is reviewed.
- [ ] Set a 100% discount: the order saves with nothing to collect.
- [ ] As admin, cancel a saved, paid order with a reason: payments show voided, the screen tells you to hand back the money, and the order cannot be collected.

**Printing**
- [ ] Both queues appear in Admin > Printers. Save them. The same queue for both is refused. The Windows default printer is unchanged. Restart the app: both choices are kept.
- [ ] In the Canon driver confirm A4, landscape output and **copies = 1**. In the TSC driver load the 50 mm continuous roll, confirm the app-selected custom length and **copies = 1**. Then print and confirm exactly one bill and one tag per piece come out.
- [ ] Print a bill with many lines and long names: one readable A4 page, margins clear, the rupee sign correct, and a second page headed "(continued)" for a very long bill.
- [ ] Print an order with several pieces including a shoe pair: one continuous 50 mm strip with one pitch per physical piece and a single 10 mm feed after the tag that exits last; correct bill number, garment, service, "Piece n/N" and ID (readable, not tiny); no customer name, date, barcode or QR. Check the 10 mm left start, about 3 mm right clearance, final tail, darkness, and alignment after turning the printer off and on.
- [ ] Set the TSC driver temporarily to a sheet size: the tag job must fail with the "not set to a label size" message and print nothing. Set it back.
- [ ] Save two orders back to back while the printers are still printing. Note whether any job fails with "Printer unavailable" (a printer that is busy should still count as available).
- [ ] Reprint the bill, and reprint two selected tags.

**Dashboard, sales and back office (use synthetic data)**
- [ ] Dashboard: take, pay, ready and collect a few orders (including one cancelled by the admin and one left Ready for more than two days by changing the laptop date or the order's received date in a copy of the data). Check each card, the 14-day graph, both attention lists and the recent-orders list against what you did, and that clicking a bill number opens that order. Check the figures around midnight (IST) and on the first of a month.
- [ ] Sales: for Today, Yesterday, Last 7 days, This month and one Custom range with times, check the summary against the orders you know. Check that Billed leaves out the cancelled order unless included, that its refund shows in the period it was cancelled, that the Transactions table adds up to Collected and Refunded, and that the graph buckets (hour, day, month) add up to the same totals. Try each filter and the staff filter on a day with two staff members. Confirm staff and admin see the same numbers.
- [ ] Customers: add a customer (several phone spellings), find them by name and by number, open their detail and an order from it. Try adding the same name and number twice (refused) and a second person on the same number (allowed). As staff, try to rename a customer who has a discount (refused); as admin it works. As admin, delete a customer with no orders; try to delete one with orders (refused). Confirm staff see no Delete button.
- [ ] Expenses: add expenses on the first and last day of a month and check the range totals include both days. As admin delete one (the box warns that profit changes); confirm Dashboard and Sales profit moved.
- [ ] Inventory: add an item with opening stock and a warn level, stock out below the warn level (low-stock flag on the screen and the Dashboard), try to stock out more than is held (refused), delete the item as admin.
- [ ] Machines: add a machine, record a service with a next due date in the past (marked due), delete as admin. Confirm staff cannot delete.
- [ ] Shop settings: as admin change the shop name, optional bill fields, footer, tag branding and cut length, then print a bill and several tags. Confirm the preview matches output and a reprint retains its original content. Confirm staff cannot open Shop settings.

**Print failures and recovery**
- [ ] Open the printer cover or remove paper before saving an order. Record the job state the app shows and what Windows shows. Fix it and retry. Confirm no duplicate tags.
- [ ] Switch a queue to "Use Printer Offline" and save an order: the printer should show as unavailable and the job should fail, not be lost in the queue. Switch it back.
- [ ] Unplug the TSC while a job is in the Windows queue. Confirm what the app says, then recover.
- [ ] Make a job `uncertain` (for example end the app's task during a send). Restart: the job is `uncertain` and the screen steers tag jobs to "Reprint selected tags". Confirm that sending it again needs the two-step confirmation and that the Windows queue was checked first.
- [ ] Switch off the laptop's power (or use "end task") in the middle of printing a multi-tag order, then restart. Record which tags came out, what state the job shows, and that "Reprint selected tags" fixes it without duplicating.
- [ ] Put a document into the Windows queue and let it stick. Record how it looks in the app and what the operator must do.

**Pickup**
- [ ] Take an order to Ready. Open pickup, tick all but one piece: collection must be refused. Tick all: the order becomes collected. A collected order cannot be collected again or cancelled.

**Backups and restore**
- [ ] Confirm a backup appears shortly after start and "Back up now" adds one. Leave the app open for more than four hours and confirm a periodic backup appears. Restart twice within ten minutes: only one new backup.
- [ ] Set a USB folder (for example `E:\Laundry backups`). A folder on `C:` must be refused. Confirm the subfolder `SmartLaundry-backups-...` appears and each backup is copied into it. Unplug the drive: the next backup shows the second-folder failure on the Backups tab. Plug it in again: the next backup shows "ok". Swap in a different USB stick on the same letter: nothing may be written to it.
- [ ] Make a backup fail (for example fill the disk or make the backups folder read-only) and confirm the sign-in message appears, then clears after a good backup.
- [ ] Restore a backup from Admin > Backups > Restore from backup. Confirm the file chooser and confirmation box appear and the confirmation mentions accounts and PINs. Confirm writes stop after staging, the yellow banner shows on every screen (also after locking), the data comes back after restart, and `laundry-recovery-*.db` exists. Deactivate a staff member after taking a backup, restore that backup, and confirm that staff member can sign in again. Try a non-database file: it is refused. Sign in as staff: no restore button. Note whether antivirus ever blocks the restore (there is no retry).
- [ ] Restore from a copy kept on the USB drive.

**Forgotten PIN**
- [ ] Create `reset-admin-pin.txt` in the data folder using Notepad (check it is not `reset-admin-pin.txt.txt`), once saved as plain text and once as "Unicode", put a new PIN in it, and start the app. The admin signs in with the new PIN, the file is gone, and the message says it was reset. Repeat with a bad PIN: the file is deleted and the message says why.

**Upgrade**
- [ ] Install a newer build over this one. Data, rates, staff and printers are kept. Confirm an older installer is refused.

**Soak**
- [ ] Use it for a normal working day on synthetic orders, with sleep and resume, a restart of Windows, and a printer restart, and record any failure.

| Field | Value |
| --- | --- |
| Commit and installer |  |
| Canon driver version |  |
| TSC driver version |  |
| Tester and date |  |
| Result |  |
