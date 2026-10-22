-- Version 8: two ways to wash. "Wash only" is new; the existing Wash service becomes "Wash + Press"
-- (its rate-card prices already include pressing, so they stay as they are).
--
-- SCHEMA CHANGE (one table is rebuilt): service_methods.service_key has a CHECK that allows only
-- wash / iron / wash_iron / dry_clean, and SQLite cannot widen a CHECK without rebuilding the table.
-- The rebuild keeps every id, so garment_service_rates, order_items and order_pieces keep pointing at
-- the same services. SQLite needs foreign keys OFF for this: dropping the old table with them ON would
-- first "delete" its rows and fire the ON DELETE SET NULL of order_items and order_pieces, wiping
-- which service past orders used. The pragma is ignored inside a transaction, so startup switches
-- foreign keys off before it begins the transaction (see initialize_schema in storage.rs); the two
-- PRAGMA lines here cover every place this file is run on its own (test fixtures, the schema contract).
-- Foreign keys are checked again afterwards (PRAGMA foreign_key_check at startup).
--
-- DATA:
--  * "Wash" (svc-wash, key wash) is renamed "Wash + Press". Orders already saved keep the name they
--    were billed under in their own snapshot, so past bills and tags do not change.
--  * "Wash only" (svc-wash-only, key wash_only) is added for every garment with NO price and not
--    offered: the shop has not given its prices yet. Set them in Admin > Rate card; a garment shows the
--    service on the counter once it is priced.
--  * Six items are never pressed, so their old "Wash" price was a wash-only price. It moves to
--    "Wash only" and "Wash + Press" stops being offered for them: shoes, both footmats, both
--    blankets and the curtain sold by the kilo. Other garments keep their prices where they are; the
--    owner can move any of them in the rate card. Moved or cleared cells get a new rate version, so
--    order_items.rate_version still identifies the price an order was charged.
--
-- Migrations 001 to 007 are frozen; this is a new numbered file with a MIGRATION_STEPS entry.

PRAGMA foreign_keys = OFF;

CREATE TABLE service_methods_new (
  id TEXT PRIMARY KEY NOT NULL,
  service_key TEXT NOT NULL UNIQUE CHECK (service_key IN ('wash','iron','wash_iron','dry_clean','wash_only')),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
INSERT INTO service_methods_new(id,service_key,name,active)
 SELECT id,service_key,name,active FROM service_methods;
DROP TABLE service_methods;
ALTER TABLE service_methods_new RENAME TO service_methods;

UPDATE service_methods SET name = 'Wash + Press' WHERE id = 'svc-wash';
UPDATE services SET name = 'Wash + Press' WHERE id = 'svc-wash';

INSERT INTO service_methods(id,service_key,name) VALUES ('svc-wash-only','wash_only','Wash only');
-- The legacy services table keeps order_items.service_id foreign keys valid for new counter orders.
INSERT OR IGNORE INTO services(id,name,category,price_per_piece,price_per_kg,created_at,updated_at,origin_device_id) VALUES
 ('svc-wash-only','Wash only','laundry',NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'counter');

-- Every garment gets a row for the new service, not offered and without a price.
INSERT OR IGNORE INTO garment_service_rates(garment_id,service_id,configured,available,updated_at)
 SELECT g.id,'svc-wash-only',0,0,CURRENT_TIMESTAMP FROM garments g;

-- Items that are never pressed: their Wash price becomes the Wash only price.
UPDATE garment_service_rates
   SET price_minor = (SELECT w.price_minor FROM garment_service_rates w
                       WHERE w.garment_id = garment_service_rates.garment_id AND w.service_id = 'svc-wash'),
       configured = 1,
       available = 1,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE service_id = 'svc-wash-only'
   AND garment_id IN ('g-shoes','g-footmat-small','g-footmat-large','g-blanket-single','g-blanket-double','g-curtain-kg')
   AND EXISTS (SELECT 1 FROM garment_service_rates w
                WHERE w.garment_id = garment_service_rates.garment_id AND w.service_id = 'svc-wash'
                  AND w.configured = 1 AND w.available = 1);
UPDATE garment_service_rates
   SET price_minor = NULL,
       configured = 0,
       available = 0,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE service_id = 'svc-wash'
   AND garment_id IN ('g-shoes','g-footmat-small','g-footmat-large','g-blanket-single','g-blanket-double','g-curtain-kg')
   AND (configured = 1 OR available = 1)
   AND EXISTS (SELECT 1 FROM garment_service_rates n
                WHERE n.garment_id = garment_service_rates.garment_id AND n.service_id = 'svc-wash-only'
                  AND n.configured = 1);

PRAGMA foreign_keys = ON;
