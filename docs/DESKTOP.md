# Desktop app: architecture and development

Smart Laundry POS Desktop is a Tauri 2 app: a Rust native layer with a SQLite database, and a React user interface in a webview. It runs offline and keeps all records on one computer. It uses no server account and does not sync anywhere. (An earlier browser/PWA version of the POS was removed from this repository; it survives only in the git history.)

The target installation is one Windows laptop in a shop with a Canon laser printer (A4 bills) and a TSC TE244 label printer (50 mm tags). Linux and macOS are development platforms only. See [DESKTOP_ACCEPTANCE.md](DESKTOP_ACCEPTANCE.md) for what has and has not been verified, [OPERATIONS.md](OPERATIONS.md) for the shop owner's guide, and [PRINTING_WINDOWS.md](PRINTING_WINDOWS.md) for printers.

## Layers

| Layer | Where | Responsibility |
| --- | --- | --- |
| Entry | `src/desktop.tsx`, `src/pages/LocalFirstApp.tsx` | Mounts the one workspace, `CounterApp`. There is no second interface. |
| Workspace UI | `src/components/localCounter/` | `CounterApp.tsx` is the shell (sign-in, role-filtered navigation, the New order screen and the order, pickup and print screens). `sections.ts` is the registry of sections and which role may open each; the section screens are `DashboardPage`, `SalesPage`, `CustomersPage`, `ExpensesPage`, `InventoryPage`, `MachinesPage` and `ShopSettingsPage`, plus `CounterAdmin` (rate card, discounts, staff, printers, backups and restore). Shared pieces are in `ui.tsx`. |
| Native API wrappers | `src/lib/localFirst/counter.ts`, `office.ts`, `insights.ts`, `shopSettings.ts` | Typed wrappers over the native `counter_*` commands. The UI never sends prices, discounts, roles or SQL. `commands.guard.test.ts` fails if a registered command has no wrapper, a wrapper calls an unregistered command, or any registered command is not named `counter_*`. |
| Native commands | `src-tauri/src/lib.rs` | Registers the Tauri commands, runs start-up (recover interrupted prints, apply the admin PIN reset file) and starts the backup thread. Every registered command is a `counter_*` command. |
| Business rules | `src-tauri/src/counter.rs` | Accounts and roles, rate card, discounts, quoting, order save, cancel, pieces, collection, print job state, backup settings, backup restore, PIN reset file. Every command checks the signed-in role here. |
| Back office | `src-tauri/src/office.rs` | Customers, expenses, inventory and machines: list, create, edit and (admin only) delete, with audit rows. |
| Insights | `src-tauri/src/insights.rs` | Dashboard overview, sales summary, sales graph series, order list and payment (transaction) list, all read-only. |
| Shop settings | `src-tauri/src/shop_settings.rs` | Shop identity, bill/tag content choices and tag cut length; snapshots the print options into each new order. |
| Storage | `src-tauri/src/storage.rs` | SQLite via `sqlx` (one writer connection, four read-only connections), single-instance lock, schema checks, backup, staged restore. |
| Printing | `src-tauri/src/printing.rs`, `src-tauri/src/print_layout.rs` | Document model and validation, Windows GDI and Linux CUPS adapters, and the pure page layout. Details in [PRINTING_WINDOWS.md](PRINTING_WINDOWS.md). |
| Schema | `src-tauri/migrations/001_initial_schema.sql` to `004_advance_daily_tags.sql` | Version 1 is the original local-first schema. Version 2 adds the counter domain and the starter rate card. Version 3 is data only: it adds the Coat / Blazer and Gents Kurta Pyjama garments and loads the shop's default prices without touching any price an owner has changed. Version 4 (the latest) adds advance payments, daily bill numbers and piece tags: each payment is marked as an advance or a settlement (existing payments taken when their order was received become advances), each piece is marked as tagged or not, and a per-day counter for bill numbers is added. |

### Rules the native layer enforces

