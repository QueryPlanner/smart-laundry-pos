# Smart Laundry POS delivery plan

Date: 2026-10-06
Status: scope approved on 2026-10-06. The user requested a plan, Claude Code Opus 5.5 review,
scoped Luna implementation, a new PR, installation, and end-to-end testing.
The user confirmed macOS and approved proceeding with completion and
hardening of the existing uncommitted local-first desktop app.

The sections below retain the original plan and dated reconciliation checkpoints.
References to pending approvals in earlier checkpoints are historical; later
approval sections supersede them. Current installed-app results are recorded in
`../DESKTOP_ACCEPTANCE.md`.

## Verified starting point

- Repository: QueryPlanner/smart-laundry-pos. Branch: main.
- Existing changes: .gitignore, package.json, package-lock.json, src/App.tsx,
  src/lib/localFirst/, src/pages/LocalFirstApp.tsx, and src-tauri/.
- The browser app uses Supabase. App.tsx selects LocalFirstApp in Tauri.
- Local-first persistence uses tauri-plugin-sql 2.4.1 and SQLite.
- db.ts currently sends BEGIN, queries, COMMIT through the SQL plugin.
  The dependency's wrapper.rs connects a pool and executes each query on it.
  Connection affinity is not guaranteed by this code.
- Backup uses file copy after a frontend WAL checkpoint. Restore validates
  only the SQLite file header and copies a pending database during setup.
  Pool lifecycle, schema compatibility, WAL sidecars, concurrent writes,
  interruption, and restore failure behavior need verification.
- Existing tests cover pricing rules and two Rust header cases. They do not
  prove complete orders, payment atomicity, or safe backup/restore.
- No node_modules or built app was found in this checkout.
- The Android workflow builds on main push or manual dispatch, not PRs.
- Claude Code 2.1.291 can authenticate outside the sandbox. A request with
  --model claude-opus-5-5 succeeded. GitHub account QueryPlanner is active.
- Claude's completed review JSON confirms modelUsage.claude-opus-5-5 and
  is_error=false. The review used tools disabled and did not inspect code.
- Cargo.lock pins Tauri 2.11.5. Its app.rs initializes plugins during build,
  before the application setup hook. The SQL preload therefore opens the
  database before the current pending restore code runs.
- main.tsx mounts Analytics and SpeedInsights and registers a service worker
  without a desktop guard. index.html requests Google Fonts. The desktop
  entry must avoid web startup side effects and work with bundled fonts.
- Xcode, Rust, Cargo, Node, and npm are installed. Compatibility with this
  lockfile remains a build/test gate, not an assumed success.

## Approved single feature

Deliver the existing local-only desktop POS as a reviewable macOS app.
Windows delivery, cloud sync, and additional product features require their
own scope and verification. If the user intends Windows, amend this plan
before implementation; a Mac build cannot satisfy Windows installation.

## Architecture decisions before edits

1. SQLite remains the desktop source of truth. The web app keeps its current
   behavior. This avoids a new cloud synchronization contract, but desktop
   data needs explicit backups and stays on the device.
2. Architecture decision: replace unsafe pooled transaction calls with a native transaction owner
   that holds one SQLite connection throughout a complete mutation. Inspect
   the existing dependency APIs before choosing the smallest implementation.
   A JavaScript queue alone cannot guarantee native connection affinity.
   If a new direct library is needed, ask before adding it.
   Specify command payloads, results, errors, and mutation ownership before
   worker assignments. Reuse the plugin's existing pool where feasible;
   do not create an independent competing pool. One complete mutation must
   acquire, use, and release its transaction within the native runtime.
3. Architecture decision: backup must capture a consistent database. Restore must validate schema
   and integrity, preserve a recovery copy, and apply before connections open.
   Reject invalid input without changing the active database. Discuss any
   changed retention or existing database format before implementing it.
   Prefer SQLite snapshot/backup facilities over checkpoint-then-file-copy.
   Apply pending restore before any plugin preload, use atomic replacement,
   handle stale WAL/SHM files safely, and retain the original until the restored
   database passes validation. Define older/newer schema compatibility and
   forward migrations. Test interruptions at each replacement stage.
4. Install the built app under a fresh, review-specific user Applications
   directory. Use an isolated test app identifier/database. Verify isolation
   before launching. Never replace an existing installation or business data.

## Review sequence

1. Run a read-only Claude Code review with claude-opus-5-5. Give it this plan
   and verified excerpts. Ask it to challenge scope, transaction guarantees,
   lifecycle ordering, backup recovery, tests, and worker boundaries.
