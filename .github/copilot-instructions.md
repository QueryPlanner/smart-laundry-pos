# Smart Laundry POS - Copilot instructions

This repository is a Tauri 2 desktop app (Rust + SQLite + React/TypeScript). There is no web app. Read `CLAUDE.md` for commands, layout and rules, and `docs/DESKTOP.md` for the architecture.

Before proposing a change, run `npm ci`, `npm test`, `npm run lint`, `npm run typecheck` and, for Rust changes, `cargo test` and `cargo clippy --all-targets -- -D warnings` from `src-tauri/`.