- The signed-in account lives in native memory (`CounterSession`), not in the webview. Locking clears it.
- Roles are `admin` and `staff`. Only an active admin can set rates, set discounts, manage staff accounts, choose printers, change backup settings, back up now or restore a backup, change the shop settings, cancel an order, or delete any record. Everything else is open to both roles. The deletes, shop settings save and restore re-check against the database, inside the write transaction, that the account is still an active admin (`require_admin_in_tx`), so a stale or forged session claiming "admin" is refused. The older admin writes check the session role only (see Security boundary).
- There are no raw SQL commands. The UI can only reach the database through the `counter_*` commands, each of which validates its own input.
- PINs are 4 to 8 digits. Five wrong PINs lock that account for five minutes. Switching a staff account back on, resetting a staff PIN, or the admin PIN reset file also clears the lock. PINs are stored as a salted SHA-256 hash iterated 150,000 times, with a one-time upgrade from the older single-round hash on first login. A 4 to 8 digit PIN protects the screen, not the data: the database file is not encrypted.
- Prices come from the rate card (garment by service, integer paise, at most Rs 10,000 per rate). Any signed-in user may charge a different unit price on one line of one bill (`unitPriceOverrideMinor`, 0 to Rs 10,000); the quote carries both `unitPriceMinor` and `listPriceMinor`, the rate card is unchanged, and an `order_price_changed` audit row records the old and new price. Staff can mark a bill for the trash (`counter_request_order_trash`); only an admin lists, approves (`counter_trash_order`) or dismisses (`counter_dismiss_trash_request`) requests. Starch is the service row with key `wash_iron` (the schema CHECK allows no new key). A line quantity is 1 to 200. An order has at most 100 lines, 500 pieces, and a total under Rs 10,00,000. Shoes are billed per pair and are washed only (the other services are not offered for shoes).
- Ready time is the received date (Asia/Kolkata) plus two calendar days at 17:00, with no configuration.
- The customer phone number is required. It is normalised to 10 digits (digits in Indian scripts, spaces, dashes, a leading +91, 91 or 0 are accepted). A returning customer is matched on phone and name together, so two people sharing a phone number do not share a discount or history. Order search accepts any spelling of a number, treats `%` and `_` literally, ignores a one-character query, and lists the newest orders for an empty query.
- Discounts are a percentage stored in basis points. A customer's active rule replaces the shop-wide active rule. The discount is resolved when the order is quoted, bound into the quote, and re-checked at save. If rates, discount, availability or ready time changed after the quote was shown, the save is refused so the staff member reviews the new total.
- Payment is taken in full when the order is saved. A fully discounted order (total 0) is saved with no payment. The native code rejects a short, excess or missing payment.
- Order save, payment, collection and reprint requests carry a client-generated key. Repeating the same request returns the saved result instead of creating a second one, including when two copies race (collection re-checks the key inside its transaction). The same key with different contents is refused.
- Collection is one transaction: the order must be `ready`, the balance must be zero (it can be paid in the same transaction), and every piece must be ticked.
- Cancelling (admin only, reason of 3 to 200 characters) works on any order that is not collected or already cancelled. It marks the order cancelled, voids its payments (the owner hands the money back), marks unsent print jobs failed, and writes an audit row with the reason, previous status and refund amount. Nothing stops an already-failed job of a cancelled order being retried, or its bill being reprinted.
- Rate changes, discount changes and cancellations write audit rows that include the old and new values.
- The order, its pieces, its payment and its two print jobs (bill and tags) are written in one transaction before any printing starts.
- Print job retry checks and changes the job's state in one transaction, so a double click cannot queue the same output twice. A saved print document that cannot be read is marked failed instead of staying claimed. Printers for bills and tags must be different queues.

### Role matrix

| Area | Staff | Admin |
| --- | --- | --- |
| New order, Orders / Pickup, Print queue (take orders, record payment, move status, collect, reprint) | Yes | Yes |
| Cancel an order (reason 3 to 200 characters) | No | Yes |
| Dashboard and Sales (all figures, the same for both roles) | Yes | Yes |
| Customers, Expenses, Inventory, Machines: view, create, edit; adjust stock; record a machine's maintenance | Yes | Yes |
| Delete a customer, expense, inventory item or machine (reason 3 to 200 characters, audited) | No | Yes |
| Rate card, discounts, staff accounts, printer choice | No | Yes |
| Backups: status, back up now, second folder, restore | No | Yes |
| Shop settings: read | Yes (the bill needs the shop name) | Yes |
| Shop settings: save | No | Yes |
| Edit a customer's name or phone when that customer has a discount rule | No | Yes |

Orders are never hard-deleted, so bill numbers, pieces and the audit trail stay traceable; cancelling is the admin's way to remove an order. Every delete is one transaction and writes the full old record to the audit table. A customer who has orders cannot be deleted (checked by customer id and by phone inside the same transaction).

### Money storage

New counter data uses integer paise (`price_minor`, `unit_price_minor`, `line_total_minor`). The version 1 tables that orders and payments still use (`orders.total_amount`, `payments.amount`) store rupees as floating point numbers, so the native code converts with rounding when it reads them. This works for the amounts the counter produces, but it is two representations of money in one database.

