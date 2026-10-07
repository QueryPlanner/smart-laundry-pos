# macOS local-first desktop app

The desktop entry runs the existing local-first POS screen in a Tauri window.
It stores its records in SQLite on this Mac. It does not use the web app's
Supabase account or sync records to the cloud. The browser and Android builds
continue to use their existing entries.

## Data and backups

The native app resolves its database directory through Tauri's
`app_config_dir()` for the product identifier in `src-tauri/tauri.conf.json`.
The database file is `laundry.db`; backup files are stored in the sibling
`backups/` directory. The current product identifier is
`com.smartlaundry.pos`. A review build uses its separate identifier and data
directory.

The app creates a backup when it starts after a local administrator exists.
The Settings screen can also create a backup. The current implementation keeps
the newest 30 `.db` files. These copies stay on the same Mac, so keep another
copy somewhere safe if the business needs protection from device loss.

Backup uses SQLite's `VACUUM INTO` to capture a consistent database snapshot.
Restore validates integrity, foreign keys, required schema, and supported
schema version before staging a snapshot. It creates a safety backup first.
After staging, the native layer blocks writes until the app restarts.

Close the app after the confirmation and reopen it to apply the staged restore.
The app acquires a database lock and applies the restore before opening its
connections. A recovery journal preserves the original database if application
is interrupted. Verify the restored records after reopening.

The PIN locks the app screen. It does not encrypt the SQLite files or backups.
Protect the Mac account and store independent copies of business backups.

The bundled renderer is trusted and can read or mutate business records through
the native SQL bridge. The bridge rejects multiple statements, transaction
control, and schema changes; reads also use a SQLite read-only connection.
These checks preserve transaction ownership but do not authorize individual
tables or users. The restrictive content security policy allows local assets
and Tauri IPC. Introducing remote pages, renderer plugins, or untrusted scripts
would require revisiting this boundary and using narrower domain commands.

If a staged snapshot becomes invalid before restart, the app preserves it under
a unique rejected-restore filename and opens the verified original database.
It shows a recovery warning. A damaged or incompatible original database remains
an initialization error so the app cannot silently change business records.

## Development and builds

Run the Tauri development app with:

```sh
npm run tauri:dev
```

Tauri starts `npm run dev:desktop`, which serves the
standalone entry on `127.0.0.1:8080`. Running only the Vite server in a regular
browser does not provide the Tauri SQLite runtime.

Build the frontend bundle with:

```sh
npm run build:desktop
```

This writes `dist-desktop/index.html` and its bundled assets. Use the review
config overlay to run or package an isolated review app:

```sh
npm run tauri:dev -- --config src-tauri/tauri.review.conf.json
npm run tauri:build -- --config src-tauri/tauri.review.conf.json
```

The review overlay uses `com.smartlaundry.pos.review`, the product name
`Smart Laundry POS Review`, and an app-only bundle target. Its database directory
is separate from `com.smartlaundry.pos`. Verify the identifier before launching
a test build on a Mac that already has business data.

The default Tauri configuration uses the ad-hoc signing identity `-`. Tauri
signs the app bundle with this pseudo-identity, so the signature can be checked
for integrity. It does not identify an Apple Developer ID and the app is not
notarized. macOS may require a user to approve an ad-hoc signed app in Privacy &
Security. Treat these artifacts as local review builds, not ready-to-distribute
downloads. Direct distribution requires Developer ID signing and notarization.

The build commands do not select a universal target. A host build on Apple
Silicon is expected to be arm64 only; inspect the packaged artifact before
reporting its architecture or signature status.

## Validation plan

The desktop CI workflow runs these checks on a pull request to
`main` and on a `codex/**` branch push:

```sh
npm ci
npm test
npm run test:desktop:coverage
npm run lint:desktop
npm run typecheck:desktop
npm run build:desktop
npm run build
cd src-tauri
cargo fmt --all -- --check
cargo test
cargo clippy --all-targets -- -D warnings
cd ..
npm run tauri:build -- --config src-tauri/tauri.review.conf.json
codesign --verify --deep --strict "src-tauri/target/release/bundle/macos/Smart Laundry POS Review.app"
```

The V8 coverage gate requires 100% statements, branches, functions, and lines
for the desktop entry, `LocalFirstApp.tsx`, and executable `src/lib/localFirst`
modules. Rust uses separate validation; this gate does not measure it. Native tests use isolated
temporary SQLite databases. Measure native coverage with `cargo llvm-cov` when
the tool and LLVM components are installed.

This guide documents reproducible checks. The delivery acceptance record reports
the results from the actual build. Manual app acceptance uses synthetic records: create an
administrator, reject a wrong PIN, create records, quit and reopen to check
persistence, make a backup, stage a restore, reopen, and verify the restored
records and safety backup.

On macOS, receipt printing uses Tauri's native webview print command. The main
window capability explicitly permits that command. The receipt remains mounted
after IPC dispatch because command completion does not establish that the print
dialog has closed. Print errors appear in the workspace notice. A real printer
still needs device verification; DOM tests cannot establish paper output.
