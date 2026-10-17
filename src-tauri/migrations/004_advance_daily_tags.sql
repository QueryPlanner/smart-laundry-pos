-- Version 4 adds advance payments, daily bill numbers and piece tags.
--
--  * order_day_sequences: the next bill number for each shop day (IST, YYYYMMDD). It starts empty;
--    orders saved before this version keep their LA-2026-00123 style numbers.
--  * payments.kind: 'advance' for money taken when the order was received, 'settlement' for money
--    taken later. Existing payments are backfilled: a payment recorded at the same instant its order
--    was received is an advance, every other payment stays a settlement.
--  * order_pieces.tagged: whether the piece gets a tag. Every existing piece stays tagged.
--
-- Safe on a database that is already in use:
--  * No triggers are added and no row is deleted. The backfill is the only row change, and it reads
--    only data already in the payment and its order.
--  * This migration changes the schema, so the schema contract in storage.rs builds the version 4
--    expected schema from this file too.
--
-- Migrations 001 to 003 are frozen. Later schema changes go in a new numbered file with a new
-- MIGRATION_STEPS entry in storage.rs.

CREATE TABLE order_day_sequences (
  day TEXT PRIMARY KEY NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'settlement'
  CHECK (kind IN ('advance','settlement'));

UPDATE payments
   SET kind = 'advance'
 WHERE EXISTS (
   SELECT 1 FROM orders
    WHERE orders.id = payments.order_id
      AND orders.received_at = payments.recorded_at
 );

ALTER TABLE order_pieces ADD COLUMN tagged INTEGER NOT NULL DEFAULT 1
  CHECK (tagged IN (0,1));
