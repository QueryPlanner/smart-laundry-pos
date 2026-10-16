-- Version 3: ship the shop's own price list as the default rate card and add the two garments it
-- lists that v2 did not have (Coat / Blazer, Gents Kurta Pyjama).
--
-- DATA ONLY. This migration adds no tables, columns or indexes, so the schema contract that the
-- startup validator rebuilds from 001 + 002 stays valid. A migration that changes the schema must
-- also update that contract.
--
-- Safe on a database that is already in use:
--  * Rates an owner has saved are never touched. Every Admin > Rate card save sets updated_by, even a
--    save that leaves the price as it was, so such a row keeps its old price until the owner edits it.
--  * Rates that still hold the original v2 estimates are replaced, and their version is bumped so
--    order_items.rate_version still identifies the price an order was charged. Past orders keep the
--    unit_price_minor they were billed at.
--  * Re-running it changes nothing.
--
-- Source of the numbers (rupees, handwritten price list):
--   Press (= Iron)          shirt/pant/chudidar/pyjama 10, dupatta/blouse/jacket 10, saree 50,
--                           coat/blazer 25, gents kurta pyjama 20
--   Dry clean / wash        shirt/pant/chudidar top/ladies pyjama 50, ladies dupatta 25, saree 150,
--                           coat/blazer 150, gents kurta pyjama 150, sweater 99, jacket 200
-- One price covers both Wash and Dry Clean. Wash + Iron is Wash plus Iron. Garments the list does not
-- name take the price of the nearest listed garment (an estimate for the owner to confirm):
--   t-shirt, jeans, shorts, leggings, lungi like shirt/pant; kurta/kameez like chudidar top;
--   petticoat like blouse; dhoti Iron 20 / Wash 100; dress like coat/blazer; sweater Iron 25.
-- Shoes are not on the list and keep their v2 estimates.
INSERT OR IGNORE INTO garments(id,garment_key,name_en,name_mr,category,image_key,billing_unit,sort_order) VALUES
 ('g-kurta-pyjama','kurta_pyjama','Gents Kurta Pyjama','जेन्ट्स कुर्ता पायजमा','ethnic','kurta-pyjama','piece',65),
 ('g-coat','coat','Coat / Blazer','कोट / ब्लेझर','outerwear','coat','piece',175);
INSERT OR IGNORE INTO garment_service_rates(garment_id,service_id,configured,available,updated_at)
 SELECT g.id,s.id,0,1,CURRENT_TIMESTAMP FROM garments g CROSS JOIN service_methods s
 WHERE g.id IN ('g-kurta-pyjama','g-coat');

WITH defaults(garment_id, service_id, price) AS (VALUES
 ('g-shirt','svc-wash',5000),
 ('g-shirt','svc-iron',1000),
 ('g-shirt','svc-wash-iron',6000),
 ('g-shirt','svc-dry-clean',5000),
 ('g-tshirt','svc-wash',5000),
 ('g-tshirt','svc-iron',1000),
 ('g-tshirt','svc-wash-iron',6000),
 ('g-tshirt','svc-dry-clean',5000),
 ('g-jeans','svc-wash',5000),
 ('g-jeans','svc-iron',1000),
 ('g-jeans','svc-wash-iron',6000),
 ('g-jeans','svc-dry-clean',5000),
 ('g-trousers','svc-wash',5000),
 ('g-trousers','svc-iron',1000),
 ('g-trousers','svc-wash-iron',6000),
 ('g-trousers','svc-dry-clean',5000),
 ('g-shorts','svc-wash',5000),
 ('g-shorts','svc-iron',1000),
 ('g-shorts','svc-wash-iron',6000),
 ('g-shorts','svc-dry-clean',5000),
 ('g-kurta','svc-wash',5000),
 ('g-kurta','svc-iron',1000),
 ('g-kurta','svc-wash-iron',6000),
 ('g-kurta','svc-dry-clean',5000),
 ('g-pyjama','svc-wash',5000),
 ('g-pyjama','svc-iron',1000),
 ('g-pyjama','svc-wash-iron',6000),
 ('g-pyjama','svc-dry-clean',5000),
 ('g-salwar','svc-wash',5000),
 ('g-salwar','svc-iron',1000),
 ('g-salwar','svc-wash-iron',6000),
 ('g-salwar','svc-dry-clean',5000),
 ('g-leggings','svc-wash',5000),
 ('g-leggings','svc-iron',1000),
 ('g-leggings','svc-wash-iron',6000),
 ('g-leggings','svc-dry-clean',5000),
 ('g-saree','svc-wash',15000),
 ('g-saree','svc-iron',5000),
 ('g-saree','svc-wash-iron',20000),
 ('g-saree','svc-dry-clean',15000),
 ('g-blouse','svc-wash',2500),
 ('g-blouse','svc-iron',1000),
 ('g-blouse','svc-wash-iron',3500),
 ('g-blouse','svc-dry-clean',2500),
 ('g-petticoat','svc-wash',2500),
 ('g-petticoat','svc-iron',1000),
 ('g-petticoat','svc-wash-iron',3500),
 ('g-petticoat','svc-dry-clean',2500),
 ('g-dupatta','svc-wash',2500),
 ('g-dupatta','svc-iron',1000),
 ('g-dupatta','svc-wash-iron',3500),
 ('g-dupatta','svc-dry-clean',2500),
 ('g-dhoti','svc-wash',10000),
 ('g-dhoti','svc-iron',2000),
 ('g-dhoti','svc-wash-iron',12000),
 ('g-dhoti','svc-dry-clean',10000),
 ('g-lungi','svc-wash',5000),
 ('g-lungi','svc-iron',1000),
 ('g-lungi','svc-wash-iron',6000),
 ('g-lungi','svc-dry-clean',5000),
 ('g-dress','svc-wash',15000),
 ('g-dress','svc-iron',2500),
 ('g-dress','svc-wash-iron',17500),
 ('g-dress','svc-dry-clean',15000),
 ('g-jacket','svc-wash',20000),
 ('g-jacket','svc-iron',1000),
 ('g-jacket','svc-wash-iron',21000),
 ('g-jacket','svc-dry-clean',20000),
 ('g-sweater','svc-wash',9900),
 ('g-sweater','svc-iron',2500),
 ('g-sweater','svc-wash-iron',12400),
 ('g-sweater','svc-dry-clean',9900),
 ('g-coat','svc-wash',15000),
 ('g-coat','svc-iron',2500),
 ('g-coat','svc-wash-iron',17500),
 ('g-coat','svc-dry-clean',15000),
 ('g-kurta-pyjama','svc-wash',15000),
 ('g-kurta-pyjama','svc-iron',2000),
 ('g-kurta-pyjama','svc-wash-iron',17000),
 ('g-kurta-pyjama','svc-dry-clean',15000)
)
UPDATE garment_service_rates
SET price_minor = (SELECT d.price FROM defaults d WHERE d.garment_id = garment_service_rates.garment_id AND d.service_id = garment_service_rates.service_id),
    configured = 1,
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE updated_by IS NULL
  AND EXISTS (
    SELECT 1 FROM defaults d
    WHERE d.garment_id = garment_service_rates.garment_id
      AND d.service_id = garment_service_rates.service_id
      AND (garment_service_rates.price_minor IS NOT d.price OR garment_service_rates.configured = 0)
  );
