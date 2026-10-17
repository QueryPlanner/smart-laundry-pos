# Advance payments, daily bill IDs, tag changes and Orders / Pickup redesign

Date: 2026-10-17. Status: REVISION 2, awaiting owner approval. Nothing has been implemented.
Revision 2 folds in an independent adversarial review (2 blockers, 11 major findings, all verified or
accepted below) and a design brainstorm for the Orders / Pickup screens.

**Revision 3 (owner decision, supersedes the delivery sections below).**
- Everything ships as **one PR** on `feat/advance-payments-daily-bills-pickup`, with the version bumped
  to 0.3.0. "PR1" to "PR4b" below are now **work areas**, not separate PRs.
- Schema is **one migration, `004`, schema version 4**: it contains the day sequence table, `payments.kind`
  and `order_pieces.tagged`. Wherever the text says migration 005 / 006 or v5 / v6, read 004 / v4.
  The version-aware schema contract (A8) still applies and is tested for v3 -> v4 upgrade and restore.
- All code is written by small-model (Haiku) agents in parallel waves, each in its own git worktree with
  disjoint files; the lead reviews every diff, merges, and runs the full gate. Section 6 is superseded.

## 1. Requests

1. Tags also print the customer name and phone number.
2. Payment is no longer assumed up front. The customer pays any advance, including nothing, and the
   balance is taken when the clothes are returned. Marking it received must be easy.
3. Dashboard shows advance collected; dashboard and sales graph updated to match.
4. A garment whose service is iron-only gets no tag.
5. Orders / Pickup tab redesigned for simplicity.
6. Bill ID becomes date plus daily sequence (for example `202610170001`).
7. The packing / pickup screen has no Back button; redesign it for ease of use and every scenario.

## 2. Current state (verified in code on `main` at 9151c3d)

| Area | Fact | Where |
|---|---|---|
| Full payment forced | `save_order` rejects anything but payment == total; UI sends `totalMinor` | `counter.rs:1329-1337`, `CounterApp.tsx:196` |
| `payment_status` | Hard-coded `paid` for any initial payment and for no payment | `counter.rs:1504-1521` |
| Cancel | Voids payments, sets `payment_status='unpaid'`, records `refundMinor` in the audit | `counter.rs:~1909-1935` |
| Later payments | `record_payment` supports partial and repeated payments, sets `partially_paid` | `counter.rs:1710-1812` |
| Pickup gate | `collect_order` needs status `ready`, balance 0, every piece matched | `counter.rs:1943-2030` |
| Bill number | `{prefix}-{YYYY}-{seq:05}`, yearly `order_sequences` | `counter.rs:1423-1434` |
| Piece ID | `{YY}{seq:05}-{all-pieces position}`; `short_id UNIQUE` | `counter.rs:1470-1476` |
| Tags | `TagDocument` has no customer fields; a test forbids customer text; fields already use `#[serde(default)]` | `printing.rs:131-170, 1736` |
| Tag layout | Fixed blocks, 4 font steps, error if they do not fit. **The fit test ignores the 14.2 pt top inset.** Default AND minimum tag length is 30 mm (85 pt) | `print_layout.rs:39-44, 691-722`, `shop_settings.rs:46,111` |
| Second tag renderer | `render_lines` (Linux and tests) is separate from the PDF layout | `printing.rs:~671-760` |
| Dashboard / sales | "Collected" is cash-basis (payments by `recorded_at`, refunds by `voided_at`); attention lists already carry `balance_minor`; overdue already defined | `insights.rs:17-20, 817, 1276, 1283` |
| Money storage | `payments.amount` and `orders.total_amount` are REAL rupees; code rounds to minor units per row | migration 001, `counter.rs:1617` |
| Orders / Pickup | Search + cards; detail and pieces pages have no Back; "Packing / pickup" nav item exists only when an order is in memory | `CounterApp.tsx:354-415, 423` |
| **Schema contract** | `validate_schema_contract` rebuilds the expected schema from migrations 001+002 only; start-up and backup validators know versions 0-3 and hit `unreachable!` above that; the pre-upgrade copy is validated against the current contract | `storage.rs:975-980, 1202-1236, 1404-1418, 419-423, 1872-1880` |
| CI | Runs on PRs to `main` and pushes to `codex/**` only | `.github/workflows/desktop.yml:3-8` |
| Coverage gate | Counts `src/lib/localFirst/**/*.ts` and `src/components/localCounter/**/*.tsx`; `.ts` files under `components/` are NOT counted; Rust is not measured | `vitest.desktop.config.ts` |
| Order-number parsing | None anywhere; only display and `LIKE` | grep of Rust and TS |

