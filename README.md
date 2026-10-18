# Smart Laundry POS

A point-of-sale desktop app for a laundry shop: take orders, print bills and garment tags, track pickup and payments, and see sales. It is a Tauri 2 app (Rust + SQLite + a React interface) that runs offline on one shop computer and keeps all records in a local database.

Download the latest Windows, macOS or Linux installer at **https://laundry.lordpatil.com**, or from the [GitHub releases](https://github.com/QueryPlanner/smart-laundry-pos/releases).

## What it does

- **New order:** every garment is on screen at once; each card has Iron, Wash, Dry Clean and Starch buttons with their prices. Any user can change one line's price for one bill.
- **Orders / Pickup, Print queue:** hand-over checks, advance and balance payments, bill and tag reprints, cancel (admin) and trash (staff mark, admin approves).
- **Dashboard, Sales, Customers, Expenses, Inventory, Machines.**
- **Admin and Shop settings** (admins only): rate card, discounts, staff accounts, printers, backups.

Documents: [docs/DESKTOP.md](docs/DESKTOP.md) (architecture and commands), [docs/OPERATIONS.md](docs/OPERATIONS.md) (owner's guide), [docs/PRINTING_WINDOWS.md](docs/PRINTING_WINDOWS.md), [docs/DESKTOP_ACCEPTANCE.md](docs/DESKTOP_ACCEPTANCE.md) (what is and is not verified).

## Develop

```sh
npm ci
npm run tauri:dev      # run the app
npm test               # JavaScript tests
npm run test:coverage  # 100% coverage gate
npm run lint && npm run typecheck && npm run build
cd src-tauri && cargo fmt --all -- --check && cargo test && cargo clippy --all-targets -- -D warnings
```

## Repository layout

- `src/` React interface (`components/localCounter`, `lib/localFirst`, `desktop.tsx`)
- `src-tauri/` Rust app, SQLite migrations, installer configs
- `public/garments/` item pictures bundled into the app
- `landing/` the static download page served at laundry.lordpatil.com (`vercel.json` publishes only this folder)
- `docs/` guides

The earlier browser (PWA) version of the POS was removed from this repository; it remains in the git history (before the commit that removed it).
