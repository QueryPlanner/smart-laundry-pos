-- Version 10 records a Cash + UPI split as one request that writes two settlements.
-- The existing counter_payment_requests table links one request to one payment, so a split
-- keeps its own request row with both payment ids. Each payment stays a normal ledger row, so
-- the admin void action, cancellation refunds and the daily report treat each method separately.
CREATE TABLE counter_split_payment_requests (
  request_id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  cash_payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
  upi_payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_split_payment_requests_order ON counter_split_payment_requests(order_id);
