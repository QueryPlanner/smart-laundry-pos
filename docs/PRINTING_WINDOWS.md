# Printing: setup and document contract

The app prints two things for every saved order: a customer bill on a Canon laser printer (A4) and one tag per physical piece on a TSC TE244 label printer (50 mm stock). Admin saves one Windows queue for each in Admin > Printers. The app sends documents to those queues through the operating system and never changes the Windows default printer.

Important limits, stated once here:

- The Windows printing code type-checks and passes clippy for the Windows target through a stand-in harness that is not in this repository, and CI is set up to compile it on a Windows runner. It has never been run on Windows and has never printed on the Canon or the TSC.
- "Submitted" means the operating system's spooler accepted the job. It does not prove paper came out. Paper-out, jams and a switched-off printer after that point are not reported back to the app.
- macOS has no printing support (the app reports that). Linux printing is a development aid only.

The release checklist for real hardware is in [DESKTOP_ACCEPTANCE.md](DESKTOP_ACCEPTANCE.md). The shop owner's guide to the screens is in [OPERATIONS.md](OPERATIONS.md).

## Printer setup on the Windows laptop

1. Install the Windows driver for the exact Canon model from Canon's support site and connect the printer. In the driver preferences set the paper size to A4. The app does not bundle drivers.
2. Install the TSC TE244 Windows driver from the [TSC downloads page](https://in.tscprinters.com/en/downloads). The queue must show as ready in Windows.
3. In the TSC driver preferences define the label stock that matches the roll (50 mm wide, gap or continuous as the roll requires) and set darkness. Calibrate the media sensor with the roll loaded, following [TSC's TE-series instructions](https://apac.tscprinters.com/en/products/te-series-4-inch-performance-desktop-printers). Set the driver's paper size to that label size and the number of copies to 1. If the driver is left on a sheet size, the app refuses to print tags (see below). The driver owns media setup. The app sends drawn text through Windows and never sends TSPL or other printer commands.
4. In the app, sign in as admin, open Admin > Printers, press "Refresh printer list", choose the Canon queue for bills and the TE244 queue for tags (they must be different queues), and press "Save printers". Saving checks that each queue is currently listed as available.
5. Print a test order (see the checklist) and inspect it before real use.

The two drop-downs on the Printers tab offer only queues the app considers available; the list underneath shows every queue and its state. On Windows a queue counts as unavailable when its status includes any of: paused, error, pending deletion, paper jam, paper out, paper problem, offline, not available, user intervention or door open, or when the queue is set to "Use Printer Offline". A queue that is only busy or printing counts as available, because it still accepts the next job. Saving the two choices is refused if both are the same queue.

The app creates the print context without a device mode, so the driver's own defaults apply: number of copies, orientation, paper or label size and darkness are never set by the app. Check in the Windows printer preferences that the Canon is on A4 and one copy, and that the TSC is on the label size with one copy.

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

### Bill (Canon, A4)

Page margin is 0.5 inch. Text, in order:

- The shop name as the title (bold, 18 pt), then the shop address, then "Tel: <shop phone>" (each only if the admin filled it in). The shop name, address, phone and footer come from Admin > Shop settings and are copied into the bill when the order is saved, so a reprint always matches the first bill even after the settings change. A bill saved before shop settings existed has no saved header and prints the built-in title "SMART LAUNDRY". An existing installation starts with the shop name "Smart Laundry" and the footer "Thank you for choosing us." until the admin edits them.
- Then the bill number, date and time (IST), customer name, and phone if there is one.
- For each line: "Garment - Service", then "quantity x unit price = line total".
- "Pieces:" count, "Subtotal:", "Discount (x%):" with the amount (only when the discount is more than zero), "Total:", "Paid:". "Balance due:" appears only if a balance exists, which does not happen for orders saved by the current counter because payment is always taken in full.
- "Ready by:" the received date plus two calendar days at 5:00 PM IST, then the shop's receipt footer, or "Thank you" when no footer was saved.

Long names wrap, including the shop name, address and footer. Each of those four fields is limited to 200 characters in a bill document (the settings screen allows fewer), and control characters in them print as spaces. A bill longer than one page continues on further pages headed "Bill: NUMBER (continued)", up to 50 pages. A bill that would need more fails with an error.

The bill must pass a money check before printing: every line total equals unit price times quantity, the lines add up to the subtotal, the discount is between 0 and 100% and not above the subtotal, and paid plus balance equals subtotal minus discount.

### Tags (TSC, 50 mm)

One page per piece, so a bill with N pieces prints N tags (a pair of shoes is one piece). Each tag shows only:

```
Bill LA-2026-00123
Shirt
Wash + Iron
Piece 3/5
ID 2600123-3
```

The ID is two digits of the year, the bill's sequence number and the piece position, for example `2600123-3`. Tags show no customer name, phone number, date, barcode or QR code.

Text sizes step down in five steps until everything fits the label, wrapping long words if needed. Garment, service and piece position go from 12 pt down to 7 pt, the bill line from 10 pt down to 6 pt, and the piece ID from 10 pt down to 8 pt. The ID never prints below 8 pt because staff match it at pickup. By the layout constants, the largest size needs about 26 mm of height plus a 6 pt margin at top and bottom, so a 50 x 50 mm label fits comfortably; this is computed from the code, not measured on a printer. A page narrower than about 21 mm or shorter than about 11 mm is rejected, and so is one wider than about 4.6 inches. A document holds at most 500 tags.

### Linux (development only)

The Linux adapter finds queues with `lpstat` and sends plain text to the chosen queue with `lp -d QUEUE -o sides=one-sided -o media=A4` for bills or `-o media=Custom.50x50mm` for tags, plus `fit-to-page`. It prints the same shop title, address, phone and footer lines, but does not use the layout code above, so it has none of the wrapping, pagination or fit checks, always prints the "Discount" and "Balance" lines, and depends on the CUPS filters and fonts of the installed queue. A text job from Linux says nothing about how Windows will print. The Linux queues are chosen in the same Admin > Printers screen.
