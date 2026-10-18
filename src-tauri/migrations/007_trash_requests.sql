-- Version 7 lets any signed-in user ask for an order to be moved to the trash (a bill added by
-- mistake). Only an administrator can approve it.
--
--  * orders.trash_requested_at / trash_requested_by / trash_request_reason: set when staff mark an
--    order for the trash. A pending request changes nothing else: the order still counts in sales
--    until an administrator moves it to the trash (version 5) or dismisses the request, which
--    clears these columns.
--
-- Safe on a database that is already in use: three nullable columns, no row is changed or deleted.
--
-- Migrations 001 to 006 are frozen. Later schema changes go in a new numbered file with a new
-- MIGRATION_STEPS entry in storage.rs.

ALTER TABLE orders ADD COLUMN trash_requested_at TEXT;
ALTER TABLE orders ADD COLUMN trash_requested_by TEXT REFERENCES counter_accounts(id);
ALTER TABLE orders ADD COLUMN trash_request_reason TEXT;
