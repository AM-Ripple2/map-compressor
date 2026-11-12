# Map Compressor

Turns large GeoTIFF maps and drone orthomosaics (e.g. PIX4Dreact / PIX4Dengine exports) into small, georeferenced overlays that load in TAK clients. Empty areas, such as the irregular border around a drone flight, **stay see-through**.

A real 223 MB PIX4D orthomosaic becomes a 10–35 MB GeoTIFF that displays in ATAK, lined up with the basemap.

## ⬇️ Download (test build 0.1.0)

| For | Download |
|---|---|
| **Any computer** (Windows, Mac, Linux, offline). Works with every TAK client. | [**map-compressor-offline.html**](https://github.com/AM-Ripple2/map-compressor/releases/download/v0.1.0-test/map-compressor-offline.html) |
| **ATAK 5.8** plugin ✅ TAK.gov-signed | [**MapCompressor-ATAK-5.8.0.apk**](https://github.com/AM-Ripple2/map-compressor/releases/download/v0.1.0-test/MapCompressor-ATAK-5.8.0.apk) |
| **ATAK 5.7** plugin ✅ TAK.gov-signed | [**MapCompressor-ATAK-5.7.0.apk**](https://github.com/AM-Ripple2/map-compressor/releases/download/v0.1.0-test/MapCompressor-ATAK-5.7.0.apk) |
| **ATAK 5.6** plugin ✅ TAK.gov-signed | [**MapCompressor-ATAK-5.6.0.apk**](https://github.com/AM-Ripple2/map-compressor/releases/download/v0.1.0-test/MapCompressor-ATAK-5.6.0.apk) |

> ✅ All three ATAK plugins (**5.6, 5.7 and 5.8**) are signed by TAK.gov, so they load in normal Play Store / TAK.gov ATAK-CIV. Download the one that matches your ATAK version. See [TESTING.md](TESTING.md) for what to test, and report problems under [Issues](https://github.com/AM-Ripple2/map-compressor/issues).

## Privacy: runs entirely on your device

Imagery from incidents and operations is often sensitive. Map Compressor never uploads it:
- **No account, no cloud, no server.** Conversion happens on the computer or in the browser you're using.
- **The offline page makes zero network requests** by default. A built-in Content Security Policy blocks every request except the optional basemap, even if a library tried to call out.
- **The online satellite basemap is off by default.** Turning it on downloads Esri map tiles, which reveals the *area* you're viewing (never the image itself). The page shows a clear warning while it's on.
- **Nothing is shared** until you choose to: download a file, or, in the CloudTAK plugin, press *Share to TAK Server*.

## Ways to run it

| | Best for | Needs |
|---|---|---|
| **Offline page**: `dist/map-compressor-offline.html` | Anyone: quality slider, live map preview, detail check, exports | Just double-click the file. Works with no internet, from a laptop, USB stick or shared drive. |
| **ATAK plugin**: [`atak-plugin/`](docs/atak-plugin-plan.md) | Converting **on the device inside ATAK**: pick a GeoTIFF, set quality, *Convert & add to map*, *Share…* | ATAK-CIV 5.6 / 5.7 / 5.8 (TAK.gov-signed builds, see Download above) |
| **CloudTAK plugin**: [`cloudtak-plugin/`](cloudtak-plugin/README.md) | Teams on CloudTAK; adds **Share to TAK Server** | Built into your CloudTAK deployment |
| **Desktop tool**: `map_compress.py` | Converting whole folders at once | Python 3.9+ and `pip install -r requirements.txt` (offline after install) |

### Offline page
1. Open `dist/map-compressor-offline.html` in Chrome, Edge, Firefox or Safari.
2. Choose a GeoTIFF. Drag the **quality** slider and use **image size** to trade detail for file size. The preview shows exactly where the overlay will land.
3. Click **Download GeoTIFF** (recommended), **KMZ**, or **Data Package**.

### Desktop tool
```bash
pip install -r requirements.txt
```
```bash
python map_compress.py ./originals -o ./atak_maps -q 70 --max-dim 4600 --package "Incident Maps"
```

| Option | Meaning |
|---|---|
| `-q 70` | JPEG quality, 1–95 |
| `-f kmz,geotiff` | outputs to make: any of `geotiff`, `kmz`, `jpeg` (default `kmz,geotiff`) |
| `--max-dim 4600` | downscale so the longest side is at most this many pixels. Orthomosaics usually look fine at 25–50% scale. |
| `-r` | include sub-folders |
| `--background white` | fill colour for empty areas in KMZ/JPEG output (GeoTIFF keeps them transparent) |
| `--package NAME` | also bundle the GeoTIFFs (or KMZs) into one ATAK data package `NAME.zip` |

## Outputs

| Format | What it is | Transparency | Load it in |
|---|---|---|---|
| **GeoTIFF** (recommended) | WGS84, JPEG tiles, built-in zoom levels; maps with empty areas get an **alpha band** | ✅ see-through (verified in ATAK) | ATAK **Import Manager → Image Overlay File** |
| **KMZ** | JPEG + KML GroundOverlay | ❌ filled black or white | ATAK **Import Manager → Image Overlay File** |
| **Data package** | `.zip` with `MANIFEST/manifest.xml` around the GeoTIFF (or KMZ) | as above | Import Manager, TAK Server, Data Sync |
| JPEG set (desktop only) | `.jpg` + `.jgw` + `.prj` + `.jpg.aux.xml` | ❌ | copy all four into `atak/imagery/` |

Why these formats: see [docs/atak-format-notes.md](docs/atak-format-notes.md), which records what ATAK did and didn't display in device testing.

## Tested

- ✅ **ATAK-CIV 5.6.0.13** (Galaxy Tab S9+):
  - A real PIX4Dengine fire-scene orthomosaic (222.7 MB, UTM 16N, 1.9 cm/px, 35% empty) displays as an Image Overlay with a see-through border, lined up with the basemap.
  - Tested from the desktop tool (10.8 MB at half size) and the browser engine (34.5 MB at 8192 px).
  - KMZ output imports and lines up.
- ✅ **GDAL read-back** of every output:
  - position within 1–2 cm,
  - see-through area matches the source to 99.9%+,
  - 31–41 dB image fidelity at quality 70.
- ✅ **Offline page:**
  - zero network requests with the basemap off; Esri-only with it on,
  - no blocked-request errors,
  - the real orthomosaic converts identically to the development version.
- ⚠️ Not yet confirmed: iTAK, TAK Aware, WebTAK; ATAK 5.7 / 5.8 (expected to match 5.6); the CloudTAK plugin build.

## Building from source

The offline page is generated from `web/template.html`, `web/app.js` and the shared engine in `cloudtak-plugin/`:

```bash
npm install --ignore-scripts
```
```bash
npm run build:offline
```

This writes `dist/map-compressor-offline.html` and `dist/THIRD-PARTY-LICENSES.txt`, the licences of the open-source libraries bundled into it (MIT, BSD-3-Clause, Apache-2.0, CC0).

```
atak-plugin/              native ATAK plugin (Android, uses ATAK's built-in GDAL); see docs/atak-plugin-plan.md
map_compress.py           desktop / batch tool (Python, rasterio)
web/                      offline page source (template + app)
cloudtak-plugin/          CloudTAK plugin and the shared browser engine
tools/build-offline.mjs   bundles everything into one HTML file
dist/                     built offline page + third-party licences
docs/                     ATAK format notes from device testing
```

## License

MIT. See [LICENSE](LICENSE).
