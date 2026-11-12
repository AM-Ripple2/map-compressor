# Changelog

## 0.1.1 (ATAK plugin): ready for the TAKwerx Market

- **Explicit `versionCode` per ATAK version** (10156 / 10157 / 10158 for 0.1.1). TAK.gov builds previously came back as versionCode 1, which blocks MDM updates and Market listing. Every release now gets a higher code.
- **`versionName`** is now `0.1.1 - [5.x.0]`, with no empty git hash.
- No functional changes from 0.1.0.

## Unreleased: native ATAK plugin (developer preview)

- **`atak-plugin/`:** Map Compressor runs inside ATAK. It adds a toolbar tool and a side pane with:
  - ATAK's file browser,
  - image size and empty-area options,
  - a quality slider with an estimated size,
  - an original-vs-compressed detail check.
- **Convert & add to map** uses ATAK's built-in GDAL to write the ATAK-verified format: WGS84, RGBA alpha band, JPEG tiles and zoom levels. It imports the result as an Image Overlay.
- **Share…** opens ATAK's send dialog.
- **One source tree builds for ATAK 5.6, 5.7 and 5.8** (`build-all.sh`). All three compile against their TAK.gov SDKs.
- **Tested on a Galaxy S21 with developer ATAK 5.6.0.26, 5.7.0.17 and 5.8.0.10:** a 223 MB PIX4D orthomosaic converted on the phone in 50–80 s to a 31.6 MB transparent GeoTIFF, displayed lined up on the map. The output is byte-for-byte identical across the three versions.
- **Toolbar icon** is a white-on-transparent glyph, so it renders correctly when ATAK tints toolbar icons.
- **The map zooms to the new overlay** automatically after *Convert & add to map*.
- **Not yet done:** TAK.gov third-party signing.

## 0.1.0 (2026-11-11): first release for team testing

- **GeoTIFF output** that keeps empty areas, such as orthomosaic borders, see-through in ATAK:
  - WGS84, RGBA alpha band, JPEG tiles and zoom levels.
  - Maps without empty areas use smaller 3-band YCbCr JPEG.
- **KMZ output** (JPEG GroundOverlay):
  - North-up maps use `LatLonBox`.
  - Other projections use `gx:LatLonQuad`, with no resampling.
- **ATAK Data Package output** (`MANIFEST/manifest.xml`) around the GeoTIFF or KMZ.
- **Three ways to run it:**
  - an **offline single-file page** (`dist/map-compressor-offline.html`) that makes no network requests unless you switch on the basemap,
  - the CloudTAK plugin, with Share to TAK Server,
  - a desktop command-line tool.
- **No cloud services.** The early Google Colab version was dropped so imagery is never uploaded.
- **Quality slider with a live map preview,** a side-by-side detail check, and real output sizes.
- **Inputs:**
  - RGB, RGBA, palette and 16-bit GeoTIFFs; UTM, Web Mercator, WGS84, State Plane (via proj4); rotated and control-point maps.
  - Reads the embedded overviews of large exports.
- **Verified on ATAK-CIV 5.6.0.13** with a real PIX4Dengine orthomosaic: 223 MB down to 10.8–34.5 MB, lined up, border see-through.