### Schema is frozen

Version 2 was changed in place during development, so a database written by an earlier development build of version 2 is rejected by the schema check, with no migration. Treat `001`, `002` and `003` as frozen, and `004` as the latest step: any later change must ship as a new numbered migration. `storage.rs` keeps every step in one `MIGRATION_STEPS` list (version number, SQL, name). `initialize_schema` runs the missing steps in order inside one transaction, then records `SCHEMA_VERSION`, which must equal the last step's number (a unit test checks this). It takes version 0 (new), 1, 2 or 3 up to the current version.

### One interface, no raw SQL

An earlier version had a second, blue "full admin workspace" that talked to SQLite through a raw SQL bridge (`local_select`, `local_read_batch`, `local_batch`) and was not bound by the counter's rules (payment in full, discount rules, rate card). It, the bridge commands, `backup_database` and `restore_database`, and the frontend modules behind them (`repository`, `db`, `startup`, `security`, `domain`, `types`, `backup`) were removed. Its useful screens were rebuilt as sections of the one workspace on top of role-checked native commands: Dashboard, Sales, Customers, Expenses, Inventory, Machines and Shop settings. The old services screen is replaced by the rate card, and the old PIN login by the counter accounts. The dead settings it had (GST number, receipt width, default completion days) were not carried over.

The `SqlStatement` helpers and `DatabaseState::local_select`, `local_read_batch` and `local_batch` still exist in `storage.rs`, but only under `#[cfg(test)]`, as fixtures for the storage tests. They are not compiled into the app and are not reachable from the UI. The read-only connection pool they use is likewise only exercised by tests today.

The office tables (`customers`, `expenses`, `inventory_items`, `inventory_transactions`, `machines`, `app_settings`) are the version 1 tables. They store money as rupees (floating point); the native code converts to paise at the API edge.

### Bill header and shop settings

Admin > Shop settings edits shop name, address, phone, receipt message and multiline footer, bill number prefix (1 to 6 letters or digits, upper-cased, no hyphen), six optional bill-field toggles, optional tag branding and a 30–200 mm tag pitch. Only the 15 editable keys can be read or written through the screen; `device_id` and backup bookkeeping keys in the same table are not reachable. A save changes only the keys that differ and writes one audit row with the old and new values.

The bill header, optional message/footer and visible-field choices, plus tag branding and pitch, are copied into each new print document when the order is saved, so reprints match the original. Old bill documents default to their legacy visible fields; old tag documents default to no branding and a 101.6 mm pitch. New installations default to a configurable 30 mm tag pitch. New bills use a centered configurable header and an A4 landscape positioned layout with a full-width item table. Linux renders that shared layout to PDF for CUPS; Windows requests landscape A4 through the Canon driver. On the 50 mm TSC strip, tag text starts 10 mm from the left edge with about 3 mm right clearance. A batch adds one 10 mm trailing feed after its physical final tag, not after every tag.

## Data on disk

The data folder comes from Tauri's `app_config_dir()` for the identifier in `src-tauri/tauri.conf.json` (`com.smartlaundry.pos`; review builds use `com.smartlaundry.pos.review` and a separate folder). The Admin > Backups screen shows the exact backups path. The data folder is the folder above it.

| Item | Purpose |
| --- | --- |
| `laundry.db` | The database (SQLite, write-ahead log mode, so `-wal` and `-shm` files appear beside it while the app runs). |
| `laundry.lock` | Single-instance lock. A second copy of the app on the same data folder is refused. |
| `backups/laundry-*.db` | Automatic and manual backups. The newest 90 are kept. |
| `backups/*.partial` | A backup being written. Removed at the next start if a crash left one. |
| `backups/laundry-recovery-*.db` | Copy of the live database taken just before a staged restore is applied. Not pruned by the 90-file limit. |
| `backups/pre-upgrade-v<N>-*.db` | Verified copy of a version N database taken before it was upgraded (v1, v2 and v3 databases each get one). Not pruned. |
| `laundry.restore.pending.db`, `laundry.restore.apply.json` | A staged restore and its recovery journal. Present only between staging and the next start. |
| `restore-rejected-*.db` | A staged restore that failed validation, kept for inspection. |
| `reset-admin-pin.txt` | Optional, created by a person to reset the admin PIN. Read and deleted at the next start. |

## Backups, upgrade and restore

