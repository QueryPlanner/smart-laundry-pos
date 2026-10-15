# Claude Code plan review evidence

Date: 2026-10-06

Claude Code version: 2.1.291

Verified result model: `claude-opus-5-5`

Result is_error: False

Tools disabled. Review used the supplied provisional plan and observations.
It did not independently inspect the repository. The parent reconciled the
findings in the delivery plan and verified lifecycle evidence in dependency source.

# Adversarial review: Smart Laundry POS delivery plan

This review uses only the plan and its stated observations. I ran no tools, and nothing below confirms any fact about the repository. Where I say "verify," I haven't checked that item.

`★ Insight ─────────────────────────────────────`
- The plan's riskiest steps aren't technical. They're actions other people will see: a PR that may land in the wrong repo, committing files whose author nobody has confirmed, and UI automation that needs macOS permission prompts only the user can accept. These go first because they can't be undone or can't be done without the user.
- The SQLite risks are specific. A stale WAL file can corrupt a restore. Two separate connection pools on one file can block each other. And WebKit sends network traffic from its own helper processes, which can hide cloud requests from per-app monitoring.
`─────────────────────────────────────────────────`

## Blockers: resolve before any implementation

**B1. Scope and the one-feature rule.** The plan says it's provisional but then sets out four pieces of work: the transaction rework, the backup/restore rework, UI defect fixes, and docs/CI. It also commits the whole uncommitted local-first app (`src-tauri/`, `src/lib/localFirst/`, `LocalFirstApp.tsx`, `App.tsx`, package and `.gitignore` changes). That's one very large PR, which conflicts with the global "one feature per PR" rule.
- **Ask the user:** one PR, or stacked PRs?
- **My recommendation:** stack them.
  1. PR 1: the local-first app plus native transaction safety. Shipping order writes that aren't actually atomic shouldn't happen.
  2. PR 2: backup/restore hardening. If it isn't safe yet, PR 1 should hide or disable restore.
  3. PR 3: UI fixes and docs.

**B2. Who owns the uncommitted work.** The plan "preserves" the existing changes and then commits and pushes them. Nobody has confirmed who wrote them or that every file belongs in the PR. Before any commit:
- Confirm with the user that all seven paths are in scope, including the `.gitignore` and `package.json` changes.
- Check `src-tauri/` for build output (`target/`, `gen/`), signing keys, updater private keys, or `.env` files. Confirm `.gitignore` covers `src-tauri/target`.
- Confirm the new direct dependencies are approved: Tauri, `tauri-plugin-sql`, and whatever test runner makes `npm run test` work. CLAUDE.md says no test suite is configured, so the uncommitted `package.json` probably adds one. The rule "ask before adding a library" applies to these existing additions too, not only to new ones.

**B3. Which repository the PR targets.** Recent commits merge PRs "from fahrudina/…", so `origin` (QueryPlanner/smart-laundry-pos) may be a fork. On a fork, `gh pr create` defaults to the **upstream parent** as its base. The PR could open in someone else's repository.
- Check whether `origin` is a fork.
- Pass `--repo` and `--base` explicitly.
- Have the user confirm the target repo before creating the PR.

**B4. The installed-app E2E can't run without the user.** Native UI automation on macOS needs Accessibility permission, and screenshots need Screen Recording permission. Both are granted through system prompts the user must accept.
- Ask the user up front to grant them, or accept a reduced, documented form of acceptance testing.
- Without this, steps 1–11 can't be completed autonomously, and the plan doesn't say so.

**B5. Unverified external review.** "Wait for … the automatic Codex review cycle" assumes a review bot is configured on this repo. The plan doesn't verify that. The `codex/` branch prefix also doesn't match any convention the user has stated.
- Confirm whether the bot exists and which branch prefix to use.
- If the bot isn't set up, the PR's completion criterion can never be met. Define a different completion state with the user.

**B6. Coverage rule missing.** The global rule sets 100% coverage as the floor. The plan names no coverage tool, no threshold, and no measurement step. "UI tests where the existing test environment supports them" is the skip the rule forbids: code that can't be tested is an architecture problem to fix.
- Decide on coverage tooling. It may need a library, so ask first.
- Decide how to test `LocalFirstApp.tsx`.

## High priority: design gaps

