Map Compressor (ATAK plugin)


_________________________________________________________________
PURPOSE AND CAPABILITIES

Turns large GeoTIFF maps and drone orthomosaics (for example PIX4Dreact /
PIX4Dengine exports, often hundreds of MB) into small, georeferenced overlays
on the device, so they can be displayed and shared across TAK clients.

- Adds a "Map Compressor" tool (toolbar / Tools menu) that opens a pane.
- Pick a GeoTIFF with ATAK's file browser. Choose:
  - image size (up to 8192 px, full, 4096, 2048),
  - empty-area handling (transparent or black),
  - JPEG quality (slider with an estimated output size).
- Detail check: original vs. compressed crop at 1:1 before converting.
- Convert & add to map: uses ATAK's bundled GDAL to write a GeoTIFF with:
  - WGS84 (EPSG:4326),
  - JPEG-compressed 256 px tiles,
  - an RGBA alpha band when the map has empty areas (3-band YCbCr otherwise),
  - internal overviews.
  The result is written to atak/grg/, imported as an Image Overlay
  ("External GRG Data"), and the map zooms to it.
- Share...: opens ATAK's SendDialog for the produced file.

Example: a 223 MB PIX4D orthomosaic (8286 x 9166 px, 1.9 cm/px, UTM 16N,
35% empty) becomes a 31.6 MB overlay in about 50-80 s on a Galaxy S21. The
irregular flight border stays transparent and the overlay lines up with the
basemap.

_________________________________________________________________
STATUS

Developer preview, version 0.1. Tested with developer ATAK 5.6.0.26, 5.7.0.17
and 5.8.0.10 (Samsung Galaxy S21, Android 15). Output is byte-for-byte
identical across the three versions. Submitted to the Third Party Pipeline for
signed CIV builds for ATAK 5.6.0, 5.7.0 and 5.8.0.

_________________________________________________________________
POINT OF CONTACTS

Andrew McMillen (GitHub: AM-Ripple2)

_________________________________________________________________
PORTS REQUIRED

None. The plugin makes no network connections. All processing is local to
the device. Sharing is performed only by ATAK's own SendDialog, at the user's
request.

_________________________________________________________________
EQUIPMENT REQUIRED

An Android device running ATAK-CIV 5.6, 5.7 or 5.8.

_________________________________________________________________
EQUIPMENT SUPPORTED

Any device supported by ATAK. Conversion of very large inputs is limited by
device memory and storage. Default output is capped at 8192 px.

_________________________________________________________________
COMPILATION

Standard ATAK plugin build (AGP 8.13.0, Gradle 8.14.3, JDK 17, compileSdk 36,
targetSdk 36, minSdk 21). No third-party dependencies: only the ATAK SDK and
ATAK's bundled GDAL Java bindings (org.gdal.*).

- ATAK version: set by the atakVersion property (gradle.properties, default
  5.8.0, or -PatakVersion=5.6.0 / 5.7.0).
- Build tooling: atak-gradle-takdev 3.+, via takrepo.url / takrepo.user /
  takrepo.password, or a local SDK via takdev.plugin and sdk.path.
- Locally, against unpacked SDKs: ./build-all.sh (BUILD_TYPE=Release for
  release builds).
- Single build: ./gradlew assembleCivRelease -PatakVersion=5.6.0

_________________________________________________________________
DEVELOPER NOTES

- Format choice was driven by device testing on ATAK 5.6:
  - ATAK's image overlay ignores GDAL internal masks (draws them black) but
    honours an alpha band.
  - ATAK's GDAL has no WebP codec.
  - Large GeoTIFFs without overviews do not display.
  Hence: JPEG + RGBA alpha band + internal overviews.
- Reprojection uses gdal.AutoCreateWarpedVRT (cubic). Encoding uses
  gdal.Translate. Overviews use Dataset.BuildOverviews (AVERAGE).
- Uses only plugin APIs present in ATAK 5.6 through 5.8: IPlugin,
  IHostUIService panes and toolbar items, ImportFileBrowserDialog,
  ImportExportMapComponent import intent, SendDialog,
  ATAKUtilities.scaleToFit.
- The 5.6 build notes ask for
  android.bundle.enableUncompressedNativeLibs=false. AGP 8.1+ removed that
  option and the SDK template (AGP 8.13) omits it, so it is not set.
