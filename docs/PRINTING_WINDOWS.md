# Desktop printer setup and acceptance

The desktop app discovers installed printer queues and saves two independent queue IDs in Admin: one for the Canon customer bill and one for the TSC TE244 internal tags. It submits directly through the operating system printer stack. It never changes the Windows or CUPS default. The operating system accepting a job means only that the job entered its spooler; it does not confirm paper output. A timeout or an error after submission starts is marked uncertain and must be checked at the printer before retrying.

## Windows installation and queues

Build the isolated review installer with npm run tauri:build:windows-review. It creates an NSIS installer with identifier com.smartlaundry.pos.review and an isolated app data directory. For business installation, use the normal product build after the release signing and installation policy has been decided; the review installer is for validation and is not signed for distribution.

Before opening Admin printer settings:

1. Install the exact Canon laser model's Windows driver from Canon's support site and connect it. Set its paper form to A4 in the driver preferences. This app does not include model-specific Canon drivers.
2. Install the TSC TE244 Windows driver from the [TSC downloads page](https://in.tscprinters.com/en/downloads). Windows must show the queue as ready.
3. In the TSC driver preferences, define 50 × 50 mm tag stock (50 mm width), gap/continuous mode, and print darkness to match the roll. Calibrate the sensor after stock is loaded. Calibrate the media sensor using the [TSC TE-series calibration instructions](https://apac.tscprinters.com/en/products/te-series-4-inch-performance-desktop-printers). The printer driver owns this media setup; the application does not send printer-language commands.
4. Open Admin → Printers, refresh, select the Canon queue for bills and the TE244 queue for tags, and save. Selecting these destinations does not alter the Windows default printer.
5. Print the synthetic acceptance documents below, inspect alignment and text, and then confirm that both saved profiles survive app restart.

The Windows adapter enumerates installed local and connected queues with [EnumPrintersW](https://learn.microsoft.com/en-us/windows/win32/printdocs/enumprinters). It keeps the API's returned record count separate from the variable-length buffer size, whose trailing bytes hold pointed-to strings, and checks each string pointer remains within that live aligned buffer. For printer device contexts it passes a null driver parameter as [Microsoft recommends for printing](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-createdcw). It starts jobs with [StartDocW](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-startdocw), whose successful return provides the Windows spooler job ID. Unicode text is sent as text to GDI; customer-provided content is never inserted into a shell command or printer control language.

## Linux development setup

Install and configure CUPS queues first. The adapter discovers queues with lpstat, and submits UTF-8 text to the explicitly selected destination with lp -d QUEUE and document-specific media options. CUPS documents the explicit destination and custom media forms in its [printing options guide](https://www.cups.org/doc/options.html?Q=ppd). The tags request 50 × 50 mm stock; the installed driver/PPD must support that form and the loaded stock must be calibrated. Do not change the desktop user's default destination to test this feature.

The Linux adapter exists for development and queue integration checks. The target operating system is Windows. The CUPS text conversion path depends on the installed queue's filters and fonts, so Linux does not certify Canon or TSC paper geometry.

## Document contract

Bills are A4 documents containing the persisted order number, date, customer, items, quantity, snapshot prices, subtotal, paid amount, balance, physical garment count, and the promised ready time at 17:00 Asia/Kolkata two calendar days after receipt.

Tags are one page per physical garment, sized for 50 mm stock. Each tag contains only the bill number, garment/service, stable piece ID, and position/total. Tags do not contain the customer name or phone, the promise date, barcodes, QR codes, or scanner instructions. The printed tag count follows the persisted physical-piece records.

## Recovery and physical acceptance gate

A submitted/accepted result records OS spool acceptance and its job ID. It does not claim that the printer produced a readable document. Failures before the OS accepts a job can be retried. If the adapter loses the result after submission begins, the job is uncertain: inspect the Windows queue and printer output before choosing the explicit retry action. Never blindly replay an uncertain tag batch, since it can produce duplicate tags.

A Windows installation is not release-accepted until a person has completed these checks on the actual Canon and TSC hardware:

- [ ] Install and launch the Windows review build using a synthetic isolated database; verify the displayed review identifier.
- [ ] Confirm the Canon and TSC queues appear in Admin and save different destinations; verify the system default printer is unchanged.
- [ ] Print a synthetic A4 bill with several garments, long customer/garment names, persisted unit/line totals, a partial payment, remaining balance, physical count, and the exact 17:00 IST promise.
- [ ] Print a synthetic order with multiple pieces; verify there is exactly one 50 mm tag per piece and each has the right bill, service, stable piece ID, and sequential position/total.
- [ ] Check that no due date, customer contact, barcode, or QR appears on tags.
- [ ] Check edge clearance, font fallback, full names, cut/gap alignment, darkness, and repeatability after printer restart.
- [ ] Disconnect each printer and test paper-out/cover-open behavior. Confirm the job state becomes an error or uncertain state accurately and that recovery does not silently create duplicates.
- [ ] Restore connectivity, inspect the operating-system queue, and confirm that an uncertain item requires operator inspection/confirmation before retry.
- [ ] Restart the app and verify both printer profiles and each document's independent state persist.

No Windows machine was available during implementation. The bounded Linux fixture submissions reached the connected Canon and TSC printers, and the user confirmed paper output; that does not validate Windows behavior or print alignment. The Windows CI/package build and this hardware checklist remain explicit release gates.

The production adapter and its tests compile for x86_64-pc-windows-gnu in an isolated cross-target harness on Linux. This is compile-only evidence: no Win32 calls were executed, no Windows installer was built here, and no Windows printer hardware was exercised. The Windows CI/package build and the physical acceptance gate above remain required.
