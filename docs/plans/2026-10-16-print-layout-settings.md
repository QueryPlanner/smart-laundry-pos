# Print layout and content settings plan

## Goal

Make the customer bill use the full usable width of an A4 landscape sheet, keep every TSC garment tag inside the printable width with a clear blank area for cutting, and let an administrator choose the shop identity and optional print content from the app.

## Baseline before implementation

- Bills are saved as structured `BillDocument` records. The shop name, address, phone and footer are copied into the saved bill, so bill reprints preserve the original identity.
- Windows draws the shared `print_layout` output through GDI. It currently uses the printer driver's reported page dimensions and does not request landscape orientation.
- Linux sends plain text to CUPS, requests A4 or `Custom.50x50mm`, and asks CUPS to fit the text page. It does not request landscape and does not share Windows' font sizing or wrapping. The connected `TSC_TE244_Test` queue reports `PageSize=Custom.50x101.6mm`; the user confirmed the stock is a continuous 50 mm roll and wants the app to choose the tag cut length.
- Tag layout allows about 6 pt (2.1 mm) at each horizontal edge. The current 50 mm media configuration does not leave a deliberate scissor margin between tag contents.
- Admin > Shop settings already saves shop name, address, phone, receipt footer and bill number prefix in the existing key/value settings table.

## Planned changes

1. **A4 landscape bill layout**
   - Request landscape explicitly for bills on both Windows and Linux; keep tags in portrait orientation on the 50 mm-wide roll.
   - On Windows, set landscape in a copied printer `DEVMODE`/print ticket before creating the device context, preserve the selected A4 media and other driver settings, then verify that the reported printable area is landscape before creating a spool job.
   - Extend the shared layout model with positioned text or column cells. Use the full landscape width for a compact header/order/customer area, line items with distinct quantity/rate/amount columns, and an aligned totals/ready-by area. Keep left/right bounds explicit.
   - Replace Linux's current plain-text-only path with a structured renderer for the same positioned layout, submitted to CUPS with A4 landscape options. Test both the generated layout and CUPS orientation options; rotating the current plain text alone is insufficient.
   - Derive usable dimensions from the selected printer/page and keep printer-safe outer margins. Preserve pagination for unusually long bills.

2. **Safer TSC tag layout**
   - Treat 50 mm as the confirmed continuous-roll width. Add an administrator setting for the per-tag feed/cut length, defaulted to the connected queue's current 101.6 mm. Do not infer that width is also height.
   - Pass `Custom.50x{configured length}mm` to CUPS and configure matching custom media dimensions in the Windows print request, while leaving the TSC queue on continuous stock.
   - Use smaller starting type, wrap or reduce text before it reaches the edge, and reserve at least 3 mm at both horizontal edges. Reject a reported printable width that cannot preserve those insets.
   - Reserve a 4–5 mm blank cutting band at the trailing edge of each tag page, within the configured feed length, and keep a small top inset on the next tag. Verify a multi-tag run leaves a scissor-safe gap at each cut. Do not add barcodes, customer details or dates.
   - Keep the bill/order reference, garment and service, piece position/count, and internal piece ID visible on every tag.

3. **Admin print-content settings**
   - Extend Admin > Shop settings with a preview and simple controls for optional bill fields (shop address/phone, customer phone, received timestamp and ready-by time), tag branding (shop name and a short optional tag line), and tag cut length in millimetres.
   - Keep the shop name and bill footer editable; retain the financial rows and core garment/order identifiers as required fields so a setting cannot make a bill or tag unusable.
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

- Implemented the shared positioned A4 landscape bill layout, Linux Cairo PDF renderer, Windows landscape/custom-media DEVMODE requests, TSC side insets and 5 mm cut band, and admin print-content snapshots. The Windows GDI renderer now honors each positioned line's `x_pt`.
- `npm run test:desktop`: 410 passed across 30 files. Desktop typecheck and lint passed. `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` and `git diff --check` passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 230 passed, one timing-sensitive background-backup test failed under concurrent CPU load, and two tests were ignored. Rerunning the one failed test alone passed; all print-layout, printing, and shop-settings tests passed.
- The Windows GNU check was attempted, but the host lacks `x86_64-w64-mingw32-gcc`, required to build bundled SQLite. The Windows adapter has not run on Windows.
- `npm run tauri:build:linux-review` completed after the Windows GDI positioned-x fix. The Linux UI run used isolated XDG directories, a synthetic admin/customer, and the connected `LBP2900` and `TSC_TE244_Test` queues. UI-created order `LA-2026-00002` submitted completed jobs `LBP2900-45` and `TSC_TE244_Test-46`. Captures were one A4 landscape bill page (841.89 × 595.28 pt) and three tag pages (141.732 × 288 pt, 50 × 101.6 mm); tags contain only bill reference, garment/service, piece position and ID. The PDFs were rendered and visually inspected. The Shop settings numeric cut-length control was visible, but the AT-SPI/XTest input attempt did not change its default 101.6 mm value; cut-length editing is covered by automated validation/settings tests, but an app-level changed-value print remains unverified. CUPS completion does not prove physical paper alignment. Windows build and physical acceptance remain required.
