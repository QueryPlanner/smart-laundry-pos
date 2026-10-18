-- Version 6: replace the long garment list and its four-column price list with the shop's new,
-- simpler rate card: 19 items and the services Iron, Wash, Dry Clean and Starch.
--
-- DATA ONLY. No table, column or index changes, so versions 2, 3 and 6 share one schema contract.
--
-- Starch reuses the service row `svc-wash-iron` (service_key 'wash_iron'). service_methods.service_key
-- has a CHECK that allows only wash / iron / wash_iron / dry_clean, and SQLite cannot relax a CHECK
-- without rebuilding a table that many foreign keys point at. The key is an internal identifier; the
-- name the shop sees is "Starch". Orders already saved keep the "Wash + Iron" name in their own
-- snapshot, so past receipts do not change.
--
-- Safe on a database that is already in use:
--  * No garment or rate row is deleted. Garments that are not on the new card are only marked
--    inactive (custom garments the owner added are left alone), so past orders still resolve them.
--  * Every rate on the new card is overwritten, including rates the owner edited before: the owner
--    asked for this price list to replace the old one. The rate version is bumped so
--    order_items.rate_version still identifies the price an order was charged. Past orders keep the
--    unit_price_minor they were billed at.
--  * Re-running it gives the same result.
--
-- Source (rupees; blank = not offered):                 Iron  Wash  Dry clean  Starch
--   Mens/Women (shirt / t-shirt / pant / etc)             10    30      40       50
--   Saree                                                 50     -     170      250
--   Heavy Saree                                           80     -     280        -
--   Blazer (Coat)                                         50     -     200        -
--   Single Bedsheet/Curtain                                -   100     100        -
--   Double Bedsheet                                        -   150     150        -
--   Blanket single                                         -   200     200        -
--   Blanket double                                         -   250     250        -
--   Footmat (small, 50)  Footmat (large, 100)              -   50/100  50/100     -
--   Shoe washing                                           -   150       -        -
--   Curtain per kg                                         -   250       -        -
--   Blouse                                                10    40       -        -
--   Work                                                  25    80       -        -
--   Hoodie/Sweater                                         -   100     100        -
--   Dhotar                                                40   120     120        -
--   Lehenga 3 pc (normal / medium / heavy)                 -     -   500/600/700  -
-- The sheet lists "Footmat" twice (50 and 100); they are shown as Footmat (small) and Footmat (large).
-- "Curtain per kg" is sold in whole kilograms through the quantity box: the schema bills only per
-- piece or per pair, and weight billing would need a schema change. At the counter any price can
-- also be changed for one bill, so odd cases do not need a rate-card edit.

UPDATE service_methods SET name = 'Starch' WHERE id = 'svc-wash-iron';
UPDATE services SET name = 'Starch' WHERE id = 'svc-wash-iron';

-- Existing rows that become items on the new card.
UPDATE garments SET name_en = 'Mens/Women (shirt / t-shirt / pant)', name_mr = 'पुरुष/महिला (शर्ट / टी-शर्ट / पँट)', sort_order = 10, active = 1 WHERE id = 'g-shirt';
UPDATE garments SET name_en = 'Saree', name_mr = 'साडी', sort_order = 20, active = 1 WHERE id = 'g-saree';
UPDATE garments SET name_en = 'Blazer (Coat)', name_mr = 'ब्लेझर (कोट)', sort_order = 40, active = 1 WHERE id = 'g-coat';
UPDATE garments SET name_en = 'Blouse', name_mr = 'ब्लाउज', sort_order = 140, active = 1 WHERE id = 'g-blouse';
UPDATE garments SET name_en = 'Hoodie / Sweater', name_mr = 'हुडी / स्वेटर', sort_order = 160, active = 1 WHERE id = 'g-sweater';
UPDATE garments SET name_en = 'Dhotar', name_mr = 'धोतर', sort_order = 170, active = 1 WHERE id = 'g-dhoti';
UPDATE garments SET name_en = 'Shoe washing', name_mr = 'शूज धुलाई', sort_order = 120, active = 1 WHERE id = 'g-shoes';

-- New items. image_key is the picture name: /garments/<image_key>-transparent.png.
INSERT OR IGNORE INTO garments(id,garment_key,name_en,name_mr,category,image_key,billing_unit,sort_order) VALUES
 ('g-heavy-saree','heavy_saree','Heavy Saree','जड साडी','ethnic','saree','piece',30),
 ('g-bedsheet-single','bedsheet_single','Single Bedsheet / Curtain','सिंगल बेडशीट / पडदा','home','bedsheet-single','piece',50),
 ('g-bedsheet-double','bedsheet_double','Double Bedsheet','डबल बेडशीट','home','bedsheet-double','piece',60),
 ('g-blanket-single','blanket_single','Blanket single','सिंगल ब्लँकेट','home','blanket-single','piece',70),
 ('g-blanket-double','blanket_double','Blanket double','डबल ब्लँकेट','home','blanket-double','piece',80),
 ('g-footmat-small','footmat_small','Footmat (small)','पायपुसणी (लहान)','home','footmat','piece',90),
 ('g-footmat-large','footmat_large','Footmat (large)','पायपुसणी (मोठी)','home','footmat','piece',100),
 ('g-curtain-kg','curtain_kg','Curtain per kg (qty = kg)','पडदा प्रति किलो','home','curtain','piece',130),
 ('g-work','work','Work','वर्क','ethnic','blouse','piece',150),
 ('g-lehenga-normal','lehenga_normal','Lehenga 3 pc (normal)','लेहेंगा ३ पीस (साधा)','ethnic','lehenga','piece',180),
 ('g-lehenga-medium','lehenga_medium','Lehenga 3 pc (medium)','लेहेंगा ३ पीस (मध्यम)','ethnic','lehenga','piece',190),
 ('g-lehenga-heavy','lehenga_heavy','Lehenga 3 pc (heavy)','लेहेंगा ३ पीस (जड)','ethnic','lehenga','piece',200);

