-- Version 2 adds the staff counter domain without rewriting v1 financial history.
CREATE TABLE counter_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  full_name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','staff')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);
CREATE TABLE garments (
  id TEXT PRIMARY KEY NOT NULL,
  garment_key TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_mr TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  image_key TEXT NOT NULL,
  billing_unit TEXT NOT NULL CHECK (billing_unit IN ('piece','pair')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE service_methods (
  id TEXT PRIMARY KEY NOT NULL,
  service_key TEXT NOT NULL UNIQUE CHECK (service_key IN ('wash','iron','wash_iron','dry_clean')),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
CREATE TABLE garment_service_rates (
  garment_id TEXT NOT NULL REFERENCES garments(id),
  service_id TEXT NOT NULL REFERENCES service_methods(id),
  price_minor INTEGER CHECK (price_minor IS NULL OR price_minor >= 0),
  configured INTEGER NOT NULL DEFAULT 0 CHECK (configured IN (0,1)),
  available INTEGER NOT NULL DEFAULT 0 CHECK (available IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES counter_accounts(id),
  PRIMARY KEY (garment_id,service_id),
  CHECK (configured = 0 OR price_minor IS NOT NULL)
);
ALTER TABLE order_items ADD COLUMN garment_id TEXT REFERENCES garments(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN service_method_id TEXT REFERENCES service_methods(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN unit_price_minor INTEGER;
ALTER TABLE order_items ADD COLUMN line_total_minor INTEGER;
ALTER TABLE order_items ADD COLUMN rate_version INTEGER;
ALTER TABLE orders ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_orders_idempotency ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE order_pieces (
  id TEXT PRIMARY KEY NOT NULL,
  short_id TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  garment_id TEXT REFERENCES garments(id) ON DELETE SET NULL,
  service_id TEXT REFERENCES service_methods(id) ON DELETE SET NULL,
  garment_snapshot TEXT NOT NULL,
  service_snapshot TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position > 0),
  total INTEGER NOT NULL CHECK(total > 0),
  created_at TEXT NOT NULL,
  UNIQUE(order_id, position)
);
CREATE TABLE piece_matches (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  piece_id TEXT NOT NULL UNIQUE REFERENCES order_pieces(id) ON DELETE CASCADE,
  matched_by TEXT NOT NULL REFERENCES counter_accounts(id),
  matched_at TEXT NOT NULL
);
CREATE TABLE printer_profiles (
  kind TEXT PRIMARY KEY NOT NULL CHECK(kind IN ('bill','tags')),
  printer_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES counter_accounts(id)
);
CREATE TABLE print_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('bill','tags')),
  state TEXT NOT NULL CHECK(state IN ('pending','submitting','submitted','failed','uncertain')),
  printer_id TEXT,
  os_job_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error TEXT,
  source_job_id TEXT REFERENCES print_jobs(id),
  reprint_request_id TEXT UNIQUE
);
CREATE INDEX idx_print_jobs_pending ON print_jobs(state,created_at);
CREATE TABLE print_job_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  print_job_id TEXT NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
  attempted_at TEXT NOT NULL,
  finished_at TEXT,
  state TEXT NOT NULL CHECK(state IN ('submitting','submitted','failed','uncertain')),
  os_job_id TEXT,
  error TEXT
);
CREATE TABLE counter_audit (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES counter_accounts(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO service_methods(id,service_key,name) VALUES
 ('svc-wash','wash','Wash'),('svc-iron','iron','Iron'),
 ('svc-wash-iron','wash_iron','Wash + Iron'),('svc-dry-clean','dry_clean','Dry Clean');
-- Keep legacy order_items.service_id foreign keys valid for new counter orders.
INSERT OR IGNORE INTO services(id,name,category,price_per_piece,price_per_kg,created_at,updated_at,origin_device_id) VALUES
 ('svc-wash','Wash','laundry',NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'counter'),
 ('svc-iron','Iron','laundry',NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'counter'),
 ('svc-wash-iron','Wash + Iron','laundry',NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'counter'),
 ('svc-dry-clean','Dry Clean','laundry',NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'counter');
INSERT INTO garments(id,garment_key,name_en,name_mr,category,image_key,billing_unit,sort_order) VALUES
 ('g-shirt','shirt','Shirt','शर्ट','tops','shirt','piece',10),
 ('g-tshirt','tshirt','T-shirt','टी-शर्ट','tops','tshirt','piece',20),
 ('g-jeans','jeans','Jeans','जीन्स','bottoms','jeans','piece',30),
 ('g-trousers','trousers','Trousers','पँट','bottoms','trousers','piece',40),
 ('g-shorts','shorts','Shorts','शॉर्ट्स','bottoms','shorts','piece',50),
 ('g-kurta','kurta','Kurta / Kameez','कुर्ता','ethnic','kurta','piece',60),
 ('g-pyjama','pyjama','Pyjama','पायजमा','ethnic','pyjama','piece',70),
 ('g-salwar','salwar','Salwar / Churidar','सलवार','ethnic','salwar','piece',80),
 ('g-leggings','leggings','Leggings','लेगिंग्स','bottoms','leggings','piece',90),
 ('g-saree','saree','Saree','साडी','ethnic','saree','piece',100),
 ('g-blouse','blouse','Blouse','ब्लाउज','ethnic','blouse','piece',110),
 ('g-petticoat','petticoat','Petticoat','परकर','ethnic','petticoat','piece',120),
 ('g-dupatta','dupatta','Dupatta','दुपट्टा','ethnic','dupatta','piece',130),
 ('g-dhoti','dhoti','Dhoti','धोतर','ethnic','dhoti','piece',140),
 ('g-lungi','lungi','Lungi','लुंगी','ethnic','lungi','piece',150),
 ('g-dress','dress','Dress / Frock','ड्रेस','onepiece','dress','piece',160),
 ('g-jacket','jacket','Jacket','जॅकेट','outerwear','jacket','piece',170),
 ('g-sweater','sweater','Sweater','स्वेटर','outerwear','sweater','piece',180),
 ('g-shoes','shoes','Shoes (pair)','शूज','footwear','shoes','pair',190);
INSERT INTO garment_service_rates(garment_id,service_id,configured,available,updated_at)
 SELECT g.id,s.id,0,0,CURRENT_TIMESTAMP FROM garments g CROSS JOIN service_methods s;
UPDATE garment_service_rates SET available=1 WHERE garment_id='g-shoes' AND service_id IN ('svc-wash','svc-dry-clean');
UPDATE garment_service_rates SET available=1 WHERE garment_id<>'g-shoes';