2. Have a Luna reviewer independently identify omissions without editing.
3. Resolve every concern explicitly and amend the plan before implementation.
4. When scope is confirmed, record a baseline manifest and preserve existing
   changes. Fetch the remote and create a codex/ feature branch. Reconcile
   divergence without resetting or discarding the user's working files.

## Worker ownership

Workers are not alone in this checkout. Do not revert others' edits. Never
commit, push, install, edit credentials, or change files outside the allowlist.
Each assignment names exact files, allowed behavior, tests, and stop conditions.
After each worker finishes, inspect its diff against its allowlist.

- Worker A, native persistence: src-tauri/src/lib.rs, a specifically named
  native storage module, and their colocated Rust tests. Cargo.toml/Cargo.lock
  changes require approval of any new direct library. No UI edits.
  Explicitly include src-tauri/tauri.conf.json and
  src-tauri/capabilities/default.json when initialization or permissions need
  changes. Narrow SQL permissions only after confirming every production path.
- Worker B, repository integration: src/lib/localFirst/db.ts,
  src/lib/localFirst/repository.ts, src/lib/localFirst/backup.ts, and new tests
  named explicitly in its assignment. Start after A's native contract settles.
- Worker C, desktop UI: src/pages/LocalFirstApp.tsx and explicitly named UI
  tests only. Address demonstrated validation/error/recovery defects. Do not
  redesign unrelated screens. Start after B's repository contract settles.
- Reuse a worker for documentation/build support only through a new explicit
  allowlist. README.md, a dedicated desktop guide, and any new desktop CI file
  must be separately named. Do not alter Android workflows or legacy lint
  rules merely to make checks pass.
- The parent owns App.tsx integration, branch/commit/PR operations, review
  reconciliation, installation, and independent end-to-end verification.
  The parent also owns src/main.tsx and desktop-specific entry integration.
  Browser and Android startup behavior must remain covered by regression checks.

## Validation gates

- Use npm ci for existing locked dependencies and run baseline tests, build, lint,
  type checking, cargo tests, and Rust formatting checks. Record real failures.
  An existing failure is not permission to weaken validation or claim success.
- Add tests at the real native database boundary: complete order with items,
  payment/status/history/audit records; forced failure rolls everything back;
  simultaneous orders receive distinct numbers; foreign keys apply to each
  connection; successful restart retains data.
- Exercise real SQLite backup/restore: consistent backup, pending restore
  ordering, integrity and schema rejection, interrupted application recovery,
  and preserved original data on errors. Header-only tests are insufficient.
- Add repository tests for validation contracts and UI tests where the
  existing test environment supports them. If it cannot test the desktop UI,
  establish a real boundary rather than silently omit coverage. Ask before
  adding a new library. Measure coverage of changed owned logic against the
  user's 100% requirement, including negative paths; choose supported tooling
  after inspecting existing package capabilities and seek dependency approval
  if the measurement requires a new package. Do not weaken this requirement.
- Run npm run test, npm run build, changed-file lint, relevant type checks,
  cargo fmt --check, cargo test, cargo clippy where applicable, and the actual
  configured CI commands. Run full lint and report its result separately.
- Build actual app and DMG with npm run tauri:build. Record checksums and
  metadata. Record arm64/universal architecture and signing/notarization state.
  Use a build configuration overlay for the isolated test identifier. Record
  both artifacts' checksums and differences; test-build acceptance cannot be
  reported as direct installation of the normal artifact.
  Do not claim Windows or physical printer verification.

## Installed-app end-to-end acceptance

Use native UI automation and synthetic data in the isolated installation.

1. Launch the installed app, create administrator, reject a wrong PIN, unlock.
2. Configure shop settings, create a customer and piece/weight services.
3. Create a multi-item order; verify independently calculated totals, discount,
   initial partial payment, balance, number, and order history.
4. Record remaining payment and verify paid status, reports, and ledger.
5. Change order status through ready and collected; verify history and audit.
6. Verify receipt contents and system print dialog. Cancel the dialog; physical
   printing is outside the available proof unless a printer is accessible.
7. Add expense, adjust inventory, add machine, verify reports and saved data.
8. Quit and reopen; verify login and all records persist.
9. Create backup, make a synthetic change, stage restore and restart; verify
   restored records and safety copy. Test invalid backup without altering data.
10. Verify the desktop critical path requires no cloud requests, using native
    runtime/network evidence. Do not disable the user's whole network.
11. Capture screenshots and an acceptance matrix with exact passed/failed
    stages. Leave the isolated installed app available for review.

## PR and completion

- Plan a Conventional Commit title of at most 50 characters and count it.
  Use an imperative dash-list body with a blank line and 72-character lines.
