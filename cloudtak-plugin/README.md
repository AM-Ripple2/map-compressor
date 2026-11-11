# Map Compressor: CloudTAK plugin

Adds a **Map Compressor** item to CloudTAK's main menu. Users can:

1. **Pick a GeoTIFF or drone orthomosaic** (e.g. a PIX4Dreact export). It's converted in the browser, so the map never leaves the device until it's shared.
2. **Drag the quality slider.**
   - The compressed result appears live on the CloudTAK map, empty areas see-through, placed exactly where it will land.
   - A *detail check* compares original and compressed pixels side by side, starting on the busiest part of the map (usually small text).
   - The panel shows the real GeoTIFF and KMZ sizes.
3. **Export:**
   - **Download GeoTIFF** (recommended): WGS84, JPEG-compressed, built-in zoom levels, and an alpha band that keeps empty areas see-through (verified in ATAK).
   - **Download KMZ:** a JPEG overlay for ATAK's Import Manager (*Image Overlay File*). It can't be transparent.
   - **Download Data Package:** the GeoTIFF wrapped for TAK Server / Data Sync.
   - **Share to TAK Server:** pick channels, choose GeoTIFF or KMZ, and it's published as a Data Package for ATAK, WinTAK, iTAK and TAK Aware users on those channels.

## Files

| File | Purpose |
|---|---|
| `index.ts` | Plugin entry point: registers the menu item and route |
| `Panel.vue` | CloudTAK panel: hosts the UI and adds channel selection and sharing |
| `ui.js` / `ui.d.ts` | The panel UI (framework-free, also used by `../web/index.html`) |
| `core.js` | Reading: GeoTIFF → pixels and coordinates; KMZ / Data Package packaging |
| `geotiff-write.js` | In-browser GeoTIFF writer (WGS84 resampling, JPEG tiles, alpha band, overviews) |
| `jpeg-multi.js` | Small baseline JPEG encoder for the 4-band (RGBA) tiles, which browsers can't encode |
| `state.ts` | Holds the plugin API for the panel |

## Install into CloudTAK

Where the web app lives depends on the CloudTAK version. Run `curl https://<your-cloudtak>/api` to see which version you have.

| CloudTAK version | Web app folder (`<WEB>`) |
|---|---|
| 13.24.0 and similar older releases | `api/web` |
| current releases (13.122.x) | `app` |

The plugin API, `GroupSelect`, `std()` and `POST /api/marti/package` that this plugin uses are the same in both. Its relative imports (`../../src/...`) work from either folder.

```bash
cp -r cloudtak-plugin <CloudTAK>/<WEB>/plugins/map-compressor
```
```bash
cd <CloudTAK>/<WEB> && npm install geotiff@2.1.3 proj4@2.20.9 geotiff-geokeys-to-proj4@2026.10.9 fflate@0.8.2
```
Then rebuild and redeploy CloudTAK as usual. CloudTAK loads every `plugins/*/index.ts` automatically at build time, and the menu item appears after sign-in.

> **Pin geotiff to 2.x.** geotiff 3.x changed how TIFF tags are read, and `core.js` hasn't been tested with it.

## How the output is georeferenced

**GeoTIFF**
- Resampled onto a north-up WGS84 grid at the map's own ground resolution, with square pixels on the ground.
- Maps already in lat/lon keep their own grid, with no resampling.

**KMZ**
- North-up maps use a standard KML `LatLonBox`.
- Other maps (UTM, State Plane, rotated) keep their own projection and are pinned by their four corners (`gx:LatLonQuad`, the format ATAK's Rubber Sheet tool writes).

## Large orthomosaics

- **Embedded overviews:** when the output is smaller than the original, the panel reads the closest overview embedded in the GeoTIFF instead of decoding the full image. Export from PIX4Dreact with *Embedded overviews* on.
- **Default output size is 8192 px** on the longest side. *Full resolution* is available for maps the browser can hold in memory.
- **Test orthomosaic** (165 MB, 14,000 × 11,000 px, UTM, 32% empty):
  - loads in about 8 s,
  - GeoTIFF builds in about 3.2 s: 16.3 MB at 8192 px and quality 70.
  - Use a smaller image size for smaller files.

## Tested

- **In Chrome** via `../web/index.html`: a real 38.9 MB Web Mercator floor plan, the test orthomosaic, and UTM, rotated, palette, 16-bit, RGBA and control-point GeoTIFFs. A TIFF without coordinates is refused with a clear message.
- **Browser-made GeoTIFFs read back with GDAL:**
  - WGS84, RGBA alpha band, zoom levels.
  - Visible area matches the source to 99.99–100%.
  - Image fidelity 34–41 dB PSNR at quality 70.
- **ATAK-CIV 5.6.0.13** (Galaxy Tab S9+):
  - The alpha-band GeoTIFF format shows empty areas see-through as an Image Overlay.
  - The KMZ imported and lined up.
  - Not usable in ATAK: a GDAL internal mask (drawn black) and WebP (no codec).

## Not yet tested

- **The CloudTAK build itself.** `index.ts`, `Panel.vue` and the share call follow CloudTAK's source (checked against 13.24.0 and 13.122.8) but haven't been compiled into a CloudTAK instance.
- **On devices:** the browser-made GeoTIFF in ATAK; iTAK, TAK Aware and WebTAK; the data package.
- **Very large maps on iPhone/iPad.** Safari limits canvases to 16.7 megapixels, so bigger maps are automatically reduced to fit, and the panel says so.
