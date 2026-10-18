-- Version 5 lets an administrator move an order to the trash.
--
--  * orders.trashed_at / trashed_by: set when the order is moved to the trash. A trashed order is
--    never deleted. Order lists, the dashboard, sales, queue counts and customer totals all skip
--    rows where trashed_at is set, so test orders stop counting without losing any data.
--
-- Safe on a database that is already in use: two nullable columns, no row is changed or deleted.
--
-- Migrations 001 to 004 are frozen. Later schema changes go in a new numbered file with a new
-- MIGRATION_STEPS entry in storage.rs.

ALTER TABLE orders ADD COLUMN trashed_at TEXT;
ALTER TABLE orders ADD COLUMN trashed_by TEXT REFERENCES counter_accounts(id);
