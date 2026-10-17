# Smart Laundry POS: owner's guide

This guide is for the person who runs the shop. It covers setting the program up, the daily jobs, backups and what to do when something goes wrong. Technical detail is in [DESKTOP.md](DESKTOP.md) and [PRINTING_WINDOWS.md](PRINTING_WINDOWS.md).

## Read this first

- **The program has not yet been tested on a Windows laptop or with your printers.** It has been tested by automated checks on a development computer. Before you use it for real customers, someone must go through the checklist at the end of [DESKTOP_ACCEPTANCE.md](DESKTOP_ACCEPTANCE.md) on your laptop and printers. Until then, treat it as a trial and keep your old way of working alongside it.
- **The program ships with a default rate card taken from a handwritten price list.** Press means Iron. One price covers both Wash and Dry Clean, and Wash + Iron is the two added together. Garments missing from that list (T-shirt, jeans, shorts, leggings, petticoat, dhoti, lungi, dress, sweater ironing) carry estimates based on the nearest listed garment, and shoes are estimates. Review Admin > Rate card before you take a real order. A price you have changed is never overwritten by an update.
- **Everything is stored on this one laptop.** There is no cloud copy. If the laptop is lost or broken and you have no USB backup, the records are gone. Set up the USB backup folder (see Backups).
- **The PIN only keeps people out of the program.** It does not lock the data files. Anyone who can use the laptop's Windows account can copy or read them.

## Installing and updating

1. Run the installer on the shop laptop. The installer is not digitally signed, so Windows may show a warning before it lets you continue. The program installs for the current Windows user.
2. The program keeps its data in a folder of its own, normally `C:\Users\<your name>\AppData\Roaming\com.smartlaundry.pos`. You can type `%APPDATA%\com.smartlaundry.pos` into the File Explorer address bar to open it. This is the usual place for this kind of program but has not yet been confirmed on a Windows laptop. The file `laundry.db` in it is your records. Do not move or edit it.
3. To update, press **Back up now** (Admin > Backups), copy the newest backup to the USB drive, then run the new installer over the old one. Your records, rates, staff and printer choices stay. The installer is set up to refuse an older version over a newer one (not yet tested).
4. Before any update that upgrades the database, including one that changes only data, the new version saves a verified copy named `pre-upgrade-v1-...` or `pre-upgrade-v2-...` in the `backups` folder before changing anything. These copies are never deleted automatically. If it cannot make and check that copy, it refuses to upgrade and leaves your records alone; the message tells you to free some disk space or check that the backups folder is writable. A fresh install does not make this copy. An older version of the program cannot open a database that a newer version has upgraded, so if you need to go back, reinstall the newer program instead.
5. A database from an earlier test build of this version will not open. If the program opens to a screen with an error message and a **Try again** button, it could not open its database. Common causes are another copy of the program already running (check the taskbar and Task Manager), an old test database in that folder, or a damaged file. Do not delete anything. Close any other copy and press Try again. If it still fails, close the program, take a copy of the whole data folder, and ask for help with the exact message.

## First start

The first time the program opens it asks you to create the administrator. Type your name, choose a PIN of 4 to 8 digits, and type it again. Write the PIN down and keep it somewhere safe. If you forget it, see Forgotten admin PIN below.

## Signing in and locking

The sign-in screen has two buttons, **Staff login** and **Admin**. Pick your name, enter your PIN, press **Sign in**. If a name is missing, press "Refresh account list". Press **Lock** at the top right when you leave the counter. If an order is half-entered, the program asks before it throws it away. Five wrong PINs lock that account for five minutes.

There is one screen layout for everyone. The menu under the title bar has four groups: **Counter** (New order, Orders / Pickup, Print queue), **Insights** (Dashboard, Sales), **Shop** (Customers, Expenses, Inventory, Machines) and, for the admin only, **Admin** (Admin, Shop settings). The program always opens on New order. Staff see everything except the Admin group.

**Who can do what**