## 3. Decisions

### 3.1 For the owner (defaults in bold are assumed)

| # | Question | Default |
|---|---|---|
| D1 | Keep the shop prefix in the bill number? | **No. `YYYYMMDD` + 4-digit daily number. The settings input is removed; the stored value and its native validation are left alone and documented as legacy.** |
| D2 | Tag numbering with iron-only pieces | **Tagged pieces get positions 1..T first; untagged pieces get T+1..N. Tag label "Piece n/T" and ID suffix `-n` then always agree, with no gaps.** |
| D3 | Advance field default on New order | **Empty (= nothing now) with chips Nothing / Half / Full** |
| D4 | Slip after the balance is paid | **No new slip. A bill reprint rebuilds its payment block from live payments, so it never says "Balance due" for a settled order.** |
| D5 | Part-order or several-orders-at-once handover | **Not supported (all-or-nothing per order). Please confirm: you said "every scenario".** |
| D6 | "Tick all" at pickup | **Allowed as a secondary button** |
| D7 | Customer arrives and a piece is lost or missing | **No in-app resolution in this work. The only exit is an admin cancel, which voids all payments. Please confirm or ask for an admin "settle without piece" action.** |
| D8 | Phone on the tag | **Always printed. No toggle.** |
| D9 | Who writes the code | **See 6. Lead does the Rust money, migration, layout and handover work; small-model agents do the contained UI packages.** |

### 3.2 Architectural decisions

- **A1. `payments.kind` column.** `advance` or `settlement`, explicit. Historical rows are backfilled by
  `recorded_at = orders.received_at` (exact for counter orders, since `save_order` binds one timestamp to both);
  v1 rows default to `settlement`. Affects only the split of old data, never totals.
- **A2. `payment_status` derived in one helper.** Cancelled stays `unpaid`; total 0 or paid == total is `paid`;
  `0 < paid < total` is `partially_paid`. Exposed on the API; the UI still decides from `balanceMinor`.
- **A3. Daily sequence table** `order_day_sequences(day TEXT PK, next_number INTEGER)` keyed by IST date.
  `order_sequences` stays, unused.
- **A4. Piece `tagged` flag** (`CHECK (tagged IN (0,1))`, default 1). Iron-only pieces keep a row and
  an internal ID, so counts, packing and pickup matching stay uniform.
- **A5. Order-list filters run natively** (the list pages at 50).
- **A6. Pickup ticks are session-local; packing ticks persist.** Pickup calls collect once.
- **A7. Atomic receive-and-collect.** `counter_collect_order` accepts an optional payment applied in the
  same transaction, removing the "paid but not handed over" state.
- **A8. Schema contract becomes version-aware (PR1, lead-only).** See PR1.
- **A9. Advance/balance split is net per kind.** Collected by `recorded_at`, refunded by `voided_at`,
  attributed to the voided payment's kind, so a cancelled order's advance does not stay in "Advance collected".
- **A10. Pure logic and hooks for the Orders screens live in `src/lib/localFirst/orders/`**, which is inside
  the 100% coverage gate. Only components live under `components/localCounter/orders/`.

## 4. Delivery: five stacked PRs

One feature per PR. Each PR passes the full local gate (below) before it is opened.
**CI caveat:** CI only runs for PRs targeting `main`. A stacked PR is therefore opened against `main`
after its parent merges (rebased), or its branch is named `codex/...` so pushes run CI. The gate is also run
locally and the output recorded in the PR.

| PR | Scope | Schema |
|---|---|---|
| PR1 | Daily bill and piece IDs + version-aware schema contract | v4 `order_day_sequences` |
| PR2 | Advance payments, payment kind, dashboard, sales graph, bill wording, live-payment reprint | v5 `payments.kind` |
| PR3 | Tag customer name/phone, iron-only no tag, tag-fit fix | v6 `order_pieces.tagged` |
| PR4a | Native order-list API, atomic collect, payment and refund fields | none |
| PR4b | Orders / Pickup UI | none |