-- Every item gets a row for every service (not offered, no price) before prices are filled in.
INSERT OR IGNORE INTO garment_service_rates(garment_id,service_id,configured,available,updated_at)
 SELECT g.id,s.id,0,0,CURRENT_TIMESTAMP FROM garments g CROSS JOIN service_methods s;

-- Retire the old list. Owner-added custom garments stay.
UPDATE garments SET active = 0
 WHERE category <> 'custom'
   AND id NOT IN ('g-shirt','g-saree','g-heavy-saree','g-coat','g-bedsheet-single','g-bedsheet-double',
                  'g-blanket-single','g-blanket-double','g-footmat-small','g-footmat-large','g-shoes',
                  'g-curtain-kg','g-blouse','g-work','g-sweater','g-dhoti','g-lehenga-normal',
                  'g-lehenga-medium','g-lehenga-heavy');

-- Set every cell of the 19 items from the card: a price where the sheet has one, otherwise not
-- offered. The rate version moves only when a cell actually changes, so running this again changes
-- nothing.
WITH card(garment_id, service_id, price) AS (VALUES
 ('g-shirt','svc-iron',1000),('g-shirt','svc-wash',3000),('g-shirt','svc-dry-clean',4000),('g-shirt','svc-wash-iron',5000),
 ('g-saree','svc-iron',5000),('g-saree','svc-dry-clean',17000),('g-saree','svc-wash-iron',25000),
 ('g-heavy-saree','svc-iron',8000),('g-heavy-saree','svc-dry-clean',28000),
 ('g-coat','svc-iron',5000),('g-coat','svc-dry-clean',20000),
 ('g-bedsheet-single','svc-wash',10000),('g-bedsheet-single','svc-dry-clean',10000),
 ('g-bedsheet-double','svc-wash',15000),('g-bedsheet-double','svc-dry-clean',15000),
 ('g-blanket-single','svc-wash',20000),('g-blanket-single','svc-dry-clean',20000),
 ('g-blanket-double','svc-wash',25000),('g-blanket-double','svc-dry-clean',25000),
 ('g-footmat-small','svc-wash',5000),('g-footmat-small','svc-dry-clean',5000),
 ('g-footmat-large','svc-wash',10000),('g-footmat-large','svc-dry-clean',10000),
 ('g-shoes','svc-wash',15000),
 ('g-curtain-kg','svc-wash',25000),
 ('g-blouse','svc-iron',1000),('g-blouse','svc-wash',4000),
 ('g-work','svc-iron',2500),('g-work','svc-wash',8000),
 ('g-sweater','svc-wash',10000),('g-sweater','svc-dry-clean',10000),
 ('g-dhoti','svc-iron',4000),('g-dhoti','svc-wash',12000),('g-dhoti','svc-dry-clean',12000),
 ('g-lehenga-normal','svc-dry-clean',50000),
 ('g-lehenga-medium','svc-dry-clean',60000),
 ('g-lehenga-heavy','svc-dry-clean',70000)
)
UPDATE garment_service_rates
   SET version = version + CASE
         WHEN price_minor IS NOT (SELECT c.price FROM card c WHERE c.garment_id = garment_service_rates.garment_id AND c.service_id = garment_service_rates.service_id)
           OR available <> EXISTS (SELECT 1 FROM card c WHERE c.garment_id = garment_service_rates.garment_id AND c.service_id = garment_service_rates.service_id)
         THEN 1 ELSE 0 END,
       price_minor = (SELECT c.price FROM card c WHERE c.garment_id = garment_service_rates.garment_id AND c.service_id = garment_service_rates.service_id),
       configured = EXISTS (SELECT 1 FROM card c WHERE c.garment_id = garment_service_rates.garment_id AND c.service_id = garment_service_rates.service_id),
       available = EXISTS (SELECT 1 FROM card c WHERE c.garment_id = garment_service_rates.garment_id AND c.service_id = garment_service_rates.service_id),
       updated_at = CURRENT_TIMESTAMP
 WHERE garment_id IN ('g-shirt','g-saree','g-heavy-saree','g-coat','g-bedsheet-single','g-bedsheet-double',
                      'g-blanket-single','g-blanket-double','g-footmat-small','g-footmat-large','g-shoes',
                      'g-curtain-kg','g-blouse','g-work','g-sweater','g-dhoti','g-lehenga-normal',
                      'g-lehenga-medium','g-lehenga-heavy');
