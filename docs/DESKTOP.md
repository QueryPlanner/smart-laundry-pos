# Desktop app: architecture and development

Smart Laundry POS Desktop is a Tauri 2 app: a Rust native layer with a SQLite database, and a React user interface in a webview. It runs offline and keeps all records on one computer. It does not use the web app's Supabase account and does not sync anywhere. The browser and Android builds of this repository keep their own entries and are not covered here.

The target installation is one Windows laptop in a shop with a Canon laser printer (A4 bills) and a TSC TE244 label printer (50 mm tags). Linux and macOS are development platforms only. See [DESKTOP_ACCEPTANCE.md](DESKTOP_ACCEPTANCE.md) for what has and has not been verified, [OPERATIONS.md](OPERATIONS.md) for the shop owner's guide, and [PRINTING_WINDOWS.md](PRINTING_WINDOWS.md) for printers.

## Layers

| Layer | Where | Responsibility |
| --- | --- | --- |
| Entry | `src/desktop.tsx`, `src/pages/LocalFirstApp.tsx` | Mounts the counter. Admins can also open the older admin workspace from the Admin screen. |
| Counter UI | `src/components/localCounter/` | Login, garment grid, order summary, orders and pickup, cancel order (admin), print queue and progress, and the Admin tabs (rate card, discounts, staff, printers, backups). |
| Counter API | `src/lib/localFirst/counter.ts` | Typed wrappers over the native `counter_*` commands. The UI never sends prices, discounts, roles or SQL for counter work. |
| Native commands | `src-tauri/src/lib.rs` | Registers the Tauri commands, runs start-up (recover interrupted prints, apply the admin PIN reset file) and starts the backup thread. |
| Business rules | `src-tauri/src/counter.rs` | Accounts and roles, rate card, discounts, quoting, order save, cancel, pieces, collection, print job state, backup settings, PIN reset file. Every command checks the signed-in role here. |
| Storage | `src-tauri/src/storage.rs` | SQLite via `sqlx` (one writer connection, four read-only connections), single-instance lock, schema checks, backup, staged restore. |
| Printing | `src-tauri/src/printing.rs`, `src-tauri/src/print_layout.rs` | Document model and validation, Windows GDI and Linux CUPS adapters, and the pure page layout. Details in [PRINTING_WINDOWS.md](PRINTING_WINDOWS.md). |
| Schema | `src-tauri/migrations/001_initial_schema.sql`, `002_counter_domain.sql` | Version 1 is the original local-first schema. Version 2 adds the counter domain and the starter rate card. |

### Rules the native layer enforces

- The signed-in account lives in native memory (`CounterSession`), not in the webview. Locking clears it. Leaving the older admin workspace also locks it.
- Roles are `admin` and `staff`. Rates, discounts, staff accounts, printers, backup settings, cancelling an order, and all direct SQL commands (`local_select`, `local_read_batch`, `local_batch`, `backup_database`, `restore_database`) require an active admin.
- PINs are 4 to 8 digits. Five wrong PINs lock that account for five minutes. Switching a staff account back on, resetting a staff PIN, or the admin PIN reset file also clears the lock. PINs are stored as a salted SHA-256 hash iterated 150,000 times, with a one-time upgrade from the older single-round hash on first login. A 4 to 8 digit PIN protects the screen, not the data: the database file is not encrypted.
- Prices come only from the rate card (garment by service, integer paise, at most Rs 10,000 per rate). A line quantity is 1 to 200. An order has at most 100 lines, 500 pieces, and a total under Rs 10,00,000. Shoes are billed per pair and cannot be ironed (Iron and Wash + Iron are refused for shoes).
- Ready time is the received date (Asia/Kolkata) plus two calendar days at 17:00, with no configuration.
- The customer phone number is required. It is normalised to 10 digits (digits in Indian scripts, spaces, dashes, a leading +91, 91 or 0 are accepted). A returning customer is matched on phone and name together, so two people sharing a phone number do not share a discount or history. Order search accepts any spelling of a number, treats `%` and `_` literally, ignores a one-character query, and lists the newest orders for an empty query.
- Discounts are a percentage stored in basis points. A customer's active rule replaces the shop-wide active rule. The discount is resolved when the order is quoted, bound into the quote, and re-checked at save. If rates, discount, availability or ready time changed after the quote was shown, the save is refused so the staff member reviews the new total.
- Payment is taken in full when the order is saved. A fully discounted order (total 0) is saved with no payment. The native code rejects a short, excess or missing payment.
- Order save, payment, collection and reprint requests carry a client-generated key. Repeating the same request returns the saved result instead of creating a second one, including when two copies race (collection re-checks the key inside its transaction). The same key with different contents is refused.
- Collection is one transaction: the order must be `ready`, the balance must be zero, and every piece must be ticked.
- Cancelling (admin only, reason of 3 to 200 characters) works on any order that is not collected or already cancelled. It marks the order cancelled, voids its payments (the owner hands the money back), marks unsent print jobs failed, and writes an audit row with the reason, previous status and refund amount. Nothing stops an already-failed job of a cancelled order being retried, or its bill being reprinted.
- Rate changes, discount changes and cancellations write audit rows that include the old and new values.
- The order, its pieces, its payment and its two print jobs (bill and tags) are written in one transaction before any printing starts.
- Print job retry checks and changes the job's state in one transaction, so a double click cannot queue the same output twice. A saved print document that cannot be read is marked failed instead of staying claimed. Printers for bills and tags must be different queues.