Local gate for every PR: `npm test`, `npm run test:desktop:coverage`, `npm run lint:desktop`,
`npm run typecheck:desktop`, `npm run build:desktop`, `npm run build`, and from `src-tauri/`:
`cargo fmt --all -- --check`, `cargo test`, `cargo clippy --all-targets -- -D warnings`.

### PR1: daily bill IDs and the schema contract

Schema contract (blocker found in review, done first)
- Replace `include_v2: bool` in `validate_schema_contract_version` with `contract_version(conn, v)`,
  building the expected schema from every migration at or below `v` (003 is data-only, so v2 and v3 share
  a contract).
- Pre-migration validation and `preserve_before_upgrade` use the database's own detected version;
  post-migration validation uses `SCHEMA_VERSION`.
- `validate_database_pool` gets explicit arms for 2, 3, 4, 5, 6 and no `unreachable!`.
- `REQUIRED_TABLES` becomes version-keyed (or new columns are checked only post-migration).
- `storage_tests.rs` `create_schema_file(_from_sql)` gets `version >= 4/5/6` branches so tests that pass
  `SCHEMA_VERSION` do not silently build a stale schema.
- New tests: real v3 -> v4 upgrade with the pre-upgrade copy; restore of a v3 backup into the new app;
  backup and restore of a v4 database; refusal of the next unknown version. PR2 and PR3 extend the same
  tests to v5 and v6.

Numbering
- Bill `YYYYMMDD` + `NNNN` from the IST date (same `+19800` as today); resets each IST day; widens past
  9999 without breaking uniqueness (`UNIQUE order_number` is the backstop). Piece ID
  `YYMMDDNNNN-position`. Cannot collide with old 7-digit IDs.
- Migration 004 + `MIGRATION_V4_SQL` + step entry + `SCHEMA_VERSION = 4`.
- Settings page: remove the prefix input and sample; keep passing the stored value through.
- Search keeps working for old and new numbers.
- Docs: `DESKTOP.md` (migration list, pre-upgrade versions "v1 and v2 so far"), `OPERATIONS.md` (lines
  41, 70, 101, 113, 119; add a note that restoring a same-day older backup can re-issue numbers already
  printed on paper).
- `demo_seed.rs` updated so seeded bills carry realistic dates and sequences.
- Tests: sequence increments; resets on a new IST day; 23:59/00:00 IST boundary; uniqueness; old orders
  still found; do not assert monotonic order across midnight (the timestamp is read before the writer lock).

### PR2: advance payments, dashboard, graph

Native
- `save_order` accepts payment `0..=total`; no payment row at 0; remove the full-payment guards;
  status through the A2 helper.
- Migration 005 with `payments.kind` (`CHECK` in `advance|settlement`, default `settlement`) and the A1
  backfill; contract and tests extended to v5. `save_order` writes `advance`; `record_payment` writes `settlement`.
- Bill: add an "Advance paid" label when balance > 0 ("Balance due" already prints). Bill reprint rebuilds
  the payment block from live payments and keeps the header snapshot (D4).
- `insights.rs`: summary gains `advance_collected_minor`, `balance_collected_minor`,
  `advance_refunded_minor`, `balance_refunded_minor` (`collected_minor` stays the total); series points
  gain the same four; `DashboardOverview.receivable { orders, minor }` = balance of open, non-cancelled
  orders **that have pieces** (reuse the existing `EXISTS order_pieces` predicate so legacy v1 orders never
  show a stale balance), summed per row on integer minor units, never as a float total. Not affected by
  sales filters; the new summary fields have explicit behaviour under narrowing filters (follow
  `profit_minor`: null while a narrowing filter is on, where it would mislead).
