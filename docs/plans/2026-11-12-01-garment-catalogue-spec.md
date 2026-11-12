# Garment catalogue pictures and cards

Proposed specification for PR 1. Baseline: `main` at `5bca27c`.

## Outcome

Staff can recognize garments and household items at card size. Admins can choose the new pictures from the existing Rate card picture picker. The catalogue refresh preserves the shop's prices and saved bills.

## Picture and card requirements

| Item | Artwork | Default placement |
| --- | --- | --- |
| Heavy Saree | A draped saree with dense embroidery or zari across the body, border and pallu. The fabric work must be visible at card size. | Give the existing Heavy Saree card its own picture. Keep the ordinary Saree image available. Treat Work Saree as a description of Heavy Saree for this PR. |
| Shirt | One shirt, with the entire garment visible. | Remove the pant from the picture and remove the explicit pant reference from the default Shirt option in English and Marathi. Keep its existing garment ID and rates. |
| Polo T-shirt | A collared polo in a color distinct from the current picture. | Refresh the T-shirt picture choice. Match it to an existing T-shirt card where the default picture is in use. |
| Jacket | A standalone jacket with the closure and sleeves visible. | Refresh the Jacket picture choice and the default artwork where a Jacket card exists. |
| Saree blouse | A short, fitted saree blouse with recognizable sleeves and neckline. | Refresh the Blouse card and picker choice. |
| Long Kurti | A kurti extending to the knee or below, shown by itself. | Add a Long Kurti picture choice. |
| Cotton lehenga | A plain or lightly patterned cotton three-piece lehenga. | Use for the existing normal Lehenga card. |
| Heavy lehenga | A three-piece lehenga with dense festive embroidery, distinct from cotton. | Use for the existing heavy Lehenga card. Keep the medium card's existing artwork. |
| Heavy frock | A party frock with visible decorative work, distinct from the plain dress picture. | Add a Heavy Frock picture choice. |
| Leather shoes | A matching pair of leather shoes with recognizable leather texture. | Add a Leather Shoes picture choice. The owner can assign it to the existing Shoe washing card if desired. |
| Single and double bedsheets | Two distinct pictures showing bedsheets only. The size difference should be apparent at card size. | Replace the default pictures for both. Rename the default Single Bedsheet / Curtain card to Single Bedsheet in both languages. |
| Window curtain | A curtain hung over a window, with the window visible enough to identify it. | Use for the existing Curtain per kg card where the default image is in use. Offer it by name in the picker. |
| Door curtain | A full-length curtain hung in a doorway. | Add a separate Door Curtain picture choice. |
| Pillow cover | A pillow cover shown by itself, with no sofa or sofa cushions. | Refresh the Pillow Cover picture choice. |
| Sofa cover | A cover fitted over a sofa, with enough of the sofa visible to distinguish it from a pillow cover. | Provide a separate Sofa Cover picture choice. |
| Tablecloth | A cloth draped over a table, with the tabletop and part of the legs visible. | Refresh the Table Cloth picture choice. |

Use the catalogue's square, transparent artwork style with centered subjects, a consistent scale, and no lettering inside the image. Bundle the files for offline use, register the selectable images in the picture picker and asset manifest, and use keys that pass native validation.

## Upgrade rules

- Use a forward migration for default card mappings and labels. Apply a field change only where the corresponding shipped default is still in use. Keep existing rates, active status, billing units, custom names, custom pictures, and stored order line names and prices. Keep old asset keys available where customers' catalogue selections still reference them. Use new keys for revised pictures when replacing a file in place would change a custom card that shares it.
- Keep the existing Work entry and the current Lehenga tiers. Where the earlier list requests only artwork for an item that has no active billable card, make the picture available in the picker. The owner must supply the name, services, billing unit and rates before a new billable card can ship by default.
- The earlier “Yes” covered several questions at once. The picture mappings above are the proposed defaults. A separately priced Work Saree, Leather Shoes, door or window curtain, Long Kurti, or Heavy Frock needs an explicit rate-card decision. A separate Pant card also needs a rate-card decision if the owner wants one.

## Acceptance criteria

- **CAT-01.** On a fresh install, the active Heavy Saree, normal Lehenga and heavy Lehenga display distinct pictures. Shirt and Single Bedsheet use the revised labels and artwork. An admin can select every new picture, save, reopen the Rate card, and see the chosen image on the corresponding card.
- **CAT-02.** On upgrade, an untouched default receives the updated picture and label. A renamed card, an independently chosen image and a custom price survive the upgrade. A bill created before the upgrade still shows its original line name and price.
- **CAT-03.** Check every image at actual counter card and picker sizes. The two curtains, the two bedsheets, the two lehengas, pillow cover and sofa cover are distinguishable. Images load in the packaged desktop app without a network connection.
- **CAT-04.** Picture registry and migration checks cover new keys and mappings. The enabled services, per-pair shoe billing and historical bill totals match the baseline.
