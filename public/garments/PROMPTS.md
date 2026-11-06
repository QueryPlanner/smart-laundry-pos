# Garment illustration assets

Nineteen separate images were generated with the built-in ImageGen tool. The first generation used a checkerboard-looking backdrop despite the transparency request. The selected final set was regenerated with the tool's transparent-background option and is referenced by `manifest.json`.

Shared prompt used for every final image:

```text
Use case: stylized-concept
Asset type: locally bundled garment tile illustration for a desktop laundry counter POS
Style/medium: clean friendly soft 3D catalogue illustration with subtle fabric texture, consistent set
Composition/framing: one garment centered, fully visible, front view, square crop with generous margins
Lighting/mood: soft studio lighting
Constraints: transparent background; no people, mannequins, hangers, labels, text, prices, logos, or watermark. Individual illustration with consistent framing and finish.
Primary request: <subject below>.
```

Subjects: an everyday cotton shirt, front view; a short sleeve cotton T-shirt; a pair of blue denim jeans; a pair of formal trousers; a pair of cotton shorts; a long cotton kurta; a pair of loose cotton pyjama pants; a pair of salwar churidar pants; a pair of cotton leggings; a gracefully draped silk saree; a short sleeve blouse; a cotton petticoat skirt; a lightweight dupatta scarf; a white dhoti garment; a checked lungi wrap; a simple child dress frock; a lightweight jacket; a knit sweater; a pair of everyday shoes shown side by side.

The images contain no labels or prices. The application renders English and Marathi names from its native garment catalogue. Bundle path: `public/garments/`; the counter loads `/garments/<imageKey>-transparent.png` locally, with the first-letter fallback in the tile.

## Added later: coat and kurta pyjama

`coat-transparent.png` and `kurta-pyjama-transparent.png` were generated with Codex CLI (`codex exec`, its image generation tool with the transparent-background option) using the same shared prompt as above, with `jacket-transparent.png` and `kurta-transparent.png` attached as style references. Subjects: a tailored dark navy formal blazer / suit coat; a men's plain cotton kurta shown with its matching pyjama pants as one set. Both are 1254 x 1254 RGBA, like the originals.

## Added later: home items and lehenga (rate card v6)

`bedsheet-single`, `bedsheet-double`, `blanket-single`, `blanket-double`, `footmat`, `curtain` and `lehenga` (all `-transparent.png`) were generated with Codex CLI (`codex exec -s workspace-write`, image generation with the transparent-background option) with `shirt-transparent.png` and `coat-transparent.png` attached as style references and the same shared style as above. Subjects: a folded light blue single bedsheet; a larger folded cream floral double bedsheet; a folded grey wool single blanket; a larger folded maroon quilted double blanket; a woven door footmat with a white pillow cover beside it; a pair of gathered beige curtains; a red and gold three-piece lehenga set (skirt, choli, dupatta). All are 1254 x 1254 RGBA. Some items reuse existing pictures: Heavy Saree uses `saree`, Work uses `blouse`, Footmat (small and large) share `footmat`, and the three lehenga weights share `lehenga`.

## Added later: pictures for garments the administrator adds

Sixteen pictures for Admin > Rate card > New garment, where the owner picks a picture for a garment that is not in the default rate card. They were generated with Codex CLI (`codex exec -s workspace-write`, image generation with the transparent-background option, the prompt passed on stdin) with `shirt-transparent.png` and `kurta-transparent.png` attached as style references and the same shared style as above. All are 1254 x 1254 RGBA. Subjects: a women's churidar suit set (kameez, churidar and dupatta); a floor-length green anarkali with gold embroidery; a short printed cotton kurti; wide-leg palazzo pants; a cream men's sherwani; a maroon Nehru jacket; a charcoal two-piece suit; a royal blue evening gown; a school uniform (white shirt, navy shorts, striped tie); a pair of white pillow covers; a stack of sofa cushion covers; two folded bath towels; a folded floral razai quilt; a folded checked table cloth; a folded woollen shawl with a paisley border; a baby romper with a cap. The list the administrator chooses from is `src/lib/localFirst/garmentPictures.ts`.

## Added later: apron

`apron-transparent.png` was generated the same way (Codex CLI, `shirt-transparent.png` and `kurta-transparent.png` as style references, the shared style above). Subject: a plain teal cotton apron laid flat, front view, with neck loop, waist ties and one front pocket. 1254 x 1254 RGBA.