| | Staff | Admin |
| --- | --- | --- |
| Take orders, record payments, move an order through processing, pack, hand over, reprint bills and tags | Yes | Yes |
| See Dashboard and Sales (the same figures for both) | Yes | Yes |
| Add or edit customers, record expenses, add inventory items and adjust stock, add machines and record services | Yes | Yes |
| Set prices (Rate card) and discounts | No | Yes |
| Create staff accounts, deactivate them, reset PINs | No | Yes |
| Choose printers | No | Yes |
| Back up now, set the USB folder, restore a backup | No | Yes |
| Change shop name, address, phone, bill footer and tag settings | No | Yes |
| Cancel an order | No | Yes |
| **Delete** a customer, expense, inventory item or machine | No | Yes |

The program enforces this itself; hiding a menu item is only a convenience. Every delete asks for a reason (3 to 200 characters) and is recorded with the old values. Orders are never deleted, so bill numbers and records stay traceable: to remove an order, the admin cancels it.

## Staff accounts

Admin > Staff. Type a name and a first PIN, press **Create staff**. Each person should have their own account so records show who did what. For each person you can **Deactivate** or **Activate** the account (activating also clears a lock from wrong PINs), and set a new PIN with **Reset PIN** (this also clears a lock). You cannot deactivate or reset your own account here. There is no screen for adding a second administrator.

## Prices (Rate card)

Admin > Rate card lists every garment with each of the four services: Wash, Iron, Wash + Iron and Dry Clean. A note at the top reminds you the starting prices are estimates. Type the price in rupees in the Rate box and press **Save** on that row. When you type a first price for a combination that has none, **Available** is ticked for you; untick it if you do not want to sell it yet. Untick Available to stop selling a combination. A garment and service with no price cannot be sold. A rate cannot be more than Rs 10,000. A new price applies to orders taken after you save it; saved orders keep their old price. Shoes are priced per pair and cannot be ironed, so Iron and Wash + Iron stay switched off for shoes. Each price change is recorded with the old and new price.

## Discounts

Admin > Discounts. Staff cannot change or type in a discount. The program applies it automatically.

- **All customers:** one percentage for every order, with an optional label. Use the Active box to switch it on or off. A percentage above 50% needs an extra tick, to guard against typing 100 instead of 10.
- **Specific customer:** a percentage for one customer. Search for them by mobile number (they must already have had an order saved), enter the percentage and press **Save customer discount**. A customer's own percentage replaces the shop-wide one, so enter 0 to stop one customer getting the shop discount. **Turn off** in the list removes it and that customer goes back to the shop-wide rule.

A returning customer is recognised by mobile number and name together. Two people who share a phone number are two customers, so one does not get the other's discount; if the same person is entered with a different spelling of the name, the program treats them as new, and the customer discount will not apply. Percentages go from 0 to 100 with up to two decimals. The bill shows Subtotal, Discount, Total and Paid. A 100% discount makes the order free and nothing is collected. If you change a discount while staff have an order open, that order cannot be saved until staff look at the new total. Each discount change is recorded with the old and new values.

## Printers

Install the Canon and TSC drivers as described in [PRINTING_WINDOWS.md](PRINTING_WINDOWS.md). In the driver settings, check the Canon is on A4 with one copy and the TSC is on the label size with one copy. Then in Admin > Printers choose the Canon queue for the bill and the TSC queue for the tags (they must be different) and press **Save printers**. If a printer is missing from the list, switch it on, check Windows shows it as ready, and press **Refresh printer list**. A printer that is switched to "Use Printer Offline" is treated as unavailable.

## Dashboard

Insights > **Dashboard** is for a quick look at the day. It shows today's figures (orders and pieces, billed, collected, orders ready to collect, orders in process, low-stock items), this month's figures (orders, billed, collected, expenses and profit), a graph of the last 14 days, a list of orders that have been ready for pickup for more than 2 days, a list of orders in process (soonest promise first, overdue ones marked), and the most recent orders. Click a bill number to open that order in Orders / Pickup. Press **Refresh** to reload. Older orders that were saved without individual pieces are not shown in the two attention lists. **Profit** is money collected minus expenses (a cash figure, not an accounting profit).

## Sales

Insights > **Sales** answers "how much did we do between these times". Choose a period (Today, Yesterday, Last 7 days, This month, or Custom with date and time boxes) and optionally filter by payment method, order status, staff member, or search by bill number, customer name or phone. All times are shop time (IST). A custom period includes its start and stops just before its end.

It shows summary cards (orders, before discount, discounts, billed, collected, refunded, net collected, cancelled, expenses, profit), a graph (the program picks hours, days or months from the period; you can switch), and two tables: **Orders** and **Transactions** (payments and refunds, who took them and why money went back). Rules to know:

- **Billed** leaves out cancelled orders unless the filter says to include them. A cancelled order is counted as cancelled in the period it was cancelled.
- **Collected** is the payments taken in the period. A payment that is cancelled later is shown as **Refunded** in the period when it was cancelled; earlier periods are never rewritten. **Net collected** is collected minus refunded.
- **Expenses** are counted by the date of the expense, not the time. **Profit** is not shown while filters are on.
- The **Staff** filter means: orders created by that person, and money taken by that person.

## Customers

Shop > **Customers** lists everyone who has left laundry, with their orders, total billed and last order; type in the search box to find one. **Add customer** takes a name and a 10-digit mobile number (spaces, dashes and +91 are accepted); address, alternate mobile, customer type and notes are optional. Opening a customer shows their details and their recent orders; click one to open it in Orders / Pickup. The same person is one customer if the mobile number and the name both match, so two people can share a number. A customer who has an automatic discount is marked, and only the admin can change that customer's name or mobile number (so a discount cannot be handed to someone else). The admin can **Delete** a customer who has no orders; a customer with orders cannot be deleted, and the program says so. The customer's own discount rule is deleted with them and recorded in the audit.

## Expenses

Shop > **Expenses** lists what you spent, with a total for the dates and category you choose (there are quick choices for **This month** and **All time**). **Add expense** takes a date, category, amount, how it was paid and optional description and notes. Dates are shop dates and both the first and last day of a range are included. Only the admin can **Delete** an expense. Deleting an expense changes the profit figure for the day it was dated, including a past day, and the delete box says so before asking for a reason.

## Inventory

Shop > **Inventory** lists supplies such as detergent, hangers and packaging with how much is in stock. **Add item** takes a name, unit, optional cost per unit, the stock now and a "warn me at or below" level; an item with no warn level never raises a low-stock flag. **Adjust stock** records stock coming in, stock used, or a correction to a counted number, each with a reason. Low-stock items are marked and counted on the Dashboard. Only the admin can **Delete** an item; the item's whole stock history is deleted with it and recorded in the audit.

## Machines

Shop > **Machines** is a list of your washers, dryers and irons with when each was last serviced and when it is next due. There is no live on/off status: a machine's "status" is its maintenance record. **Add machine** takes a name and type (capacity, purchase date and notes are optional). **Record service** sets the service date, the next due date and notes. A machine whose next service date is today or earlier is marked as due. Only the admin can **Delete** a machine.

## Shop settings

Admin group > **Shop settings** (admin only). Set the laundry name, address, phone, centered message line, and multiline bill footer/terms, then choose which optional fields appear on bills. The order number, customer name, garment lines, piece count and payment totals always print. You can also choose whether tags show the laundry name, add an optional short tag line, and set the per-tag pitch for the 50 mm-wide continuous TSC roll (30–200 mm; new installations start at 30 mm). The batch adds one 10 mm trailing feed after the tag that physically exits last. The previews show content and pitch before saving. Each new order keeps its print choices so reprints match the original; changes apply to new orders. If the footer is blank the bill ends with "Thank you". Every bill then prints "* terms and conditions apply" as its last line; that line is fixed and cannot be changed. An existing installation starts with shop name "Smart Laundry" and footer "Thank you for choosing us.", so change them to your own. Bill numbers no longer use a prefix, so there is nothing to set for them. Bills print on A4 landscape. The old settings for GST number, receipt width and default completion days were not carried over; ready time remains two days at 5:00 PM.

## Taking an order

1. Open **New order**. Type the customer's **mobile number** and **name**. The mobile number is required; the program accepts it with spaces, dashes or +91 and stores 10 digits. If the customer has been before, tap their name in the list that appears.
2. Choose the service at the top: Wash, Iron, Wash + Iron (the usual) or Dry Clean. Each service has its own set of prices.
3. Tap the garment pictures to add them, or type a number in the box. A line can hold 1 to 200, an order can have 100 lines and 500 pieces, and an order total must stay under Rs 10,00,000. The bin icon removes a whole line. To add the same garment with a different service, change the service and tap it again.
4. Check the summary on the right: the lines, the number of pieces, **Ready by** (received date plus two days, 5:00 PM, always), and the **Amount to collect**. Until a price is worked out the amounts show a dash, not 0. Under the Save button, a short note says what is still missing.
5. Take the full amount from the customer, choose **Paid by** (cash, UPI, card, bank transfer or other), and press **Save & Print**. Payment is always taken in full at this point, so there is nothing owing later. The screen is locked while it saves.

