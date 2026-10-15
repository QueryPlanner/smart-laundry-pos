# Delegated implementation tasks: friendly counter POS and Windows printing

Date: 2026-10-15
Status: Approved direction from the owner; work delegated to Luna workers.
Repository: /home/lordpatil/projects/smart-laundry-pos
Starting branch: codex/local-first-macos

## Latest owner decisions (override the earlier plan)

- Tags are internal. Print bill/order number, garment/service, and a stable piece identifier with its position/total. No ready date, barcode, QR code, or scanner workflow is wanted.
- The ready promise remains on the customer bill and POS: received date + 2 calendar days at 17:00 Asia/Kolkata, always.
- Linux is the development environment. Windows is the intended installation platform; Windows packaging and native printing are first-class requirements.
- Canon laser prints bills. TSC TE244 prints N tags for N physical garments, on 50 mm-wide stock.
- The four services are Wash, Iron, Wash + Iron (initial default), and Dry Clean, with supported combinations defined by admin. Include shoes; ironing shoes is unavailable.
- Assets are generated with ImageGen and bundled locally. Do not generate prices or Marathi text inside images.
- Root acts only as planner/reviewer and does not write application code. Root does not inspect or test implementation while any worker is actively working. Workers implement, test, and coordinate with each other.
- No physical printer jobs or modification of the installed business database during automated work. Synthetic isolated databases only. Windows hardware acceptance must be reported honestly as pending unless actually performed.

## Preserve the working copy

There are pre-existing uncommitted desktop/Linux/receipt changes. Preserve them. No git reset, clean, checkout of old files, or destructive database operations. Workers share the working tree; edit only owned files. Do not commit or push. No additional agents without explicit owner authorization.

## Shared integration contract

The foundation worker owns src/lib/localFirst/counter.ts and all shared business types. It must publish the final API shape promptly to the other two workers. Prefer one typed counter API with these responsibilities:
- Named login/setup/lock/staff management, backed by a native-owned session.
- Read garment catalogue, four service methods, and admin-configured prices.
- Quote/save a counter order using garment/service IDs and whole quantities, without accepting staff-supplied prices.
- Retrieve saved physical pieces and print jobs.
- Set printer profiles, enumerate printers, dispatch/retry pending output.
- Manual piece matching for packing/pickup, with no scanner dependency.

The printing worker owns src-tauri/src/printing.rs and src/lib/localFirst/printDocuments.ts plus tests. It publishes a small native interface for enumerate_printers and submit_document, and a deterministic output contract for bill/tag documents. It does not own or change database records or auth; foundation integrates these functions through authenticated domain commands and persisted jobs.

The UI worker owns LocalFirstApp.tsx, LocalFirstApp.test.tsx, UI components it creates, src/index.css, and generated public/garments assets. It uses the real typed counter API; no final mock-only path or invented rates. It must coordinate API details directly with foundation and document needs early.

For any cross-owned file, request a precise edit from its owner or obtain an explicit handoff. Foundation owns lib.rs and Cargo.toml; printer worker supplies exact integration/dependency requests rather than changing them concurrently. Printer worker owns Windows config/CI and build scripts; avoid changing existing Linux/macOS configuration except additive compatible changes.

## Task A — Local business foundation, roles, rates, and durable jobs

Owner: Luna foundation worker.
Files: src/lib/localFirst business/data code and its tests, src-tauri migrations, storage/auth/business modules, lib.rs, Cargo.toml/Cargo.lock, native tests. Excludes printDocuments.ts/printing.rs and their tests.

Implement:
1. Real versioned upgrade migration from the installed v1 schema, preserving old records and backup/restore compatibility.
2. Admin/staff accounts, named login, PINs, lock/logout, admin staff creation/deactivation/reset. Native session authorization; do not trust a renderer role or arbitrary user ID.
3. Garment/service catalogue and rates. No fabricated production prices. Unconfigured combinations cannot be sold. Historical orders retain snapshots.
4. The fixed 17:00 IST two-calendar-day promise, independent of OS timezone.
5. Transactional save with physical garment IDs, price snapshot, optional payment, and independently persisted Canon/TSC output requests. Whole counts, safe reprint identities, no duplicate orders on retry.
6. Printer configuration, durable queue state, dispatch adapter integration, and safe uncertain-output handling. No public bill URLs.
7. Manual piece matching that detects wrong order, duplicates and missing pieces before full pickup.

