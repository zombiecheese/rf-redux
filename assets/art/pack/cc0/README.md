# Photo scans (CC0)

The modern view's ground is real ground: photo scans from [Poly Haven](https://polyhaven.com), published under
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

Each scan was downloaded at 2K and made smaller for the game:

- `<name>_diff.jpg`: the colour map, resized to 1024 x 1024 (JPEG quality 86). The lawn (`lawn`) has its hue moved
  about two thirds of the way toward green and its saturation raised by a quarter, as the scan is a leaf-strewn,
  olive grass.
- `<name>_nrm.jpg`: the surface, resized to 1024 x 1024 (JPEG quality 90): the OpenGL normal map's x and y in red and
  green, and the roughness map in blue.

`packages/client/src/modern/photoground.ts` loads them into two texture arrays and blends them by the ground's
material.
