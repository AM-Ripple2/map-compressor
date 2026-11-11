# Testing Map Compressor (pre-release)

Thanks for testing. This is version 0.1, before TAK.gov signing. Please report problems as GitHub issues on this repository. Include your device, TAK client and version, and the input map's size, coordinate system (e.g. UTM 16N) and source software (e.g. PIX4Dreact).

Download links are at the top of the README (also on the **Releases** page, `v0.1.0-test`).

## 1. Offline page (anyone, any computer)

1. Download `map-compressor-offline.html` and open it in Chrome, Edge, Firefox or Safari. No install or internet is needed.
2. Choose a GeoTIFF. Try the **quality** slider and **image size**, and check that the preview lands in the right place.
3. Click **Download GeoTIFF** and load the result in your TAK client:
   - **ATAK:** Import Manager → Image Overlay File.
   - **iTAK / TAK Aware / WebTAK / CloudTAK:** import the GeoTIFF or the Data Package.

Check:
- the overlay lines up with the basemap,
- empty borders are see-through (GeoTIFF),
- the overlay is sharp enough at the zoom you use,
- the file size is reasonable.

## 2. ATAK plugin (Android)

- **ATAK-CIV 5.6:** `MapCompressor-ATAK-5.6.0.apk` is **signed by TAK.gov** and loads in normal Play Store / TAK.gov ATAK. ATAK marks it as signed through the third-party pipeline, which is expected.
- **ATAK 5.7 / 5.8:** these builds are still being signed. Until then they load only in the **developer ATAK** from the ATAK SDK. Normal ATAK shows "The signature for the plugin is INVALID".

1. Install the APK that matches your ATAK version: `MapCompressor-ATAK-5.6.0.apk`, `-5.7.0.apk` or `-5.8.0.apk`.
2. In ATAK: **Settings → Tool Preferences → Plugins**, then load **Map Compressor**.
3. Open **Map Compressor** from the toolbar/Tools menu. Pick a GeoTIFF, set the quality, and tap **Convert & add to map**.

Check:
- the overlay is added and the map zooms to it,
- the border is see-through,
- **Share…** sends the file to another TAK user.

## What we especially want to hear

- Maps that fail to load, or land in the wrong place (please include the coordinate system).
- Results on iTAK and TAK Aware.
- Large inputs (>500 MB): time taken, and whether the device ran out of memory.