- New-order idempotency: the submission hash includes `payment`, so the UI rotates the key whenever the
  advance amount or method changes and no save is known to have been attempted; if the outcome is unknown
  it points to the order lookup (today's behaviour).

Frontend
- `OrderSummary.tsx` and `CounterApp.save`: advance field, chips Nothing / Half / Full, method chips only
  when the amount is above 0, live balance, validation with `parsePaymentAmountMinor`; payment sent only
  when above 0.
- Dashboard: Today and This month add Advance collected, Balance received and To collect; Collected stays
  the net total. In-process table shows the balance.
- `SalesChart`: bars stay Billed; two lines Advance and Balance (net per kind) with a legend; hidden table
  and hover titles carry both.
- Tests: Rust (zero, partial, full, 100% discount, kind written, backfill, status helper incl. cancelled,
  refund attribution, receivable excludes cancelled and legacy, reprint after settlement); TS (advance
  flows incl. key rotation, dashboard cards, chart legend and totals).

### PR3: tags

- `TagDocument` gains `customer_name`, `customer_phone` with `#[serde(default)]`; empty values from old
  payloads are skipped, never rendered as blank lines. The test forbidding customer text is rewritten.
- **Fit fix (blocker from review).** The fit test counts the top inset. Name is a single line truncated
  with an ellipsis at a fixed character cap; phone likewise; limits added to `validate_document`. Drop
  order is deterministic: tag line, then shop name; name, phone, bill, garment, service, piece and ID are
  never dropped. Tests at the 30 mm default with a 100-character name and a long garment such as
  "Gents Kurta Pyjama". Update the second renderer `render_lines` and its tests too.
- Migration 006 `order_pieces.tagged`; contract and tests extended to v6.
- `save_order`: `service_key = 'iron'` (carried on the quote line; never matched by editable name) is
  untagged; positions per D2; excluded from `TagDocument`; **no tags job when T = 0**; `pieces_for_conn`
  returns `tagged`; `CounterPiece` and `CounterSavedOrder` expose it; the reviewed-quote equality check and
  TS types follow the new `QuoteLine` shape.
- Reprint UI lists tagged pieces only and shows "No tags needed" for an all-iron order (native reprint of a
  missing job errors "Saved print document not found").
- Docs: `PRINTING_WINDOWS.md:90` and `DESKTOP_ACCEPTANCE.md:37,117` say tags show no customer name.

### PR4a: native order-list API

- `counter_search_orders(query, offset, limit, filter?)`; filter `ready | balance_due | overdue |
  in_process | today | all`. "Overdue" reuses the existing definition (`promised < now && not ready`).
  All time comparisons use `strftime('%s', ...)` like `insights.rs:89-91`, because stored timestamps mix
  `...Z` and `+00:00` formats.
- **One search rule:** 1 character returns nothing (as today); 2-4 digits list today's bill with that
  sequence first, then the usual bill and phone matches, each result labelled with why it matched; 3+
  digit phone fragments behave as today. Names match. A piece ID resolver accepts `^\d{7,10}-\d{1,3}$`
  (old and new tags) and returns its bill.
- Summary rows gain `paymentStatus`, `overdue`, `untaggedCount`. `counter_order_queue_counts` returns per-segment
  counts and total balance due. `SavedOrder` gains `paymentStatus`, `collectedAt`, `refundDueMinor`
  (cancelled), `payments[]` (`at, method, amountMinor, reference, kind`).
- `counter_collect_order` accepts an optional payment (A7). `match_pieces` rejects cancelled and collected orders.
- New commands registered in `lib.rs`, wrapped in `counter.ts`; the drift guard must pass.

### PR4b: Orders / Pickup UI

- **Orders landing**: work queue. Segment bar with counts (Ready, Balance due, Overdue, In process,
  Today, All); To-collect total; autofocused search; rows with one primary action ("Receive ₹X & hand
  over", "Hand over", "Open", "View"). Balance and overdue use icon plus text, never colour alone.
- **Order detail**: Back (returns to wherever the order was opened from: Orders, Dashboard, Sales,
  Customers or Print queue, so the shell stores the origin); header; stage stepper replacing the status
  `<select>` with one-tap next stage and first-class "Mark ready" (skipping 2+ stages asks to confirm; the
  native layer is forward-only, so there is no undo); money panel with Balance due banner, method chips,
  amount prefilled to the balance, "Part payment" and payment history; packing check card (persisted);
  Reprint, Print status and Cancel (admin) under "More actions", cancel states the refund.
- **Handover screen** (replaces `PieceMatching`): Back; derived steps Garments / Balance / Hand over;
  tag-ID input (Enter ticks); per-piece rows for tagged pieces; one counted row per untagged line;
  readiness panel stating what blocks; one sticky button by state (Receive ₹X, Receive ₹X & hand over,
  Check N more, Hand over, or a disabled reason with "Mark ready now & continue"); success screen with Next
  order.
- Failure handling: payment error inline and balance reload; double tap through single-flight and native
  idempotency; printer problems never block hand-over.
- Structure: pure modules `orderMoney.ts`, `pieceGroups.ts` and hooks `useOrderList.ts`,
  `useOrderActions.ts` in `src/lib/localFirst/orders/` (A10); components `OrdersPage`, `SegmentBar`,
  `OrderRow`, `OrderDetailPage`, `StageStepper`, `MoneyPanel`, `MoreActions`, `HandoverPage`,
  `PieceChecklist`, `UntaggedLine`, `ReadinessPanel` in `src/components/localCounter/orders/`.
  `CounterApp.tsx` loses the order-scoped state, `PieceMatching`, `addPayment`, `loadPieces`,
  `submitMatches` and the phantom nav buttons. The prints page gains Back.
- Tests: table-driven pure modules; `renderHook` for key rotation, single-flight, stale search; props-driven
  components; integration through `CounterApp`; rewrite the affected blocks of
  `CounterApp.flows.test.tsx` and `CounterApp.navigation.test.tsx`.
- Deferred: inline receive on list rows, multi-order or partial handover, change calculator, receipt
  printing, `collectedBy`, admin move-back, write-off, hiding inapplicable stages by service, barcode input.

## 5. Scenario matrix (each needs a test, or is listed as a known gap)

Zero, partial and full advance; 100% discount; balance in two instalments; overpay; zero, negative and
three-decimal amounts; edited advance after a failed save; cancelled order with refund shown; customer
arrives before Ready; wrong or duplicate tag typed; reprint of a lost tag; all-iron order (no tag job);
mixed order (IDs and tag numbers agree); old stored tag payload reprints; double tap on Receive and Hand over;
restart mid-flow; receive-and-collect atomic failure; staff cannot cancel; old-format bills still open and
search; IST midnight bill numbering; 2-4 digit search ambiguity; bill reprint after settlement.
Known gaps (no test, stated in the UI where relevant): piece lost at pickup (D7), marked Ready by mistake
(confirm on skip only, no undo), partial or multi-order handover (D5).

## 6. Execution and who writes what

- One branch per PR. Before parallel work in a PR, the lead commits a **contract commit**: Rust struct
  fields and TS types and function signatures, so packages compile against each other.
- Lead-only (money, migration, native SQL, layout, state machine, shell rewrite): PR1 contract and
  numbering, PR2 native money and insights SQL, PR3 layout/fit and save wiring, PR4a, `HandoverPage`
  state machine, `CounterApp.tsx` integration and test rewrite.
- Delegable to small-model agents with a precise brief; the lead reviews every diff and runs the gate:
  settings UI and fixtures (PR1), insights UI and New-order advance UI (PR2), print UI (PR3), list/row/
  segment bar and the pure modules with their table tests (PR4b).
- An agent package that fails the gate twice is taken back by the lead.
- Real-device check (unit tests cannot establish it): install a review build with synthetic data in a
  separate identifier and database directory; save, print tags at the 30 mm default, pay balance, hand over,
  restart. Windows and the shop printers remain unverified (`docs/DESKTOP_ACCEPTANCE.md`).
- Release afterwards per the release checklist; shops move schema 3 -> 6 in one start-up with one verified
  pre-upgrade copy.

## 7. Risks

- **Schema upgrade** on shop machines: highest-risk item; PR1 contract work plus the v3 upgrade/restore tests
  are its mitigation.
- **Tag fit** at 30 mm: deterministic drop order, truncation, and a real print before release.
- **Backfill** heuristic affects only the advance/balance split of historical data.
- **Search ambiguity:** 2-4 digit queries match today's bill plus phone/bill substrings; results say why.
- **Tag privacy:** customer name and phone appear on garments. Requested by the owner.
- **PR4b size:** rewrites six existing test blocks under the 100% gate; hence the lead-only integration.
- **Same-day restore** can re-issue numbers already on paper (same class of issue as the yearly sequence).
