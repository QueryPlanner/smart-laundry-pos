# Printing: setup and document contract

The app prints two things for every saved order: a customer bill on a Canon laser printer (A4) and one tag per physical piece on a TSC TE244 label printer (50 mm stock). Admin saves one Windows queue for each in Admin > Printers. The app sends documents to those queues through the operating system and never changes the Windows default printer.

Important limits, stated once here:

- The Windows adapter now requests landscape A4 bills and a custom 50 mm-wide tag page through the Windows printer driver. It has not yet been run on Windows or physically tested there; Linux output does not prove Windows output.
- "Submitted" means the operating system's spooler accepted the job. It does not prove paper came out. Paper-out, jams and a switched-off printer after that point are not reported back to the app.
- Linux uses the same positioned layout as Windows, renders a PDF and sends that PDF through CUPS. Linux is a development aid only.

The release checklist for real hardware is in [DESKTOP_ACCEPTANCE.md](DESKTOP_ACCEPTANCE.md). The shop owner's guide to the screens is in [OPERATIONS.md](OPERATIONS.md).

## Printer setup on the Windows laptop

1. Install the Windows driver for the exact Canon model from Canon's support site and connect the printer. In the driver preferences set the paper size to A4 and copies to 1. The app requests landscape for each bill but does not bundle drivers.
2. Install the TSC TE244 Windows driver from the [TSC downloads page](https://in.tscprinters.com/en/downloads). The queue must show as ready in Windows.
3. In the TSC driver preferences set the loaded stock to a 50 mm-wide continuous roll, copies to 1, and the correct darkness. Calibrate the media sensor with the roll loaded, following [TSC's TE-series instructions](https://apac.tscprinters.com/en/products/te-series-4-inch-performance-desktop-printers). The app requests a custom page whose length is set in Admin > Shop settings; the driver must accept custom 50 mm × selected-length media. The app sends drawn text through Windows and never sends TSPL or other printer commands.
4. In the app, sign in as admin, open Admin > Printers, press "Refresh printer list", choose the Canon queue for bills and the TE244 queue for tags (they must be different queues), and press "Save printers". Saving checks that each queue is currently listed as available.
5. Print a test order (see the checklist) and inspect it before real use.

The two drop-downs on the Printers tab offer only queues the app considers available; the list underneath shows every queue and its state. On Windows a queue counts as unavailable when its status includes any of: paused, error, pending deletion, paper jam, paper out, paper problem, offline, not available, user intervention or door open, or when the queue is set to "Use Printer Offline". A queue that is only busy or printing counts as available, because it still accepts the next job. Saving the two choices is refused if both are the same queue.

The app reads each queue's current Windows `DEVMODE`, preserves the other driver settings, then asks the driver for landscape A4 for a bill or portrait custom 50 mm × batch-strip length for tags. A tag batch uses one continuous strip whose length is the configured pitch multiplied by its piece count, plus one 10 mm feed after the physical final tag. It verifies the resulting printable area before creating a spool job. Copies and darkness remain driver settings, so keep copies at 1. If the TSC driver refuses the requested custom media, the app fails before spooling.

The app finds queues with `EnumPrintersW` (local and connected queues), opens a device context for the chosen queue, and uses `StartDocW`/`StartPage`/`TextOutW`/`EndPage`/`EndDoc`. Text is drawn with the Segoe UI font. Customer text is drawn as text; it is never put into a shell command or printer language. I have not tested how names in scripts that Segoe UI lacks (for example Devanagari) print; the bills and tags are designed for English text.

## How a print job moves

Saving an order writes the order and two print jobs (bill, tags) in one database transaction, each in state `pending`, then tries to print them right away. Each job has its own state:

| State | Meaning | What the operator does |
| --- | --- | --- |
| `pending` | Saved, not yet sent. Also what you see if printers were not configured or the app closed before sending. | Press "Resume" in the print queue. |
| `submitting` | Being sent now. | Wait. |
| `submitted` | The spooler accepted the document. The Windows job number is stored. | Nothing, unless paper did not come out; then look at the Windows print queue. |
| `failed` | The app knows nothing was sent. | Press "Retry". Safe. |
| `uncertain` | The app cannot tell whether something was sent. | Look at the printer and the Windows queue first. Then use the explicit confirmation step to send again. |

### Layout happens before the spooler is involved

On Windows the document is validated and laid out in full before a spool job exists. Anything wrong with the content or the page is found at that point, so the result is `failed` (certain, nothing sent), not `uncertain`. Examples that fail this way: a bill whose lines do not add up to its subtotal, discount, total and paid amounts; more than 500 tags in one document; a page too small for the bill or the label; a tag printer whose page is wider than about 4.6 inches (the driver is set to a sheet, not the label size); tag text that does not fit even at the smallest size; a printer that is not in the available list; a driver that reports no usable page size; the spooler refusing to start the document.

Once the spooler has started the document the rules are:

- A failure before any page has been finished (starting a page or drawing text) aborts the document and counts as `failed`.
- A failure while finishing a page, or after at least one page was finished, aborts the document but counts as `uncertain`, with the message saying how many pages were sent.
- If the print thread panics with a document open, the open document is aborted so it does not stay in the spooler.

Layout uses the printer driver's own printable area and font measurements, so wrapping and fit match what the printer will draw. That area comes from the driver's paper or label definition, which is why step 1 and step 3 above matter.

### One submission per printer at a time

Only one submission can talk to a given printer queue at a time. If an earlier submission timed out but its thread is still running, a new job for the same queue is refused with "Printer unavailable ... the previous print to this printer is still running". That job is `failed` and can be retried once the earlier one finishes. This stops a late completion printing a second copy behind the operator's back.

### When a job is `uncertain`

A job becomes `uncertain` when any of these happens:

- The send does not finish within the deadline: 120 seconds for a bill, and for tags 120 seconds plus 4 seconds per tag, never more than 30 minutes. The app stops waiting but cannot cancel the work in progress, so the job may still reach the spooler later.
- The print worker stops unexpectedly.
- Windows fails while finishing a page or after a page was sent, or the spooler's final status is lost after the last page.
- The app was closed or crashed while a job was `submitting`. The next start marks those jobs `uncertain`.

Retrying an `uncertain` job needs two steps in the app: "Review uncertain job", then "Confirm reprint". The native code refuses a retry of an uncertain job without that confirmation, and checks and changes the state in one step so a double click cannot queue it twice. A retry sends the whole saved document again. For a tags job that means every tag in the order, so the screen tells the operator to use "Reprint selected tags" for just the missing pieces instead, which creates a new job. Bills can be reprinted whole. Reprints are open to staff as well as admin. If a reprint was saved but did not print, the screen says so and keeps the request, so asking again for the same selection resumes it rather than creating another.

## Document contract

### Bill (Canon, A4 landscape)

The app requests A4 landscape and uses a 24 pt (about 8.5 mm) safe margin. The configurable laundry name, address, phone and optional message are centered above the order details. The bill number and received time share a row; customer and optional phone, ready-by time, payment summary, piece count, and a full-width table with Particulars, Service, Qty, Rate and Amount follow. Totals and configurable multiline footer/terms finish the bill. Text and rules are positioned against measured printer-font widths; long values wrap, and totals move to another page when needed.

Admin > Shop settings lets the admin choose whether the shop name, address, shop phone, customer phone, received time and ready-by time appear, and set the centered message and multiline footer/terms. The order number, customer name, garment and service rows, piece count, totals and payment remain on the bill. Shop identity, message, footer and visibility choices are copied into each new bill so reprints retain their original content. Old bills keep the legacy visible fields. A bill saved before shop settings existed prints the built-in title "SMART LAUNDRY" and footer "Thank you". An existing installation starts with "Smart Laundry" and "Thank you for choosing us." until the admin edits them.

A bill longer than one page continues on further pages headed "Bill: NUMBER (continued)", up to 50 pages. A bill that would need more fails with an error.

The bill must pass a money check before printing: every line total equals unit price times quantity, the lines add up to the subtotal, the discount is between 0 and 100% and not above the subtotal, and paid plus balance equals subtotal minus discount.

### Tags (TSC, 50 mm wide continuous roll)

One continuous strip contains the tags for a batch, so a bill with N pieces prints N tag positions (a pair of shoes is one piece). The 30 mm default pitch is configurable from 30–200 mm. The batch adds a single 10 mm trailing feed after the piece that physically exits last; the current TSC output order makes Piece 1 exit last. Each tag shows only:

```
Bill LA-2026-00123
Shirt
Wash + Iron
Piece 3/5
ID 2600123-3
```

The ID is two digits of the year, the bill's sequence number and the piece position, for example `2600123-3`. Tags show no customer name, phone number, date, barcode or QR code. The admin may add the shop name and a short tag line. Text starts 10 mm from the roll's left edge and keeps about 3 mm clear at the right edge. The configurable pitch and shop branding are saved with each new tag document; old saved tag documents retain their prior 101.6 mm fallback.

The tag layout uses smaller type and checks each piece's text against the configured pitch; the piece ID remains at least 8 pt. It rejects text that cannot fit, a page narrower than about 21 mm, a pitch below the supported range, a strip exceeding the printer's signed page-length limit, and any reported width wider than about 4.6 inches. A document holds at most 500 tags.

### Linux (development only)

The Linux adapter finds queues with `lpstat`, renders the shared positioned layout to PDF with Cairo, and sends it to the selected queue. Bills use landscape A4 (`media=A4`, `orientation-requested=4`); tags use `Custom.50x{cut length}mm` in portrait. The layouts, wrapping, pagination and fit checks are shared with Windows, but physical Linux output still needs its own inspection and does not prove Windows output. The Linux queues are chosen in the same Admin > Printers screen.
