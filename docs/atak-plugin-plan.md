# Plan: native ATAK plugin

Goal: run Map Compressor **inside ATAK on the device**, fully offline: pick a GeoTIFF or orthomosaic, choose quality, and get a compact overlay that is added to the map and can be shared.

## Design

- **Conversion engine:** ATAK's bundled GDAL (`org.gdal.gdal`), the same library ATAK uses to read overlays.
  1. Warp to EPSG:4326.
  2. Translate to a JPEG-compressed GeoTIFF: `PHOTOMETRIC=RGB`, alpha band when there are empty areas, otherwise 3-band YCbCr.
  3. Build internal overviews.

  This is the format verified in ATAK 5.6 (see `atak-format-notes.md`). ATAK's GDAL has no WebP codec, so JPEG is used.
- **UI:** a toolbar button opens a drop-down pane with:
  - a file picker (device storage, Downloads, ATAK folders),
  - a quality slider with an estimated output size,
  - image size: up to 8192 px / full / 4096 / 2048,
  - fill for empty areas: transparent / black / white,
  - a detail check: original vs. compressed crop at 1:1, using Android's JPEG encoder at the chosen quality.
- **Actions:**
  - **Convert & add to map:** imports the result as an Image Overlay (GRG) through ATAK's import pipeline and zooms to it.
  - **Share:** hands the file to ATAK's send / data package flow (contacts, TAK Server).
  - **Save to Downloads.**
- **Offline:** no network permission is used.

## Prerequisites

1. **ATAK-CIV 5.6 SDK** from TAK.gov (account required), matching the target device (5.6.0.x).
2. **JDK 17 and the Android SDK** (command-line tools; Android Studio optional), plus the Android platform and build tools the SDK's plugin template specifies.
3. **A test device that doesn't run the user's operational ATAK:** a spare Android device, or an emulator. The SDK's developer ATAK uses the same package name as the Play Store ATAK with a different signature, so it can't be installed alongside it.
4. **For production devices:** TAK.gov third-party plugin signing. One signed build per ATAK version (5.6, 5.7, 5.8, …).

## Milestones

1. ✅ Toolchain: TAK.gov's unmodified plugin template builds for 5.6.0.26, 5.7.0.17 and 5.8.0.10.
2. ✅ Plugin source written: `atak-plugin/`, with GDAL conversion, pane UI, import to map, and share.
3. ✅ Compiles against all three SDKs. `atak-plugin/build-all.sh` produces 5.6, 5.7 and 5.8 APKs from one source tree.
4. ⏳ Runtime test in each SDK's developer ATAK, on an emulator or spare device: convert the PIX4D orthomosaic and verify the output with desktop GDAL and on the map.
5. ⏳ Submit to TAK.gov's third-party plugin pipeline for signed 5.6 / 5.7 / 5.8 builds.

## SDK licence

The TAK SDK may be used to derive plugins but not copied or redistributed. The SDKs live outside this repo (`../atak-sdk/`). `.gitignore` excludes SDK files (`main.jar`, the takdev jar, the keystore, `.takdev/`) and build outputs.

## Building

```bash
cd atak-plugin && ./build-all.sh
```

This needs JDK 17, the Android SDK (platform 36) and the ATAK SDKs unpacked as `../../atak-sdk/<version>/ATAK-CIV-<version>-SDK`. APKs land in `atak-plugin/apk/`.
