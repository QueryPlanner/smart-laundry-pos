# macOS review acceptance record

Date: 2026-10-07. Status: installed-app checks passed; native coverage remains
below the required floor. This record distinguishes observed results from remaining checks.

## Review boundary

The installed app is `/Users/lordpatil-air/Applications/Smart Laundry POS Review.app`.
Its verified identifier is `com.smartlaundry.pos.review`; its executable is arm64.
Strict deep codesign verification passed before and after installation. The
signature is ad hoc; the artifact has no Developer ID or notarization.
The final installed executable SHA-256 is
`ef121cfb6e1190f14971220d87c3c87cc020c3f2f890abb4e79bac8c6270be10`.
The previous installation was preserved before replacing the app. Existing
review records persisted through the installation update.
After the CI default-implementation patch, the parent reinstalled this final build
and verified unlock, retained paid/collected records, a native settings save,
native print dispatch and cancellation, and locking again.
The final diagnostic-warning correction was rebuilt and reinstalled afterward;
startup, retained records, and locking were verified again on that final artifact.

The final normal app and DMG were also built. Strict app signature verification
and `hdiutil verify` passed. The normal executable SHA-256 is
`e87df9d9c915b8b11674bd679e641c2c70f8fa86e3cf88cc8b9db5150322a005`;
the DMG SHA-256 is
`626631175f784c0e7604f9dd330a0df5d5ad963baa90dd24e5c6d1816c3b4332`.
The normal app was not launched or installed. The supported Tauri DMG build
required device-access escalation after its sandboxed bundling attempt failed.

The app uses the isolated data directory for `com.smartlaundry.pos.review`.
The production identifier `com.smartlaundry.pos` was never launched or opened
for testing. The review app started with no database or existing installation.

Setup rendering was observed. A synthetic administrator was seeded through
the CLI in the review database with the same SHA-256 PIN format as `security.ts`.
GUI account creation was not submitted. Automated setup tests cover creation.
All customer names, phone numbers, order records, and payments below are fixtures.

## Personally observed installed-app checks

| Check | Observed result |
| --- | --- |
| Login and locking | Nonempty wrong PIN rejected; correct fixture PIN unlocked; Lock app returned to login. |
| Settings | Review Laundry, dummy phone, and RV prefix saved and persisted after restart. |
| Customer and service | Review Customer saved; Shirt service showed 40 per piece and 80 per kg. |
| Mixed order | Three pieces at 40 plus 2.50 kg at 80 produced subtotal 320. Fixed discount 20 produced total 300. |
| Negative initial payment | -1 displayed a validation error and disabled Save order. |
| Partial and final payment | Cash 100 showed Partially Paid. UPI 200 produced Paid and zero outstanding. |
| Status history | Received to Ready to Collected saved. Independent SQLite inspection confirmed all three history rows. |
| Expense and report | Expense 50 saved. Report showed revenue 300, expenses 50, profit 250, completed 1, pieces 3, and weight 2.50 kg. |
| Inventory | Opening stock +10 saved. -20 was rejected; quantity stayed 10 and only one stock transaction existed. |
| Machine | Review Washer with capacity 8 kg saved. |
| Restart persistence | Quit and reopen required PIN; dashboard retained order, payments, settings, and totals. |
| Backup | Backup now created a real SQLite snapshot. Independent integrity and row-count checks passed. |
| Restore | Added disposable customer after backup; staged baseline; writes blocked until restart; reopen restored one customer and retained baseline order. |
| Safety copy | Independent SQLite inspection found the disposable customer in the pre-restore safety snapshot. |
| Invalid restore | A synthetic non-database file was rejected with SQLite code 26. Workspace remained available with no restore banner. |
| Receipt printing | Rebuilt app opened the macOS print dialog with a one-page receipt preview. Cancel returned to the usable order workspace; no printer was selected. |
| Restore cancellation | Rebuilt app displayed the native warning. Cancel returned to Settings; independent inspection confirmed no pending restore file. |
| Confirmed restore retest | Added Final Restore Marker; Stage restore displayed the persistent banner. A settings write was rejected. Quit/reopen restored one customer and the baseline paid, collected order. SQLite integrity and foreign-key checks passed. |

Independent read-only SQLite checks confirmed integrity, no foreign-key violations,
order item totals 120 and 200, payments 100 cash and 200 UPI, stock 10, and audit rows.
The baseline snapshot checksum was
`cb6a02e75bd37d9fa9e5fdd62c1fa94b5706abc63eaed4ac11ccb164cd550f6b`.

## Verification limits and remaining work

- Native coverage is below the required 100% floor. The measured all-target
  result is 92.38% lines (1,515/1,640), 88.18% regions, and 67.08% functions.
  `storage.rs` has 92.94% lines (1,448/1,558), `lib.rs` has 84.81%,
  and `main.rs` has 0/3 lines.
  Stable LLVM branch counters are unavailable. No coverage exclusions were used.
  Remaining gaps include filesystem compensation failures, rollback failures,
  collision exhaustion, decoder paths, and the real desktop event loop.
- The rebuilt app was installed and its native print/restore dialogs were retested.
- No physical printer output, Windows installation, or Android device test is claimed.
- No packet capture or global network disable was performed. Local operation is
  supported by the standalone entry and restrictive CSP; GUI results alone do
  not establish the absence of all network traffic.
- [PR #1](https://github.com/QueryPlanner/smart-laundry-pos/pull/1) is a draft.
  Its initial remote run passed JavaScript checks, builds, formatting, and native
  tests, then failed Rust 1.99 Clippy on a derivable default implementation.
  The scoped fix passes local Rust 1.99 formatting, all 58 tests, and Clippy.
  Final remote CI and the ready-for-review automatic review remain pending.
  No merge, release, or distribution is claimed.

## Automated validation

A clean locked dependency install and the required JavaScript workflow commands
passed under Node.js 22 on 2026-10-07:

- `npm ci`
- `npm test`: 72 tests across 10 files.
- `npm run test:desktop:coverage`: 85 tests across 9 files, with 100% statements,
  branches, functions, and lines for the entry, view, and localFirst modules.
- `npm run lint:desktop`
- `npm run typecheck:desktop`
- `npm run build:desktop`
- `npm run build`, including public-route prerendering.

The final native validation commands passed on 2026-10-07:

- `cargo fmt --all -- --check`
- `cargo test`: 58 tests, including four shared startup/IPC harness cases.
- `cargo clippy --all-targets -- -D warnings`
- `cargo llvm-cov --summary-only`: measured coverage above; no exclusions.

After the remote Clippy finding, the native checks also passed with `cargo +stable`
on Rust 1.99.0. Coverage was remeasured with `cargo +1.89 llvm-cov --summary-only`
to retain the original coverage toolchain and compare results consistently.

The repository-wide legacy lint/typecheck failures recorded in the plan remain
outside this desktop feature. These results do not claim those checks passed.

`npm audit --json` reported 48 dependency advisories. Comparing affected nodes
and versions with the starting HEAD showed one additional affected node,
`@vitest/coverage-v8`, through the existing vulnerable Vitest version. The other
affected nodes and versions were already in the starting lockfile. No forced
dependency upgrades were applied. This is not a dependency-security pass.

## Recovery warning correction

Source review found that a final directory-sync failure can occur after a valid
replacement is installed. Both recovery fallback warnings now state only that
the active database passed validation and ask the operator to check records.
They do not claim which snapshot is active. Existing error-path tests retain
data-preservation assertions and pass with the corrected wording. The rare
post-journal directory-sync failure was not induced in the installed app.