If rates or a discount changed while the order was open, the program refuses to save and shows the new total. Check it and press Save again. The program saves the order and then prints the bill on the Canon and one tag for each piece on the TSC. A garment ordered as Iron only gets no tag, and if every garment is Iron only no tags print at all. A pair of shoes is one piece and gets one tag. Each tag shows the customer's name and phone number, the bill number, the garment, the service and the piece number. Stick or tie each tag to its garment.

Bill numbers look like `202610170001`: the date (year, month, day, shop time) followed by a running number for that day, which starts again at 0001 each day. Tag IDs look like `2610170001-3`: the year, month and day in two digits each, the bill's running number and the piece number. Bills saved before this change keep their old numbers, such as `LA-2026-00123`.

If the program shows "Order save did not complete", nothing is saved twice; press Save again. If it says the order may already be saved, open Orders / Pickup and look for the bill before saving again. If it says the order is saved but printing failed, go to **Print queue**.

## Packing, ready and pickup

Open **Orders / Pickup**. It opens on the newest orders. To find one, search by bill number or mobile number (at least two characters; a number can be typed with spaces or +91), then **Open order**.

- **Processing status** moves an order forward through Washing, Drying, Ironing, Quality check and Packing to **Ready for pickup**. It cannot go backwards.
- **Packing checklist** is optional. Tick each piece as it is packed and save. The program does not stop you marking an order Ready without it.
- **Verify pickup collection** works only when the order is Ready. Compare each tag ID with the garments handed over, tick every piece, and press **Verify and complete collection**. If any piece is not ticked, the order cannot be collected. Once collected, an order cannot be collected again.

## If something was entered wrongly

Saved orders cannot be edited. The administrator can **cancel** an order that has not been collected: open the order, press **Cancel order**, write a reason of 3 to 200 characters, and press **Confirm cancel order**. This voids every payment on the order and cannot be undone. The program then reminds you to hand back any money received; it does not record the refund in a till, only the amount, the reason and who did it. Take the order again correctly as a new order. A cancelled order cannot be collected or have payments added. Its failed print jobs can still be retried in the Print queue, so do not retry them.

For a wrong tag, use **Reprint selected tags** on the Print progress screen. For a lost or wrong bill, use **Reprint customer bill**. Reprints are available to staff.

## Printing problems

Each order has two print jobs, a bill and a set of tags, and each shows a status. Open **Print queue** (the most recent jobs of all orders, ones needing attention first) or **Print progress** (for the order you just saved).

| Status shown | What it means | What to do |
| --- | --- | --- |
| Waiting to print | Saved but not yet sent. This happens if printers were not set up, or the program closed first. | Press **Resume**. |
| Sending to printer | Being sent now. | Wait. |
| Sent to printer | Windows has accepted the job. It does not prove paper came out. | If nothing printed, look at the Windows printer queue and the printer itself. |
| Failed | The program is sure nothing was sent. | Fix the cause (paper, power, cable, printer choice), then press **Retry**. |
| Check the printer | The program cannot tell if anything was sent. | Do not press anything yet. See below. |

**When the status is Check the printer.** This happens when sending takes too long (two minutes for a bill, longer for many tags), when something breaks part-way, or when the program was closed or the laptop lost power while sending.

1. Look at the printer and take out anything that has printed. Open the Windows printer queue (Settings > Printers & scanners > the printer > Open print queue) and see whether the job is still waiting there.
2. If it already printed in full, leave it. Do not retry.
3. If nothing printed, press **Review uncertain job**, read the warning, then press **Confirm reprint**. For tags the screen tells you that sending again sends every tag in the order. If only some tags are missing, cancel this and use **Reprint selected tags** on the Print progress screen for just those pieces.

If a job fails with "Printer unavailable", the printer is off, offline, out of paper, jammed, has a cover open, or is set to "Use Printer Offline", or an earlier job to the same printer is still being sent. Fix that, wait a moment, and press Retry. A tag job fails with a message about the label size if the TSC driver is set to a sheet instead of the label; the admin must fix the driver paper size.