- A backup runs on its own thread, so a slow or unplugged second drive cannot delay the window. It runs soon after start (skipped if one finished in the last 10 minutes, so a crash loop cannot push real history out) and then every four hours while the app stays open. It is skipped when the database failed to open or a restore is staged.
- A backup uses SQLite `VACUUM INTO`, is written under a `.partial` name, synced, validated as a database, and only then renamed. A truncated file therefore never looks like the latest backup. Old files beyond 90 are removed afterwards, and pruning never removes the backup just written and never fails it.
- Each backup records its time. A failure is recorded and shown as a message after sign-in ("The last automatic backup failed: ..."); the next good backup clears it. The Backups tab also warns when the last backup is more than a day old.
- An optional second folder (for example a USB drive) must be an absolute path to an existing, writable folder outside the data folder and, on Windows, not on the same drive letter as the data folder. Choosing it creates a subfolder `SmartLaundry-backups-<first 8 characters of this computer's id>`. Every backup is copied into that subfolder (written as `.partial`, size-checked, renamed), and only that subfolder is pruned (newest 90 `laundry-*.db`). If the subfolder is missing at backup time the copy fails and is recorded; it is never recreated, so a different USB stick that took over the same drive letter is not written to. A failed copy is recorded and does not fail the backup.
- Before any upgrade of an existing database to a newer schema version (including a data-only one such as version 3), a verified `pre-upgrade-v<N>-*.db` copy of the version it holds is written to `backups/`. The copy is itself checked against the contract of its own version, so it is a real, restorable database of that version. If that copy cannot be made and verified, the upgrade is refused and the database is left as it was. A brand-new database, or an empty file left by an interrupted first run, is set up normally with no such copy.
- Schema checks compare the database object by object against the expected schema for the version the file records. That expected schema is built in memory by running the migration steps up to that version, so a version 2 or 3 file is checked without the version 4 tables, and a version 4 file with them. A file recording a version above the current one is refused, unchanged, with an "unsupported schema version" message.
- Restore is staged, then applied on the next start. It is done from Admin > Backups > Restore from backup (the file chooser filters on `.db`, then a confirmation dialog warns what will happen), through the admin-only `counter_restore_backup` command. The session role is checked before the file is touched, and the database is asked again on the writer connection (still an active admin) immediately before staging; that same step writes a `restore_requested` audit row, so the row is inside the safety copy that is taken next. A non-admin, a forged session or a deactivated admin stages nothing. Staging validates integrity, foreign keys, schema and version of the chosen file and takes a normal backup of the current data. After staging the app refuses writes until restarted, and the app shows a banner on every screen (the sign-in screen included) saying so. The banner is driven by `restorePending` in the `counter_bootstrap` result, which is true whenever a staged restore file exists, so it also appears after an app restart that has not yet applied it. A restore brings back the accounts and PINs of the backup, including staff who were deactivated after it was made, and the banner and the confirmation dialog say so. The audit rows written after the backup are lost with the rest of the later data. There is no restore path when the database itself will not open, because there is then no signed-in admin to authorize it (the start-up screen shows the error); recover by copying a backup over the data folder by hand, as described in OPERATIONS.md. At start the app takes `laundry-recovery-*.db`, moves the original aside, installs the replacement, and keeps a journal so an interrupted application can be recovered. If a staged file is invalid at start, it is kept under a `restore-rejected-` name and the original database opens with a warning. The Windows restore code does not retry if a file is briefly locked (for example by antivirus); it fails and the operator can try again.
- Admin PIN reset file: at start, `reset-admin-pin.txt` in the data folder is read and deleted first, and only then applied once and audited, so a leftover file can never re-apply an old PIN. If it cannot be deleted it is not applied. Rejected files (bad PIN, no admin, unreadable text, a pending restore blocking writes) are deleted too, so no PIN stays on disk, and the start-up message says why. UTF-8, UTF-8 with a byte-order mark, and UTF-16 (what Notepad's Unicode option and PowerShell produce) are accepted. The reset also re-activates the admin and clears any lock. It adds no access beyond what file access already gives, since the database is not encrypted.

## Security boundary

The webview can only call the registered `counter_*` commands. Each one checks the session role itself and validates its input; every admin write (rates, discounts, staff, printers, backup folder, cancel order, deletes, shop settings, restore) also re-checks the role against the database inside its transaction. There is no command that runs caller-supplied SQL. The content security policy allows local assets and Tauri IPC only. The window capability (`src-tauri/capabilities/default.json`) grants default core permissions, webview printing, and the dialog plugin (`dialog:default`, `dialog:allow-open`), used by the restore file chooser and confirmation. I did not review whether `core:webview:allow-print` is still needed now that the older workspace is gone. The database file is not encrypted, so none of this protects against someone with access to the computer's files.

## Development commands

```sh
npm ci                          # install locked dependencies
npm run tauri:dev               # run the desktop app (starts the Vite entry on 127.0.0.1:8080)
npm run build                   # build the frontend into dist-desktop/
npm test                        # JavaScript tests
npm run test:coverage           # same tests with a 100% coverage gate
npm run lint                    # eslint on the desktop entry, local-first code and counter components
npm run typecheck               # tsc with tsconfig.desktop.json

cd src-tauri
cargo fmt --all -- --check
cargo test
cargo clippy --all-targets -- -D warnings
```

Running only the Vite server in a normal browser does not give you the native runtime, so the counter cannot work there. The coverage gate covers the JavaScript desktop code only; Rust coverage is not measured by any gate (use `cargo llvm-cov` if installed).

Native tests use throwaway SQLite databases in the temporary directory. Role checks, delete rules, audit rows and the Sales time-zone and reconciliation rules are tested in `counter.rs`, `office.rs`, `insights/tests.rs` and `shop_settings.rs`; `app_tests.rs` checks over mock IPC that the retired SQL and unguarded backup commands are not registered. The code that actually talks to the operating system's printing (the Windows GDI calls, `lp`) cannot run in tests. Everything around it is tested: validation, layout with a stand-in text measurer, the deadline helper, printer availability flags, the per-printer guard, and the job state handling up to the point of the OS call (on macOS the call reports "not supported", so those tests see `failed`). The `submitted` and `uncertain` outcomes of a real OS submission are not exercised. See [DESKTOP_ACCEPTANCE.md](DESKTOP_ACCEPTANCE.md).

## Packaging

| Target | Command | Notes |
| --- | --- | --- |
| Windows installer (NSIS) | `npm run tauri:build:windows` on Windows | Uses `src-tauri/tauri.windows.conf.json`: identifier `com.smartlaundry.pos`, per-user install, bundled WebView2 offline installer, downgrades refused. Unsigned. Not yet built or run by me. The script and the config file are uncommitted at the time of writing. |
| Windows review installer | `npm run tauri:build:windows-review` | Identifier `com.smartlaundry.pos.review`, per-machine install, separate data folder. |
| macOS review app | `npm run tauri:build -- --config src-tauri/tauri.review.conf.json` | Ad-hoc signed, not notarized, arm64 on Apple Silicon. For development. |
| Ubuntu review package | `npm run tauri:build:linux-review` | Needs the [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux). Produces a `.deb`. |

Review builds use their own identifier and therefore their own data folder, so they do not touch a shop's real database. Check the identifier before launching any build on a computer that holds real data.

The default `tauri.conf.json` still lists `app` and `dmg` bundle targets with an ad-hoc macOS signing identity. This is a local review setup. Distributing a macOS build would need Developer ID signing and notarization, which is out of scope for the Windows target.

**Releasing an update.** Bump the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json` together. The Windows installer compares versions and refuses an older one over a newer one (`allowDowngrades: false`). Never change the identifier `com.smartlaundry.pos`, because it names the data folder. Any data change needs a new numbered migration file in `src-tauri/migrations/`, a `MIGRATION_Vn_SQL` constant and an entry in the `MIGRATION_STEPS` list in `src-tauri/src/storage.rs`, and a raised `SCHEMA_VERSION` (the last step's number). Migration `003` is data-only, so the schema contract is unchanged; `004` added tables and columns, so the contract covers them. A migration that changes tables, columns or indexes must also update the schema contract in `storage.rs`.

## Continuous integration

`.github/workflows/desktop.yml` runs only on pull requests to `main` and on pushes to `codex/**` branches. A push to any other branch (such as `claude/**`) does not start it until a pull request exists. It has three jobs:

- `desktop` (macOS): `npm ci`, coverage gate, lint, typecheck, frontend build, `cargo fmt --check`, `cargo test`, `cargo clippy -D warnings`, review app build and signature check.
- `linux-package` (Ubuntu 24.04): builds the review `.deb` and uploads it.
- `windows-package` (Windows 2022): desktop JavaScript tests, `cargo check`, `cargo test` and `cargo clippy` on Windows, then builds and uploads both the production installer (`smart-laundry-pos-windows`) and the review installer (`smart-laundry-pos-windows-review`). Neither is signed.

The Windows job is the first place the native code and the Windows printing adapter are compiled and the native tests are run on Windows. As of this writing it has not run against the current changes. The result is recorded in [DESKTOP_ACCEPTANCE.md](DESKTOP_ACCEPTANCE.md).