**H1. Who owns the transaction, and the API shape.**
- Don't expose BEGIN/COMMIT to JavaScript over IPC. Make each business mutation one native command, such as `create_order` covering the order, its items, payment, status history, and audit records. Then a transaction can't be left open across async JS calls.
- `tauri-plugin-sql` is built on sqlx (I haven't verified the version). Using sqlx directly makes it a **direct** dependency, which needs approval even if it's already in the dependency tree.
- If the plugin's pool and a new native pool both open the same file, you get SQLITE_BUSY errors and writes in an unclear order. Choose one owner for writes. Set `busy_timeout`, WAL mode, and `foreign_keys=ON` on every connection. Confirm no JS path still writes through the plugin.
- Distinct order numbers need a UNIQUE constraint in the schema plus a test under concurrency. Allocating numbers inside the transaction isn't enough by itself.

**H2. Schema versioning and existing databases.**
- The plan doesn't mention migrations, yet the native rework and order-number constraints will probably change the schema.
- Define `PRAGMA user_version` (or an equivalent), forward migrations, and what happens when a restored backup is older or newer than the app's schema.
- Ask whether any real database from the uncommitted app already exists on the user's machine.

**H3. Restore correctness.**
- When replacing the database, delete or replace any old `-wal`/`-shm` files. Otherwise SQLite can replay a stale WAL onto the restored file.
- Use `VACUUM INTO` (plain SQL, no new library) or SQLite's backup API, not checkpoint-then-copy. Writes can land between the checkpoint and the copy.
- Stage the restore with an atomic rename on the same filesystem, and keep the safety copy until integrity and schema checks pass on the new file.
- Confirm the restore runs before the plugin's `Database.load`. "During setup" doesn't guarantee that ordering.

**H4. The Tauri capability files aren't in anyone's allowlist.** New native commands need entries in `src-tauri/capabilities/*.json`, and possibly `tauri.conf.json`. Least privilege also means narrowing `sql:allow-execute` once writes move to native code. Worker A's allowlist omits these files, so it will hit a stop condition partway through.

**H5. The A → B → C contract.** Write down the native API before Worker A starts: command names, payload and return types, and error codes. Then B can write tests in parallel, and "contract settles" has a precise meaning.

**H6. Risk to web and Android builds.** The Android workflow runs on pushes to main, so a broken `App.tsx` or `package.json` will only show up after merge.
- Run the Android workflow's build commands locally. Ask the user before manually dispatching it on the branch, since that's visible to others.
- Verify that Tauri-only imports don't end up in the web bundle (load them dynamically or guard them).
- Verify that the PWA service-worker registration in `main.tsx` is skipped inside Tauri.

**H7. PR checks may be empty.** If no workflow runs on PRs, "wait for all required checks" passes trivially. The rule that CI must be green before a PR then only means anything if you run the commands locally. If a new desktop CI file is in scope, the user needs to approve it.

## Medium priority

- **M1. The installed app isn't the shipped app.** Swapping the bundle identifier for testing produces a different artifact. Use a build-time config overlay (`--config`), checksum both artifacts, and state the difference in the acceptance matrix.
- **M2. Network evidence.** WKWebView sends traffic from `com.apple.WebKit.Networking`, not from the app's own process. Monitor those helper processes as well. Also check for eagerly created Supabase clients and CDN fonts or scripts in `index.html`.
- **M3. Printing.** Before relying on step 6, check that `window.print()` works in Tauri v2's macOS webview at all. I haven't verified it.
- **M4. PIN security.** Review how the administrator PIN is stored (hashed and salted?) and whether repeated attempts are limited before handing off an "unlock" flow.
- **M5. Lockfile drift.** `package-lock.json` is already modified, and `npm install` can rewrite it. Use `npm ci`. Also check that the Rust toolchain and Xcode command-line tools are installed.
- **M6. Distribution limits.** An unsigned, un-notarized DMG will be blocked by Gatekeeper for reviewers who download it. Signing involves credentials, so say plainly that it's out of scope. Also state which CPU architecture the build targets (arm64 only, or universal).
- **M7. Ready vs. draft PR.** "Ready" is the more visible choice. Ask, or default to draft until the E2E passes.
- **M8. Stale docs.** CLAUDE.md says "no test suite" and "no CI/CD". Update it as part of the docs allowlist, or the next agent will rely on wrong facts.

## Questions for the user

1. One PR or stacked PRs? (B1)
2. Are all the uncommitted files and dependencies approved for commit? (B2)
3. Which repository and base branch should the PR target? (B3)
4. Can you grant Accessibility and Screen Recording permissions? (B4)
5. Is a Codex review bot configured, and should branches use the `codex/` prefix? (B5)
6. Which coverage tool, and may we add it? (B6)
7. Is there any existing local desktop database with real data? (H2)
8. Should the PR open as ready or draft? (M7)