### Money storage

New counter data uses integer paise (`price_minor`, `unit_price_minor`, `line_total_minor`). The version 1 tables that orders and payments still use (`orders.total_amount`, `payments.amount`) store rupees as floating point numbers, so the native code converts with rounding when it reads them. This works for the amounts the counter produces, but it is two representations of money in one database.

### Schema is frozen

Version 2 was changed in place during development, so a database written by an earlier development build of version 2 is rejected by the schema check, with no migration. From now on treat `001` and `002` as frozen: any later schema change must ship as a new migration (`003`) with its own upgrade step. The upgrade code in `storage.rs` only knows how to take version 0 or 1 to version 2 today.

### The older admin workspace

An admin can open the "full admin workspace" from the Admin screen (it asks first if an order is half-entered). It is the earlier local-first screen (dashboard, customers, services, payments, expenses, inventory, machines, reports, settings). It talks to the database through the SQL bridge, so it is not bound by the counter's rules (full payment, discount rules, ready time). The counter bill and ready time do not read its shop name, receipt width or completion-days settings. The restore screen lives only there. I did not audit everything this workspace can change.

## Data on disk

The data folder comes from Tauri's `app_config_dir()` for the identifier in `src-tauri/tauri.conf.json` (`com.smartlaundry.pos`; review builds use `com.smartlaundry.pos.review` and a separate folder). The Admin > Backups screen shows the exact backups path. The data folder is the folder above it.

| Item | Purpose |
| --- | --- |
| `laundry.db` | The database (SQLite, write-ahead log mode, so `-wal` and `-shm` files appear beside it while the app runs). |
| `laundry.lock` | Single-instance lock. A second copy of the app on the same data folder is refused. |
| `backups/laundry-*.db` | Automatic and manual backups. The newest 90 are kept. |
| `backups/*.partial` | A backup being written. Removed at the next start if a crash left one. |
| `backups/laundry-recovery-*.db` | Copy of the live database taken just before a staged restore is applied. Not pruned by the 90-file limit. |
| `backups/pre-upgrade-v1-*.db` | Verified copy of a version 1 database taken before its first upgrade. Not pruned. |
| `laundry.restore.pending.db`, `laundry.restore.apply.json` | A staged restore and its recovery journal. Present only between staging and the next start. |
| `restore-rejected-*.db` | A staged restore that failed validation, kept for inspection. |
| `reset-admin-pin.txt` | Optional, created by a person to reset the admin PIN. Read and deleted at the next start. |

## Backups, upgrade and restore

