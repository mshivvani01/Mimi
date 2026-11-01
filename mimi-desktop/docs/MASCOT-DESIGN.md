# Mimi mascot design

## Character
Chubby, cream-white pastel kitten with a plush toy-like body, large glossy violet eyes, rosy cheeks, a tiny pink nose,
a blush-pink bow above one ear, a pastel lavender collar with a small heart charm, rounded paws, and a curled tail.
Personality: playful, comforting, gentle, encouraging.

## Palette
| Role | Hex |
|---|---|
| Cream (fur) | #FFF9F0 to #EFD2B3 shaded |
| Blush pink | #F7A8C4 |
| Lavender | #CDB8F0 / #8B6FD0 |
| Mint | #D3F1E3 |
| Baby blue | #D3EBF9 |
| Eye violet | #7C5CD6 |

## Poses
master, idle, happy, wave, drink, stretch, encourage, rest.

## How the artwork was made (honest)
- The artwork is **original and hand-built in code**: layered SVG in `src/components/MimiArt.tsx` with a 3D-toy look (radial-gradient fur, blurred ambient and rim highlights, glossy two-highlight eyes, shaded bow, collar and charm, contact shadow).
- `npm run assets:mascot` (`scripts/generate-mascot.tsx`) renders each pose to a **720x768 RGBA PNG with a real alpha channel** in `src/assets/mascot/`, and regenerates `src/assets/mascot-manifest.json` from the files it wrote.
- It is **not the output of an AI image-generation model.** A Higgsfield image connector is available to the chat, but this build sandbox can only reach a short allow-list of package hosts, so generated images could not be brought into the project. Because everything comes from one source file, all poses are consistent by construction.
- It is a stylised 3D look, not a true 3D render: no ray-traced lighting, subsurface fur, or modelled geometry.
- To replace it with painted or rendered art later, drop transparent PNGs named `mimi-<pose>.png` into `src/assets/mascot/`; the Mascot component uses them automatically.

## Files
- All 8 PNGs exist (master + the 7 requested poses). Nothing is claimed that is not on disk; `tests/mascot.test.tsx` verifies each manifest entry against the real file (existence, PNG signature, dimensions, RGBA).
- No concept sheet exists, and none is used as a substitute.
- If a PNG fails to load, the Mascot component falls back to the live vector drawing.
- Animation (float, blink, tail sway, wave) applies to the vector fallback; the PNGs only get the idle float. Per-pose sprite animation is future work.

## App icon
`build/icon.png` (512x512) and `build/icon.ico` (16 to 256 px) are Mimi's head on a lavender-blush rounded square, composed from `mimi-master.png`. Window icon and the electron-builder `win.icon` point to them. The installer has not been built, so the installed icon is unverified.
