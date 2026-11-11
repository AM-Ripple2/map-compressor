# ATAK overlay format notes

These results come from testing on **ATAK-CIV 5.6.0.13** (Samsung Galaxy Tab S9+) with **Import Manager → Image Overlay File**, plus ATAK's own log (`adb logcat`). They explain why Map Compressor writes the formats it does.

| Format | Result in ATAK | Notes |
|---|---|---|
| KMZ GroundOverlay, JPEG | ✅ works | No transparency (JPEG has none) |
| KMZ GroundOverlay, PNG | ✅ transparent | Lossless PNG is about as large as the original |
| KMZ GroundOverlay, WebP | ❌ nothing shown | |
| KMZ split into ~187 JPEG/PNG tiles | ⚠️ transparent but very slow | Too many overlays for ATAK |
| GeoTIFF, JPEG YCbCr + GDAL internal mask | ⚠️ loads, masked areas drawn **black** | The image-overlay path ignores GDAL masks |
| GeoTIFF, WebP + alpha | ❌ fails | Log: `WEBP compression support is not configured` (ATAK's GDAL has no WebP codec) |
| GeoTIFF, JPEG RGBA (alpha band), **no overviews** | ❌ does not display | |
| **GeoTIFF, JPEG RGBA (alpha band) + internal overviews** | ✅ **transparent, lines up** | Format used by Map Compressor |

## Size trade-off

The alpha band prevents JPEG's YCbCr chroma subsampling, so the RGBA GeoTIFF is roughly twice the size of a 3-band one. Overviews add about 35–50%. The most effective way to shrink output is the **image size** option.

Measured on a real PIX4Dengine orthomosaic (8286 × 9166 px, 1.9 cm/px, 35% empty, 223 MB):

| Output | Size |
|---|---|
| GeoTIFF, full resolution | 40.6 MB |
| GeoTIFF, half size (about 3.8 cm/px) | 10.8 MB |
| KMZ at 8192 px (no transparency) | 8.1 MB |

## Not yet tested

- iTAK and TAK Aware (iOS)
- WebTAK
- CloudTAK display of the RGBA GeoTIFF
- ATAK 5.7 / 5.8. Expected to behave the same, since the reading is done by ATAK's GDAL.
