-- Version 11: refreshed garment and household pictures on the rate card.
--
-- DATA ONLY. Versions 10 and 11 share one schema contract.
--
-- Every picture lives in `public/garments/<image_key>-transparent.png`. The revised artwork ships
-- under new keys, so a card that already points at an older picture keeps showing that picture:
--   * a custom card that picked `shirt`, `tshirt`, `jacket`, `blouse`, `bedsheet-single`,
--     `bedsheet-double`, `curtain`, `pillow-cover`, `sofa-cover` or `table-cloth`
--   * the medium Lehenga tier, which keeps sharing the original `lehenga` picture
-- The old keys stay in the picker as the classic choices.
--
-- Safe on a database that is already in use:
--  * Only the shipped defaults move. Each field changes only while it still holds the value the
--    migrations shipped, so a renamed card, a picture the owner chose and a custom price survive.
--  * No rate, active flag, billing unit, order line or stored bill is touched. Past bills already
--    carry their own garment, service and price snapshots.
--  * Re-running it changes nothing.
--
-- Migrations 001 to 010 are frozen; this is a new numbered file with a MIGRATION_STEPS entry.

-- Heavy Saree gets its own embroidered picture; the ordinary Saree keeps `saree`.
UPDATE garments SET image_key = 'heavy-saree'
 WHERE id = 'g-heavy-saree' AND image_key = 'saree';

-- Shared top: one shirt in the picture. Keep both tops named at the shared rate.
UPDATE garments SET image_key = 'shirt-only'
 WHERE id = 'g-shirt' AND image_key = 'shirt';
UPDATE garments SET name_en = 'Shirt / T-shirt'
 WHERE id = 'g-shirt' AND name_en = 'Mens/Women (shirt / t-shirt / pant)';
UPDATE garments SET name_mr = 'शर्ट / टी-शर्ट'
 WHERE id = 'g-shirt' AND name_mr = 'पुरुष/महिला (शर्ट / टी-शर्ट / पँट)';

-- T-shirt and Jacket are not on the current card, but their shipped rows keep a default picture.
UPDATE garments SET image_key = 'polo-tshirt'
 WHERE id = 'g-tshirt' AND image_key = 'tshirt';
UPDATE garments SET image_key = 'zip-jacket'
 WHERE id = 'g-jacket' AND image_key = 'jacket';

-- Saree blouse.
UPDATE garments SET image_key = 'saree-blouse'
 WHERE id = 'g-blouse' AND image_key = 'blouse';

-- Bedsheets: bedsheets only, and the single sheet no longer mentions curtains.
UPDATE garments SET image_key = 'bedsheet-single-folded'
 WHERE id = 'g-bedsheet-single' AND image_key = 'bedsheet-single';
UPDATE garments SET name_en = 'Single Bedsheet'
 WHERE id = 'g-bedsheet-single' AND name_en = 'Single Bedsheet / Curtain';
UPDATE garments SET name_mr = 'सिंगल बेडशीट'
 WHERE id = 'g-bedsheet-single' AND name_mr = 'सिंगल बेडशीट / पडदा';
UPDATE garments SET image_key = 'bedsheet-double-folded'
 WHERE id = 'g-bedsheet-double' AND image_key = 'bedsheet-double';

-- Curtain per kg: a curtain over a window. Door curtains are a picker choice only.
UPDATE garments SET image_key = 'window-curtain'
 WHERE id = 'g-curtain-kg' AND image_key = 'curtain';

-- Lehenga tiers: normal gets cotton, heavy gets festive work, medium keeps the original picture.
UPDATE garments SET image_key = 'lehenga-cotton'
 WHERE id = 'g-lehenga-normal' AND image_key = 'lehenga';
UPDATE garments SET image_key = 'lehenga-heavy'
 WHERE id = 'g-lehenga-heavy' AND image_key = 'lehenga';
