# Print layout and content settings plan

## Goal

Make the customer bill use the full usable width of an A4 landscape sheet, keep every TSC garment tag inside the printable width with a clear blank area for cutting, and let an administrator choose the shop identity and optional print content from the app.

## Baseline before implementation

- Bills are saved as structured `BillDocument` records. The shop name, address, phone and footer are copied into the saved bill, so bill reprints preserve the original identity.
- Windows draws the shared `print_layout` output through GDI. It currently uses the printer driver's reported page dimensions and does not request landscape orientation.
- Linux sends plain text to CUPS, requests A4 or `Custom.50x50mm`, and asks CUPS to fit the text page. It does not request landscape and does not share Windows' font sizing or wrapping. The connected `TSC_TE244_Test` queue reports `PageSize=Custom.50x101.6mm`; the user confirmed the stock is a continuous 50 mm roll and wants the app to choose the tag cut length.
- The user physically confirmed text should start 10 mm from the 50 mm roll's left edge, with about 3 mm at the right. A single-tag test confirmed that 10 mm of extra trailing feed leaves adequate cutting room.
- Admin > Shop settings already saves shop name, address, phone, receipt footer and bill number prefix in the existing key/value settings table.

## Planned changes

1. **A4 landscape bill layout**
   - Request landscape explicitly for bills on both Windows and Linux; keep tags in portrait orientation on the 50 mm-wide roll.
   - On Windows, set landscape in a copied printer `DEVMODE`/print ticket before creating the device context, preserve the selected A4 media and other driver settings, then verify that the reported printable area is landscape before creating a spool job.
   - Extend the shared layout model with positioned text or column cells. Use the full landscape width for a compact header/order/customer area, line items with distinct quantity/rate/amount columns, and an aligned totals/ready-by area. Keep left/right bounds explicit.
   - Replace Linux's current plain-text-only path with a structured renderer for the same positioned layout, submitted to CUPS with A4 landscape options. Test both the generated layout and CUPS orientation options; rotating the current plain text alone is insufficient.
   - Derive usable dimensions from the selected printer/page and keep printer-safe outer margins. Preserve pagination for unusually long bills.

2. **Safer TSC tag layout**
   - Treat 50 mm as the confirmed continuous-roll width. Add an administrator setting for the per-tag pitch, defaulting to 30 mm for new installations. Preserve 101.6 mm as the fallback for legacy tag documents and keep the pitch in each snapshot.
   - Pass `Custom.50x{configured length}mm` to CUPS and configure matching custom media dimensions in the Windows print request, while leaving the TSC queue on continuous stock.
   - Use smaller type and asymmetric 10 mm left / 3 mm right insets, wrapping or reducing text against the usable width.
   - Render each batch on one continuous strip with one pitch per piece and exactly one 10 mm extra feed after the physical final tag. Preserve the TSC's reverse delivery order so Piece 1 exits last, and verify this ordering in the multi-tag layout and spool output. Do not add barcodes, customer details or dates.
   - Keep the bill/order reference, garment and service, piece position/count, and internal piece ID visible on every tag.

3. **Admin print-content settings**
   - Extend Admin > Shop settings with editable laundry name/address/phone, centered bill message, multiline footer/terms, optional bill fields, tag branding and configurable pitch.
   - Match the supplied sample's centered identity, order/customer/date/ready-by and payment summary, full-width Particulars/Service/Qty/Rate/Amount table and piece/totals/footer using only fields present in the order model.
   - Default new settings to today's printed behavior. Save settings through the existing admin-only, audited `app_settings` path; no SQL migration should be needed.
   - Snapshot the chosen content and tag identity into each new saved print document, preserving old documents and making reprints match the original. Missing fields in old bill JSON must reproduce legacy bill content on reprint; old tag JSON must keep the current internal details and default to no added branding.

4. **Tests and operating notes**
   - Add native layout tests for landscape A4 geometry, explicit x/y and column bounds, pagination, long values, tag side insets, reduced font sizes and the blank cutting band. Test CUPS landscape/media options and Windows `DEVMODE` orientation behavior.
   - Add settings tests for defaults, staff denial/admin-only updates, validation, audit changes, save/reload, old payload defaults, snapshots and bill/tag reprints after a settings change; update the Shop settings preview/UI tests and print documentation.
   - Build the Linux review package, run the app through the UI with one synthetic bill and multiple tags, verify the CUPS queues accepted the expected jobs, and physically inspect the bill orientation/full-width columns plus tag right-edge clearance and between-tag scissor space.
   - Run the Windows build/checks available in this environment and explicitly list a real Canon A4 landscape + TSC multi-tag physical check as required after installation on Windows.

## Definition of done

- A normal one-item bill prints on A4 in landscape with full-width columns, passes explicit bounds tests, and does not lose content at the page edge; long bills remain readable and paginate.
- Each TSC tag's text stays within the confirmed 50 mm width and the app-selected feed length, has visible left/right clearance, and leaves a repeatable blank cutting band while retaining the required internal matching details.
- An administrator can change shop identity and optional bill/tag content in the app, preview the result, save it, and see that setting applied to newly created print jobs. Existing saved jobs keep their prior content and remain reprintable.
- Relevant UI/native tests pass, the Linux review app builds and its UI queues the test bill and multiple tags, resulting paper is physically checked, the feature branch is pushed, and the remaining Windows physical verification is documented.

## Proposed branch

`codex/print-layout-settings`, based on the latest `origin/main` after fetching.

## Validation status — 2026-10-16

- User-confirmed setup: 30 mm default tag pitch and one configurable 10 mm trailing feed; legacy saved tag documents without a pitch retain the 101.6 mm fallback. The user physically confirmed the 10 mm tail on a single-tag test. The physical strip test showed Piece 1 exiting last, so the app lays out Piece 1 last in TSC delivery order and applies the extra feed only at that physical trailing end.
- Verification passed: full desktop suite (413/413), desktop typecheck, desktop lint, full native Rust library suite (233 passed, 2 ignored), focused print-layout suite (24/24), Rust formatting check, and `git diff --check`. The Windows GNU target check could not complete because the environment lacks `x86_64-w64-mingw32-gcc` and `x86_64-w64-mingw32-windres`.
- The Linux review package built successfully. Running the built app with isolated config/data, the UI created a synthetic three-piece Shirt order and submitted one A4 landscape bill to `LBP2900` (job 55) and one 50×100 mm continuous TSC strip to `TSC_TE244_Test` (job 56). The captured PDFs were visually inspected and their page dimensions/text/bounds checked; the tag starts at 10 mm, contains only bill reference, garment/service, piece position/count and internal ID, and includes three 30 mm pitches plus one 10 mm tail. Both queues returned idle after accepting the jobs.
- Paper-level verification remains limited: the single-tag 10 mm tail was physically confirmed by the user, but the current three-tag strip has only been verified through generated PDF and CUPS queue acceptance. Windows physical verification remains outstanding.
