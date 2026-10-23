-- Version 9: the administrator can add services (for example "Steam press") and remove them.
--
-- SCHEMA CHANGE (one table is rebuilt): service_methods.service_key has a CHECK that allows only the
-- five built-in keys, and SQLite cannot widen a CHECK without rebuilding the table. The new CHECK
-- only keeps keys short and plain (lowercase letters, digits, underscore and dash). A sort_order
-- column gives the counter a fixed order for the services, new ones last.
--
-- The rebuild keeps every id, so garment_service_rates, order_items and order_pieces keep pointing at
-- the same services. As in migration 008, foreign keys must be OFF while the table is rebuilt (see
-- LAST_TABLE_REBUILD_STEP in storage.rs; the PRAGMA lines cover running this file on its own).
-- Removing a service is "active = 0": past orders keep their service, and it can be added back.
--
-- Migrations 001 to 008 are frozen; this is a new numbered file with a MIGRATION_STEPS entry.

PRAGMA foreign_keys = OFF;

CREATE TABLE service_methods_new (
  id TEXT PRIMARY KEY NOT NULL,
  service_key TEXT NOT NULL UNIQUE CHECK (length(service_key) BETWEEN 1 AND 60 AND service_key NOT GLOB '*[^a-z0-9_-]*'),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO service_methods_new(id,service_key,name,active,sort_order)
 SELECT id,service_key,name,active,
        CASE service_key WHEN 'iron' THEN 1 WHEN 'wash_only' THEN 2 WHEN 'wash' THEN 3 WHEN 'dry_clean' THEN 4 WHEN 'wash_iron' THEN 5 ELSE 6 END
   FROM service_methods;
DROP TABLE service_methods;
ALTER TABLE service_methods_new RENAME TO service_methods;

PRAGMA foreign_keys = ON;
