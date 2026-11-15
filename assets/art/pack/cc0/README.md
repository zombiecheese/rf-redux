# Photo scans (CC0)

The modern view's ground and rocks are real ground and stone, and the sky its toys reflect is a real garden: photo scans and sky photos from [Poly Haven](https://polyhaven.com), published under
[CC0](https://creativecommons.org/publicdomain/zero/1.0/) (no conditions). They are the one exception to the art pack
being the project's own work, and are credited here and in the game's About box.

| Files | Scan | Source | By |
| --- | --- | --- | --- |
| `ground/sand_*.jpg` | Dense Sand | [dense_sand](https://polyhaven.com/a/dense_sand) | Dimitrios Savva |
| `ground/wetsand_*.jpg` | Damp Beach Sand | [damp_beach_sand](https://polyhaven.com/a/damp_beach_sand) | Dimitrios Savva |
| `ground/soil_*.jpg` | Dirt | [dirt](https://polyhaven.com/a/dirt) | Charlotte Baglioni |
| `ground/earth_*.jpg` | Forest Ground 05 | [forest_ground_05](https://polyhaven.com/a/forest_ground_05) | Charlotte Baglioni |
| `ground/lawn_*.jpg` | Leafy Grass | [leafy_grass](https://polyhaven.com/a/leafy_grass) | Charlotte Baglioni |
| `ground/gravel_*.jpg` | Clean Pebbles | [clean_pebbles](https://polyhaven.com/a/clean_pebbles) | Dario Barresi, Charlotte Baglioni |
| `rock/rock_*.jpg` | Dry Riverbed Rock | [dry_riverbed_rock](https://polyhaven.com/a/dry_riverbed_rock) | Amal Kumar |
| `sky/garden.hdr` | Garden Nook (HDRI) | [garden_nook](https://polyhaven.com/a/garden_nook) | Dimitrios Savva (photography), Jarod Guest (processing) |
| `sky/night.hdr` | Blaubeuren Night (HDRI) | [blaubeuren_night](https://polyhaven.com/a/blaubeuren_night) | Andreas Mischok |

Each scan was downloaded at 2K and made smaller for the game:

- `<name>_diff.jpg`: the colour map, resized to 1024 x 1024 (JPEG quality 86). The lawn (`lawn`) has its hue moved
  about two thirds of the way toward green and its saturation raised by a quarter, as the scan is a leaf-strewn,
  olive grass.
- `<name>_nrm.jpg`: the surface, resized to 1024 x 1024 (JPEG quality 90): the OpenGL normal map's x and y in red and
  green, and the roughness map in blue.

The rock is made the same way, as `rock/rock_diff.jpg` and `rock/rock_nrm.jpg`.

The skies were downloaded at 2K (2048 x 1024, Radiance `.hdr`) and box-averaged down to 512 x 256. The sun (and, at
night, the brightest lamps) is capped at 60 (30 at night) so that the plastic's reflections get a glint, not a
firefly. They are written as uncompressed Radiance files.

`packages/client/src/modern/photorock.ts` lays the rock on the rocks; `photoSky` in `toy.ts` loads the skies.
`packages/client/src/modern/photoground.ts` loads the ground scans into two texture arrays and blends them by the ground's
material.