## Backups

The program saves a backup soon after it starts and every four hours while it stays open, and keeps the newest 90 in the `backups` folder inside the data folder. If it was restarted less than ten minutes after a backup, it does not make another. Those copies are on the same laptop, so they do not protect against the laptop being lost or broken.

**Set up a second copy on a USB drive** (Admin > Backups):

1. Plug in the USB drive and find its drive letter in File Explorer, for example `E:`. It must not be the same drive as the program's data (normally `C:`); the program refuses that.
2. Make a folder on it, for example `E:\Laundry backups`.
3. Type the full path in **Second backup folder** and press **Save second backup folder**. The program checks it can write there and creates a folder named `SmartLaundry-backups-` plus a short code for this computer inside it.

From then on every backup is also copied into that subfolder (the newest 90 are kept there; nothing else in the folder is touched). If a different USB stick takes over the same drive letter, the program will not write to it, and the next backup shows a failure until you choose the folder again. Windows can give the drive a different letter on another day, so check the path if copies stop.

**Check the Backups tab every week.** It shows when the last backup was made and whether the last copy to the second folder worked, and warns if the last backup is more than a day old. If a backup itself fails, a message "The last automatic backup failed ..." appears after you sign in, and goes away after the next good backup. The second-folder and "more than a day" warnings appear only on the Backups tab. **Back up now** makes one immediately. Keep an extra copy somewhere other than the shop from time to time.

## Restoring a backup

Restore replaces everything on the laptop with the contents of a backup. Orders and payments entered after that backup was made are lost from the program. **It also brings back the accounts and PINs from that backup: a staff member who was deactivated since then can sign in again, and a staff PIN or the admin PIN that was changed since then goes back to the old one.** Only restore when you must, and make sure no one is taking orders. Only an admin can restore.

Bill numbers are a date plus a running number for the day. Restoring a backup made earlier the same day can therefore re-issue bill numbers that were already printed on paper, so check the paper bills from that day before you take new orders.

1. Sign in as admin. Admin > **Backups** > **Restore from backup...**
2. Choose the backup file (`laundry-....db`) from the `backups` folder or from the `SmartLaundry-backups-...` folder on the USB drive, then confirm in the box that appears.
3. The program checks the file and saves a safety backup of the current records. It then says the restore is staged, stops accepting changes, and shows a yellow banner on every screen until you restart: close the program completely and open it again.
4. The restore is applied at start-up and the previous records are kept as `laundry-recovery-....db` in the `backups` folder, which is not deleted automatically.
5. Check that the orders you expect are there, then open Admin > Staff and check who is active.

If the chosen file is not a valid backup, the program refuses it. If a staged restore turns out to be damaged when the program opens, it keeps your existing records, saves the bad file under a name starting `restore-rejected-`, and shows a warning. If the restore fails with a message about a file being in use (antivirus can do this briefly), wait a minute and try the steps again; the program does not retry by itself.

If the program cannot open its database at all (it shows an error and **Try again**), nobody can sign in, so there is no Restore button. In that case close the program, keep a copy of the whole data folder, and ask for help; the usual fix is to put a good backup in place of `laundry.db` by hand.

## Forgotten admin PIN

You need to be able to open the data folder on the laptop. This does not need the old PIN, and it gives nobody anything they could not already do with access to the files.

1. Close the program.
2. Open the data folder (see Installing; it contains `laundry.db`).
3. Make a new text file there named exactly `reset-admin-pin.txt`. In Notepad choose Save as, set "Save as type" to All files, and type the whole name. Windows hides extensions by default, so check it did not become `reset-admin-pin.txt.txt`.
4. Type only the new PIN (4 to 8 digits) in the file and save it. Plain text, Unicode and UTF-8 are all fine.
5. Start the program. The program reads the file and deletes it straight away, then sets the PIN. A notice says the administrator PIN was reset. Sign in with the new PIN. The reset also unlocks and re-activates the admin account.

If the PIN was not acceptable, the file could not be read, or there is no administrator yet, the notice says why and the file is deleted anyway, so no PIN is left on the disk. Make the file again with a good PIN. If the notice says the file could not be deleted, nothing was changed; delete it yourself and try again. A forgotten staff PIN is simpler: the admin uses Reset PIN in Admin > Staff.