- A backup runs on its own thread, so a slow or unplugged second drive cannot delay the window. It runs soon after start (skipped if one finished in the last 10 minutes, so a crash loop cannot push real history out) and then every four hours while the app stays open. It is skipped when the database failed to open or a restore is staged.
- A backup uses SQLite `VACUUM INTO`, is written under a `.partial` name, synced, validated as a database, and only then renamed. A truncated file therefore never looks like the latest backup. Old files beyond 90 are removed afterwards, and pruning never removes the backup just written and never fails it.
- Each backup records its time. A failure is recorded and shown as a message after sign-in ("The last automatic backup failed: ..."); the next good backup clears it. The Backups tab also warns when the last backup is more than a day old.
- An optional second folder (for example a USB drive) must be an absolute path to an existing, writable folder outside the data folder and, on Windows, not on the same drive letter as the data folder. Choosing it creates a subfolder `SmartLaundry-backups-<first 8 characters of this computer's id>`. Every backup is copied into that subfolder (written as `.partial`, size-checked, renamed), and only that subfolder is pruned (newest 90 `laundry-*.db`). If the subfolder is missing at backup time the copy fails and is recorded; it is never recreated, so a different USB stick that took over the same drive letter is not written to. A failed copy is recorded and does not fail the backup.
- Before the first upgrade of an existing version 1 database, a verified `pre-upgrade-v1-*.db` copy is written to `backups/`. If that copy cannot be made and verified, the upgrade is refused and the database is left as it was. A brand-new database, or an empty file left by an interrupted first run, is set up normally with no such copy.
- Schema checks compare the live database object by object against the expected schema (an in-memory database built from the two migrations).
- Restore is staged, then applied on the next start. Staging validates integrity, foreign keys, schema and version of the chosen file and takes a normal backup of the current data. After staging the app refuses writes until restarted. At start the app takes `laundry-recovery-*.db`, moves the original aside, installs the replacement, and keeps a journal so an interrupted application can be recovered. If a staged file is invalid at start, it is kept under a `restore-rejected-` name and the original database opens with a warning. The Windows restore code does not retry if a file is briefly locked (for example by antivirus); it fails and the operator can try again.
- Admin PIN reset file: at start, `reset-admin-pin.txt` in the data folder is read and deleted first, and only then applied once and audited, so a leftover file can never re-apply an old PIN. If it cannot be deleted it is not applied. Rejected files (bad PIN, no admin, unreadable text, a pending restore blocking writes) are deleted too, so no PIN stays on disk, and the start-up message says why. UTF-8, UTF-8 with a byte-order mark, and UTF-16 (what Notepad's Unicode option and PowerShell produce) are accepted. The reset also re-activates the admin and clears any lock. It adds no access beyond what file access already gives, since the database is not encrypted.

## Security boundary

The bundled UI is trusted. The SQL bridge rejects multiple statements, transaction control and schema changes, reads use a read-only connection, and all of it needs an admin session. It does not authorize individual tables. The content security policy allows local assets and Tauri IPC only. Adding remote pages, renderer plugins or untrusted scripts would mean replacing the bridge with narrower commands first. The window capability grants default core permissions, webview printing (used by the older workspace), and the file-open dialog (used for restore).

## Development commands

```sh
npm ci                          # install locked dependencies
npm run tauri:dev               # run the desktop app (starts the Vite entry on 127.0.0.1:8080)
npm run build:desktop           # build the frontend into dist-desktop/
npm test                        # full JavaScript test run
npm run test:desktop            # desktop JavaScript tests only
npm run test:desktop:coverage   # same tests with a 100% coverage gate
npm run lint:desktop            # eslint on the desktop entry, local-first code and counter components
npm run typecheck:desktop       # tsc with tsconfig.desktop.json
npm run build                   # legacy web build, to check it still compiles

cd src-tauri
cargo fmt --all -- --check
cargo test
cargo clippy --all-targets -- -D warnings
```

Running only the Vite server in a normal browser does not give you the native runtime, so the counter cannot work there. The coverage gate covers the JavaScript desktop code only; Rust coverage is not measured by any gate (use `cargo llvm-cov` if installed).

Native tests use throwaway SQLite databases in the temporary directory. The code that actually talks to the operating system's printing (the Windows GDI calls, `lp`) cannot run in tests. Everything around it is tested: validation, layout with a stand-in text measurer, the deadline helper, printer availability flags, the per-printer guard, and the job state handling up to the point of the OS call (on macOS the call reports "not supported", so those tests see `failed`). The `submitted` and `uncertain` outcomes of a real OS submission are not exercised. See [DESKTOP_ACCEPTANCE.md](DESKTOP_ACCEPTANCE.md).

## Packaging

| Target | Command | Notes |
| --- | --- | --- |
| Windows installer (NSIS) | `npm run tauri:build:windows` on Windows | Uses `src-tauri/tauri.windows.conf.json`: identifier `com.smartlaundry.pos`, per-user install, bundled WebView2 offline installer, downgrades refused. Unsigned. Not yet built or run by me. The script and the config file are uncommitted at the time of writing. |
| Windows review installer | `npm run tauri:build:windows-review` | Identifier `com.smartlaundry.pos.review`, per-machine install, separate data folder. |
| macOS review app | `npm run tauri:build -- --config src-tauri/tauri.review.conf.json` | Ad-hoc signed, not notarized, arm64 on Apple Silicon. For development. |
| Ubuntu review package | `npm run tauri:build:linux-review` | Needs the [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux). Produces a `.deb`. |

Review builds use their own identifier and therefore their own data folder, so they do not touch a shop's real database. Check the identifier before launching any build on a computer that holds real data.

The default `tauri.conf.json` still lists `app` and `dmg` bundle targets with an ad-hoc macOS signing identity. This is a local review setup. Distributing a macOS build would need Developer ID signing and notarization, which is out of scope for the Windows target.

## Continuous integration

`.github/workflows/desktop.yml` runs only on pull requests to `main` and on pushes to `codex/**` branches. A push to any other branch (such as `claude/**`) does not start it until a pull request exists. It has three jobs:

- `desktop` (macOS): `npm ci`, `npm test`, coverage gate, lint, typecheck, desktop and web builds, `cargo fmt --check`, `cargo test`, `cargo clippy -D warnings`, review app build and signature check.
- `linux-package` (Ubuntu 24.04): builds the review `.deb` and uploads it.
- `windows-package` (Windows 2022): desktop JavaScript tests, `cargo check`, `cargo test` and `cargo clippy` on Windows, then builds and uploads both the production installer (`smart-laundry-pos-windows`) and the review installer (`smart-laundry-pos-windows-review`). Neither is signed.

The Windows job is the first place the native code and the Windows printing adapter are compiled and the native tests are run on Windows. As of this writing it has not run against the current changes. The result is recorded in [DESKTOP_ACCEPTANCE.md](DESKTOP_ACCEPTANCE.md).