- Verify QueryPlanner account, repository, and chiragnpatil@gmail.com again.
- Use explicit --repo QueryPlanner/smart-laundry-pos and --base main. Inspect
  fork metadata instead of relying on GitHub CLI's inferred repository.
- Push only the feature branch. Create a ready PR with What, Why, How, Tests,
  and any verified Related Issues. Never merge or deploy in this task.
- Attach the PR to this chat. Wait for all required checks and the automatic
  Codex review cycle. Address findings with scoped workers, rerun gates,
  push fixes, resolve addressed threads, and wait for green checks.
- If automatic review cannot start, report that external blocker explicitly.
  Do not substitute local review for an unperformed automatic review.
- Final handoff includes plan/review artifacts, PR, installed app path,
  test evidence, known limits, and exact completion state.

## Claude review reconciliation

- Accept connection ownership, restore/WAL lifecycle, schema versioning,
  coverage, native capabilities, web startup, isolated-artifact differences,
  locked installs, distribution metadata, and stale documentation concerns.
- Keep one feature PR only if confirmed scope is this desktop delivery. Safety
  fixes needed for that feature belong with it; unrelated UI redesign and
  additional product features do not. Do not invent a multi-PR project.
- Existing work must be preserved and inventoried. Committing it depends on
  confirmation that the requested feature is this existing desktop app.
  Libraries already referenced in the project are not newly introduced by the
  workers; genuinely new direct libraries still need approval.
- Repository and QueryPlanner account are verified; use explicit CLI target.
  No extra approval is needed for the PR the user already requested.
- codex/ branch prefix and ready PR after completion are already prescribed by
  session instructions. No extra preference question is needed.
- Inspect native UI automation availability. Ask for permission only if an
  actual OS/accessibility block occurs, not based on a hypothetical blocker.
- Automatic Codex review availability is unverified. Check it before treating
  the delivery stage as complete. Do not repeatedly request reviews.
- Evaluate existing salted SHA-256 PIN storage and attempt throttling within
  the confirmed feature scope. Do not silently promise protection against
  local database access or introduce a credential migration without discussion.

## Luna review reconciliation

The read-only Luna reviewer confirmed five concrete concerns. Resolve them
before implementation as follows:

1. Restore ordering: establish restore-before-open in the native startup
   contract. Test fresh startup and pending restore restart, not builder order.
2. Multi-write invariants: include orders, status/history, payment ledger/status,
   inventory/balance, settings, and service/customer changes with audit records.
   Specify writer serialization and enable foreign keys per connection.
3. Snapshot/recovery: use real SQLite fixtures, integrity/foreign-key/schema
   validation, atomic replacement and interruption tests. Surface startup backup
   failures instead of silently swallowing them while promising a backup.
4. Installation isolation: verify the bundle identifier and resolved app-data
   database path. A separate Applications folder alone does not isolate data.
5. Scope: macOS is confirmed. The feature answer remains pending; this candidate
   desktop-delivery scope does not authorize implementation until resolved.

## Refined implementation contract

The user approved proceeding with the existing desktop scope. Dependency
approval for promoting sqlx and adding Vitest coverage remains pending.

- Use a dedicated desktop entry and dist-desktop output, avoiding web startup
  effects. Preserve existing web build behavior and validate both outputs.
- One native writable pool owns complete business-mutation batches. It has
  one connection, foreign keys, WAL, and a five-second busy timeout. Each batch
  begins an immediate transaction and returns committed results in one IPC call.
  Related reads use one read transaction on an enforced read-only pool.
- Restrict renderer SQL to one allowed statement at a time; reject schema,
  attachment, pragma, and transaction control. Apply a restrictive native CSP.
- Hold a standard-library exclusive file lock for the database's lifetime.
  Rust 1.89 File::try_lock was compiled and independently verified locally.
- Snapshot via SQLite rather than copying a live database. Apply validated
  pending restores offline before either pool opens. Preserve recovery data
  and handle interrupted replacement. Block mutations after staging restore.
- Preserve the existing PIN format for database compatibility. The PIN is a
  local screen lock; it does not encrypt the database or protect against OS
  users who can access it. A credential migration is outside this delivery.
- Return order rows inside the committing batch. Do not automatically retry
  mutations after ambiguous transport failure; the operator must check history.
- Enforce administrator/customer uniqueness inside transactions, repair legacy
  settings at initialization, and keep complete audit writes with their records.

## Baseline validation this session

- npm ci completed.
- npm run test: 25 passed across four files.
- npm run build: passed, including public-route prerendering.
- cargo test: 2 passed; fetching dependencies required network escalation.
- Full lint: 57 errors and 18 warnings, recorded in the baseline lint log.
- Full type checking: errors in legacy Supabase/WhatsApp code and desktop code.
  The workers own the desktop errors; the standalone desktop check isolates
  that deliverable. No legacy lint/type rules are weakened.
