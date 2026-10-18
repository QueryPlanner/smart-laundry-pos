# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is

Smart Laundry POS is a **desktop app only**: Tauri 2 (Rust native layer + SQLite) with a React 18 + TypeScript + Vite + Tailwind/shadcn interface. It runs offline on one shop computer. There is no web app, no Supabase and no server. `landing/` is a static page for downloading the installers.

## Commands

```bash
npm ci
npm run tauri:dev            # run the desktop app (Vite on 127.0.0.1:8080)
npm test                     # JavaScript tests (vitest, desktop config)
npm run test:coverage        # same, with a 100% statements/branches/functions/lines gate
npm run lint                 # eslint on the desktop entry, localFirst and counter components
npm run typecheck            # tsc --project tsconfig.desktop.json
npm run build                # frontend into dist-desktop/ (also copies every public/garments picture)
cd src-tauri && cargo fmt --all -- --check && cargo test && cargo clippy --all-targets -- -D warnings
```

Never cancel builds; allow at least 60 s for `npm ci`. The desktop app has never been run on Windows or printed on the shop's printers; see `docs/DESKTOP_ACCEPTANCE.md`. Verify installed workflows with synthetic data in a separate review identifier and database folder.

## Layout

- `src/desktop.tsx`, `src/pages/LocalFirstApp.tsx` entry
- `src/components/localCounter/` screens (order entry, orders/pickup, admin, dashboard, ...)
- `src/lib/localFirst/` typed wrappers for the native `counter_*` commands and business helpers
- `src/components/ui/` shadcn components that the screens use
- `src-tauri/src/` Rust: `counter.rs` (accounts, rate card, quote/save order, payments, trash), `storage.rs` (SQLite, migrations, schema contract), `printing.rs`/`print_layout.rs` (bill and tags), `insights/`, `office.rs`
- `src-tauri/migrations/` numbered SQL migrations (001 to 007). Frozen once released; add a new file and a `MIGRATION_STEPS` entry in `storage.rs`. A schema change also needs a `REQUIRED_TABLES_V*` entry; data-only migrations share the previous schema contract.
- `landing/` + `vercel.json`: Vercel publishes only `landing/`

## Rules of the road

- The UI reaches the database only through role-checked native `counter_*` commands. A new command must check the session role inside the command (admin writes use `require_admin_in_tx`), be registered in `src-tauri/src/lib.rs`, and have a TypeScript wrapper (`src/lib/localFirst/commands.guard.test.ts` fails otherwise).
- Money is whole paise (integers). Prices come from the rate card; a line may carry a one-bill override (`unitPriceOverrideMinor`), audited as `order_price_changed`.
- Services: Iron, Wash, Dry Clean, Starch. Starch is the service row with key `wash_iron` (the schema CHECK allows no new key). Wash includes ironing.
- Every seeded garment needs a picture `public/garments/<image_key>-transparent.png` (a guard test checks it).
- Bills print on paper the shop chooses (A5 is used); the fixed Marathi terms are in `BILL_TERMS` (`print_layout.rs`), mirrored in `src/lib/localFirst/billTerms.ts`.
- Keep 100% JavaScript coverage on the gated files; new code needs meaningful tests.
- Releases: bump the version in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json` (never change the identifier `com.smartlaundry.pos`), build the installers, attach the exe, dmg and deb with SHA-256 to a GitHub release, upload to the R2 bucket `smart-laundry-pos-releases` (`latest/` and `releases/<version>/`) and update the version text in `landing/index.html`.