Definition of done:
- Expose working, documented APIs consumed by UI and printing.
- Test v1 migration and restore without losing historical money/order/account data.
- Demonstrate native rejection of staff price/role/SQL bypass attempts and admin-only configuration writes.
- Test due-time boundary cases, fixed old-order prices, missing rates, piece counts, transactional failure, reprint identity and print recovery.
- Existing relevant business/native tests continue to pass or are deliberately updated for changed behaviour; do not remove coverage obligations or weaken tests just to pass.
- Provide exact commands/results and known remaining limitations. Preserve the legacy web path.
- New staff cannot use unrestricted SQL as an alternative route to protected business changes.

## Task B — Windows-first printers, internal document formats, packaging

Owner: Luna printing worker.
Files: src-tauri/src/printing.rs and focused tests, src/lib/localFirst/printDocuments.ts and focused tests, new platform-specific helper files, Windows review config, .github/workflows/desktop.yml, package.json build scripts, printing/Windows documentation. Coordinate additions to native manifest/lib.rs with foundation.

Implement:
1. Query actual installed printer queues. Select Canon and TSC by saved profile, not by changing the system default.
2. Windows spooler route for TE244 tags and Canon bills, plus a working Linux development adapter. Verify official platform/printer APIs as needed.
3. Deterministic 50 mm tags with bill number, garment/service, stable piece ID and position/total only. No due date, customer contact, barcodes, QR or scanning.
4. Canon A4 bill including correct prices, customer-facing due date/time, payment/balance and physical count.
5. Safe handling of long names and required fonts; never inject customer text into shell commands or printer control syntax.
6. Clear queued/submitted/error/uncertain distinctions and OS job identifiers. A spooler's acceptance does not prove physical output. Retries must not blindly replay uncertain submissions.
7. A Windows installer/review config and CI build/test path that can validate Windows-specific code. Include driver/profile setup, 50 mm calibration, disconnected/paper-out recovery, and a Windows physical acceptance checklist.

Definition of done:
- Real OS-specific submission code integrated via foundation; a document preview or opening a print dialog alone is insufficient.
- Unit/adapter tests for content, sizing, injection/escaping, routing, failure and uncertain submission.
- Linux checks pass; Windows-specific code has compile/build validation where available. Clearly report if Windows runner/hardware was unavailable; do not claim a Windows test occurred.
- Existing Linux/macOS paths remain supported without introducing fabricated support.
- Document physical Windows Canon/TSC acceptance as a release gate until the actual target machine is tested.
- Report exact test commands/results and dependencies. No automatic real-paper tests in this task.

## Task C — Counter interface and ImageGen garment assets

Owner: Luna counter UI worker.
Files: src/pages/LocalFirstApp.tsx and tests, src/index.css, new desktop UI components/tests, public/garments images and manifest/prompt documentation. Do not edit shared business/native/printing files.

Implement:
1. Named staff login and an obvious Admin entry; staff landing screen is New Order. Admin controls remain accessible only to admin. Preserve existing admin panels.
2. Inline mobile lookup/new customer entry.
3. Four service selectors with Wash + Iron default; mixed-service orders preserve previously added garments.
4. Large ImageGen garment tiles, tap-to-add, repeated tap increment, independent minus/plus and quantity entry; multiple categories supported.
5. Fixed-rate read-only prices; unsupported/unconfigured combinations visibly unavailable. Shoes cannot be ironed.
6. Persistent summary showing count, price, payments/balance and +2 calendar days at 17:00 IST.
7. Save & Print invokes transactional save and actual persisted queue dispatch; separate Canon bill and TSC tag progress, clear recovery and targeted reprints.
8. Admin staff/rate/printer controls through the real API.
9. Manual piece checklist/identifier matching at packing/pickup; no barcode or scanner interface.
10. Generate the approximately 19 garment assets listed in the earlier plan using the ImageGen skill and built-in tool. Use consistent individually saved illustrations, no embedded labels/prices, local bundled assets, accessible code-rendered Marathi/English text, and fallback labels.

Definition of done:
- Interactive tests cover repeat tapping, minus/plus, mixed services, missing rates, shoe restrictions, fixed promised time, staff/admin visibility, saved/retry feedback and manual matching.
- Desktop typecheck/lint/build and relevant UI tests pass; avoid regressions in existing admin workflows.
- Generated images are present in the project and actually used. Report source prompts/tool/output paths; do not claim generated assets if generation is unavailable.
- UI integrates the actual foundation API and printing state; no hard-coded demonstration rates or fake printed-success messages.
- Provide exact commands/results and remaining limitations.

## Review and correction protocol

1. Launch all three workers with their explicit scope and definition of done.
2. Root waits while any worker is active. Workers coordinate dependencies directly.
3. When all workers are finished/idle, root reads changes and runs review checks. Root writes no application code.
4. Root sends concrete review findings back to the responsible worker(s); waits again while corrections are made.
5. Repeat until the implemented scope is verified, or report a precise external limitation (such as lack of Windows hardware), without claiming full production readiness.