- QueryPlanner fork target is verified. main has no branch protection.
  Explicit PR repository/base arguments are required.

## Implementation checkpoint

Branch: codex/local-first-macos. The initial HEAD matched origin/main.

Completed by scoped Luna workers and independently checked by the parent:

- Dedicated desktop HTML/entry, Vite output and TypeScript scope, npm scripts,
  desktop CI definition, and desktop guide.
- Startup backup warning and retry handling, accessible form/print labels,
  duplicate-submit guards, file-dialog error handling, invalid draft previews.
- Finite/nonnegative pricing validation, malformed-type rejection, zero-total
  paid status, and behavioral regression tests.
- Service database-row type correction without changing its behavior.

Parent verification after all workers froze their files:

- npm run test: 39 tests passed across five files.
- npm run lint:desktop: passed.
- npm run typecheck:desktop: passed.
- npm run build:desktop: passed.
- npm run build: passed, including login/install route prerendering.
- git diff --check: passed.

The native storage worker completed read-only API inspection and made no edits.
The request to promote existing sqlx 0.8.6 to a direct Rust dependency and add
the matching Vitest V8 coverage package remains unanswered. Native rewrite and
coverage measurement are waiting on that response. No 100% coverage claim is
made. The current Tauri config still points at the old web build.

Not yet completed: native atomicity/restore fixes, isolated app/DMG packaging,
installation, installed-app end-to-end tests, commit, push, PR, remote CI, and
automatic Codex review. Never infer these stages from frontend checks.

## Dependency approval

The user approved both dependency changes on 2026-10-06.
@vitest/coverage-v8 3.2.7 is installed. Native and repository workers now have
edit clearance for their exact file allowlists. The desktop business-logic
coverage gate requires 100% statements, branches, functions, and lines.

## Implementation review reconciliation

The read-only Luna implementation review identified these additional cases:

- Raw SQLite REAL payment sums can misclassify decimal-cent payments. Use
  consistent cent rounding for stored amounts, status comparisons, and balances;
  cover fractional creation, payments, and voids with real SQLite tests.
- Refuse UI mutation calls after staging a restore, while retaining the native
  guard. A successful restart applies the pending file before initialization;
  rejected restores surface an initialization error before showing the workspace.
- Force a late statement failure and verify that the entire order, related
  records, audit, and sequence roll back. Mocked IPC contract tests do not replace
  native SQLite transaction tests.
- Native migration must seed and repair a stable device identifier. Repeated
  settings reads must preserve it.

Parent integration review also found the settings form submitting immutable
device_id and the order form discarding negative initial payments. The form now
submits only editable settings and validates the initial payment before elision.
These UI paths remain subject to installed-app acceptance.

The native implementation review required full schema-contract validation and
recovery from an invalid staged snapshot. Preserve/quarantine rejected snapshots,
open only a verified original database, and expose a nonfatal warning. Compare
required canonical schema objects, including their constraints and indexes;
reject unexpected triggers. Test these paths with real SQLite fixtures.

The generic SQL bridge retains the approved trusted-bundled-renderer boundary.
CSP reduces remote injection, and read-only connections/statement scanning keep
transaction ownership in Rust. The PIN is a screen lock; it does not authorize
database commands. Typed native domain commands would narrow renderer authority
but move/duplicate the currently tested TypeScript business layer. Any future
remote content or renderer extension requires revisiting that architecture.
React view and native runtime verification remain separate evidence.
The standalone desktop entry replaces the previous App.tsx runtime switch,
so the web App.tsx returns to its original integration path.

## Final local acceptance checkpoint, 2026-10-07

The clean Node.js 22 workflow passed: locked install, 72 existing tests,
85 desktop tests with 100% statements/branches/functions/lines, desktop lint,
typecheck, desktop build, and legacy web build. Native formatting, 58 tests,
and Clippy passed. Native coverage remains below the requested floor:
92.39% lines, 88.19% regions, and 67.21% functions, with no exclusions.

The rebuilt isolated Review app was installed and personally tested. Native
printing displayed a receipt preview. Native restore Cancel created no pending
file. Confirmed staging blocked writes; reopening restored the selected baseline
and preserved the pre-restore marker in a safety snapshot. Independent SQLite
integrity, foreign-key, and record assertions passed. Detailed observations and
limits are in `docs/DESKTOP_ACCEPTANCE.md`.

Publication will use draft status while native coverage remains below 100%.
No exception to that requirement has been inferred. Ready-for-review status
and its automatic Codex review cycle remain pending that boundary.