## What the messages mean

| Message | Meaning and action |
| --- | --- |
| Incorrect name or PIN. | Wrong PIN, or the wrong name chosen. |
| This account is locked for a few minutes after too many wrong PINs. Wait 5 minutes and try again. | Five wrong PINs. Wait five minutes, or for a staff account the admin can Activate or Reset PIN. For the admin account use the reset file (see Forgotten admin PIN). |
| This account is inactive. | The admin switched it off. |
| Enter a 10-digit mobile number. / The phone number may only contain digits, spaces and a leading +91. | The order needs a valid mobile number. |
| This garment and service combination is unavailable. / A rate has not been configured… | No price or not sold. The admin sets it in Rate card. |
| An order can have at most 100 different lines. / …at most 500 pieces… / This order's total is unusually large… | An order limit was reached. Split the order, or check the quantities. |
| Rates or the promised time changed… / Rates changed while the order was open… / The discount changed while the order was open… | The price moved after the order was shown. Check the new total, then save again. |
| Order save did not complete… | Nothing was saved. Press Save again; it will not create two orders. |
| This order may already be saved. Check Orders / Pickup… | A copy of this order was saved earlier. Look for the bill before saving again. |
| Order … is saved, but print dispatch failed… | The order is safe. Use Print queue to resume or retry. |
| Configure both bill and tag printers in Admin settings. | Choose both printers in Admin > Printers. |
| Choose different printers for bills and for tags. | The same queue was picked twice. |
| Printer unavailable… | Windows reports that printer as off, offline, in error, out of paper, jammed or with a cover open, or an earlier print to it is still running. Fix it, then Retry. |
| Print submission is uncertain… | See "When the status is Check the printer". |
| Application ended during submission; inspect output before retrying. | The program or laptop stopped mid-print. The job is marked Check the printer. |
| The saved print document is unreadable… | That job cannot be printed. It is marked Failed. Reprint from the order instead. |
| The last automatic backup failed… | The backup did not work. Open Admin > Backups, press Back up now and read the message. Check free disk space. |
| The last copy to the second folder failed… | The USB folder is missing, full, or is a different stick from the one chosen. Reconnect it, or choose the folder again, and press Back up now. |
| Choose a different drive from the one that holds the app's data… | The second backup folder is on the same drive as the data. Use a USB stick. |
| A restore is staged. Close and reopen the app before writing. | A restore is waiting. Close the program and open it again. |
| A backup restore is staged. Close and reopen Smart Laundry… (yellow banner) | A restore was staged and is waiting for a restart. Close the program completely and open it again. Afterwards check who is active in Admin > Staff, because the backup's accounts and PINs come back. |
| Administrator access is required to … / The administrator session is no longer valid. | A staff account tried an admin action, or the admin was deactivated while signed in. Sign in again as an admin. |
| This customer has … order(s) and cannot be deleted… | Customers with orders are kept. To remove an order, the admin cancels it. |
| Another Smart Laundry POS instance is using this database. | The program is already running. Do not start a second copy. |
| This order still has … to pay. | Only affects older orders with a balance. Use Record later payment on the order, then collect. |
| Every order piece must be confirmed for collection first. | Tick every piece before completing pickup. |
| A collected order cannot be cancelled. / This order is already cancelled. | Cancel works only on an order that is neither collected nor already cancelled. |
| The staged database restore failed validation… | Your records were kept. The bad file was saved aside. Choose a valid backup. |
| The database could not be safely copied before upgrading… | The upgrade was refused and your records are untouched. Free disk space and try again. |
| The administrator PIN was not reset… | See Forgotten admin PIN; the message says why. |

## What the program does not do

There is no barcode or QR code, no scanner, no link a customer can open, no cloud copy or second-computer sync, no Marathi on bills or tags, no editing of saved orders, no refund or till record beyond what cancelling notes, no way to void a single payment (only cancel the whole order), no export of sales to a spreadsheet, and no way to change the "ready in two days at 5 PM" rule. Old orders that were saved without individual pieces cannot be closed from the counter.

## Getting help

Before asking for help, write down the exact message, what you pressed, the bill number if there is one, and the time. Do not delete anything from the data folder. If you can, copy the whole data folder to the USB drive first.
