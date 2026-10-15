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
