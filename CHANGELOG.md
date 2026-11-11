# Changelog

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
