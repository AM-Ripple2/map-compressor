# Map Compressor User Manual

Version 0.1.1

Map Compressor turns large GeoTIFF maps, such as drone orthomosaics from PIX4Dreact or PIX4Dengine, into small map overlays that load quickly in TAK clients. The overlays keep their position on the map. The empty area around the flight stays **see-through**, so you don't get a black box around the imagery.

**Example:** a 223 MB PIX4D fire-scene orthomosaic became a 10–35 MB GeoTIFF that loads in ATAK and lines up with the basemap.

**Privacy:** everything runs on your own device. There's no account, no cloud and no upload. Your imagery leaves the device only when you share or send it yourself.

---

## Contents

1. [Which version should I use?](#1-which-version-should-i-use)
2. [ATAK plugin (Android)](#2-atak-plugin-android)
3. [Offline page (any computer)](#3-offline-page-any-computer)
4. [Desktop tool (batch conversion)](#4-desktop-tool-batch-conversion)
5. [Settings explained](#5-settings-explained)
6. [Output formats](#6-output-formats)
7. [Loading the result in each TAK client](#7-loading-the-result-in-each-tak-client)
8. [Recommended settings](#8-recommended-settings)
9. [Troubleshooting](#9-troubleshooting)
10. [Privacy details](#10-privacy-details)

---

## 1. Which version should I use?

| You want to… | Use | Download |
|---|---|---|
| Convert a map **on an Android device inside ATAK** and add it to the map straight away | **ATAK plugin** | APK for your ATAK version from the [latest release](https://github.com/AM-Ripple2/map-compressor/releases/latest) |
| Convert on a **laptop or desktop** (Windows, Mac, Linux), then send the file to any TAK client | **Offline page** | [map-compressor-offline.html](https://github.com/AM-Ripple2/map-compressor/releases/latest/download/map-compressor-offline.html) |
| Convert **a whole folder** of maps at once | **Desktop tool** | `map_compress.py` in this repository |

The output works in every TAK client whichever version you use to make it.

**Input:** a georeferenced GeoTIFF (`.tif` / `.tiff`). Most drone mapping software (PIX4D, DroneDeploy, WebODM and others) exports its orthomosaic as one.

---

## 2. ATAK plugin (Android)

### Requirements

- **ATAK-CIV 5.6, 5.7 or 5.8**, the normal Play Store or TAK.gov build.
- The plugin APKs are signed by TAK.gov, so no developer build of ATAK is needed.

### Install

1. Find your ATAK version on ATAK's **About** screen (for example, 5.6.0.13 means 5.6).
2. Download the matching APK from the [latest release](https://github.com/AM-Ripple2/map-compressor/releases/latest):

   | ATAK | File |
   |---|---|
   | 5.8 | `ATAK-Plugin-MapCompressor-0.1.1--5.8.0-civ-release.apk` |
   | 5.7 | `ATAK-Plugin-MapCompressor-0.1.1--5.7.0-civ-release.apk` |
   | 5.6 | `ATAK-Plugin-MapCompressor-0.1.1--5.6.0-civ-release.apk` |

3. Open the APK on the device and tap **Install**. If Android asks, allow installs from your browser or file manager.
4. In ATAK, go to **Settings → Tool Preferences → Plugins**, find **Map Compressor** and load it.
5. ATAK may show that the plugin was signed through the TAK third-party pipeline. That's expected.

**Updating:** install the new APK over the old one. You don't need to uninstall first.

### Convert a map

1. Copy the GeoTIFF onto the device, for example into the **Download** folder.
2. Open **Map Compressor** from the ATAK toolbar or the **Tools** menu. A side pane opens.
3. Tap **Choose GeoTIFF…** and pick your file. The browser starts in the Download folder. The pane shows the map's size, pixel dimensions and coordinate system.
4. Adjust the settings:
   - **Image size:** *Up to 8192 px (recommended)*.
   - **Empty areas:** *Transparent (recommended)*.
   - **Quality:** drag between *Smaller file* and *Sharper map*. The default is 70. The **estimated GeoTIFF size** updates as you drag.
5. Optional: use the **Detail check** to compare the original and compressed image at full pixel size. Tap **Check another spot** to look somewhere else, for example at small text or road markings.
6. Tap **Convert & add to map**. A progress bar shows the steps. A 223 MB orthomosaic takes about 1 minute on a recent phone.
7. When it's done, the overlay is added to the map and the map zooms to it. The status line shows the saved file name, its size and how much smaller it is.

The file is saved to **`atak/grg/<map name>_q<quality>.tif`** on the device, for example `atak/grg/FireScene_q70.tif`. ATAK lists it with your other overlays.

### Share it

Tap **Share…** after converting. This opens ATAK's normal send dialog, where you can pick contacts, a TAK Server or a Data Sync mission. Recipients get the standard "file received" prompt. The file can also be found and shared later from **Overlay Manager**.

---

## 3. Offline page (any computer)

### Requirements

- Chrome, Edge, Firefox or Safari on Windows, Mac or Linux.
- No install, no internet and no admin rights. It also runs from a USB stick or a shared drive.

### Convert a map

1. Download [`map-compressor-offline.html`](https://github.com/AM-Ripple2/map-compressor/releases/latest/download/map-compressor-offline.html) and double-click it.
2. The green banner should read **"Offline: nothing leaves this device."**
3. Click **Choose a GeoTIFF map**, or drag the file onto that box. The page shows the file name, size, pixel dimensions and coordinate system.
4. Set the **Image size**, **Fill for empty areas** and **Quality** (see [Settings explained](#5-settings-explained)). The size estimate updates as you change them.
5. Check the preview:
   - **On the map:** the compressed image is drawn exactly where TAK will place it. Use **Preview opacity** to see through it.
   - **Optional basemap:** tick **Show online satellite basemap (Esri)** to check alignment against imagery. This needs internet, and the banner turns orange while it's on (see [Privacy details](#10-privacy-details)).
   - **Detail check:** click a spot on the small map, then compare the original and compressed image at full pixel size.
6. Click one of:
   - **Download GeoTIFF** (recommended): one file, with see-through empty areas.
   - **Download KMZ**: for clients or workflows that need KMZ. Empty areas are filled black or white.
   - **Download Data Package**: the GeoTIFF wrapped as an ATAK data package `.zip`, for TAK Server, Data Sync or Import Manager.
7. Send or copy the file to your TAK device (see [Loading the result](#7-loading-the-result-in-each-tak-client)).

On a narrow screen or phone, the map appears on top and the controls appear below it.

---

## 4. Desktop tool (batch conversion)

For converting many maps at once from a terminal.

### Install (once, needs internet)

Python 3.9 or newer is required. Download the repository (green **Code → Download ZIP** button on GitHub), unzip it, open a terminal in that folder and run:

```bash
pip install -r requirements.txt
```

After this it works offline.

### Use

```bash
python map_compress.py ./originals -o ./atak_maps -q 70 --max-dim 8192 -f geotiff
```

This converts every GeoTIFF in `./originals` and writes the results to `./atak_maps`.

| Option | Meaning | Default |
|---|---|---|
| `inputs` | GeoTIFF files and/or folders | (required) |
| `-o FOLDER` | output folder | `atak_maps` |
| `-q 70` | JPEG quality, 1–95 | 70 |
| `-f geotiff,kmz,jpeg` | which outputs to make | `kmz,geotiff` |
| `--max-dim 8192` | shrink so the longest side is at most this many pixels | full size |
| `-r` | include sub-folders | off |
| `--background black\|white` | fill colour for empty areas in KMZ / JPEG output. GeoTIFF stays see-through. | black |
| `--package NAME` | also bundle the results into one ATAK data package, `NAME.zip` | off |

---

## 5. Settings explained

### Image size

Limits the longest side of the output, in pixels.

| Option | When to use it |
|---|---|
| **Up to 8192 px (recommended)** | Best balance for most orthomosaics. Sharp at normal working zoom, and a much smaller file. |
| **Full resolution** | When you need every pixel, for example to read small text or inspect damage closely. The file is much larger. |
| **Up to 4096 px** | For slow networks or older devices. Fine for an overview. |
| **Up to 2048 px** | Smallest file. Good for a quick situational overview or a very low-bandwidth link. |

Maps already smaller than the limit are not enlarged.

### Empty areas (fill)

Drone orthomosaics are irregular shapes inside a rectangle. The area outside the flight has no data.

- **Transparent (recommended):** the empty area is see-through and the basemap shows around your imagery. GeoTIFF output only.
- **Black / White:** fills the empty area with a solid colour. Use it if a client has trouble with transparency. KMZ is always filled.

### Quality

JPEG compression quality, from 10 to 95 in steps of 5 (default **70**).

- **Lower** means a smaller file but softer detail, with possible blocky patches in fine texture.
- **Higher** means sharper detail but a larger file.
- Most orthomosaics look good at **60–75**. Above 85, the file grows a lot for little visible gain.

Use the **Detail check** to judge it. Pick a spot with fine detail, such as text, vehicles or road lines, and compare **Original** and **Compressed**.

---

## 6. Output formats

| Format | What it is | See-through empty areas | Best for |
|---|---|---|---|
| **GeoTIFF** (recommended) | One `.tif` file, WGS84, JPEG-compressed tiles with built-in zoom levels | ✅ Yes | ATAK, iTAK, TAK Aware, WebTAK, CloudTAK |
| **KMZ** | JPEG image + KML ground overlay in a `.kmz` | ❌ No (black or white) | Google Earth, or clients that only take KMZ |
| **Data Package** | `.zip` with a TAK manifest around the GeoTIFF (or KMZ) | Same as what's inside | TAK Server, Data Sync, sending as one package |
| JPEG set (desktop tool only) | `.jpg` with `.jgw`, `.prj`, `.aux.xml` | ❌ No | Copying directly into `atak/imagery/` |

---

## 7. Loading the result in each TAK client

| Client | How to load it | Status |
|---|---|---|
| **ATAK** (5.6) | **Import Manager → Image Overlay File** → pick the `.tif` or `.kmz`. Or open a Data Package from Import Manager. The ATAK plugin adds the overlay for you. | ✅ Tested |
| **ATAK** (5.7, 5.8) | Same as above | Expected to match 5.6; please report results |
| **iTAK** | Import the GeoTIFF or Data Package (Files app, AirDrop, or received from another user) | Please report results |
| **TAK Aware** | Import the GeoTIFF or Data Package | Please report results |
| **WebTAK / CloudTAK** | Upload the GeoTIFF or Data Package through the client's import or files menu | Please report results |

**Sending to a team:** send the GeoTIFF or Data Package the way you normally share files: ATAK's send dialog, a TAK Server Data Package, or a Data Sync mission. A smaller file reaches field devices much faster over cellular or mesh links.

---

## 8. Recommended settings

| Situation | Image size | Quality | Format | Typical result from a ~220 MB ortho |
|---|---|---|---|---|
| **Everyday use** (default) | Up to 8192 px | 70 | GeoTIFF | about 30–35 MB (tested) |
| **Low bandwidth / many recipients** | Up to 4096 px | 60 | GeoTIFF | roughly a quarter of the 8192 px size |
| **Close inspection** (text, damage) | Full resolution | 80 | GeoTIFF | larger. Check the estimate before sending. |
| **Client without transparency support** | Up to 8192 px | 70 | KMZ | similar to GeoTIFF, black or white border |

Results depend on the image. Busy scenes such as forest or rubble compress less than open ground or rooftops.

---

## 9. Troubleshooting

| Problem | What to try |
|---|---|
| **Map Compressor isn't in the ATAK plugin list** | Check that the APK matches your ATAK version (5.6 / 5.7 / 5.8). Restart ATAK and look in **Settings → Tool Preferences → Plugins**. |
| **ATAK says the signature is invalid** | You may have an old developer build installed. Uninstall Map Compressor and install the TAK.gov-signed APK from the latest release. |
| **"Choose GeoTIFF" can't see my file** | Make sure the file ends in `.tif` or `.tiff` and is in device storage (for example, Download), not only in a cloud app. |
| **The overlay is in the wrong place** | The GeoTIFF may be missing its georeferencing, or use an unusual coordinate system. Please report it with the coordinate system shown when the file was loaded. |
| **There's a black box around the imagery** | Use the **GeoTIFF** output with **Transparent** empty areas. KMZ can't be transparent. |
| **The overlay looks blurry when zoomed in** | Increase **Quality** or choose a larger **Image size** (or Full resolution). |
| **The file is still too big** | Lower **Image size** first (8192 → 4096), then lower **Quality**. |
| **Conversion is slow or the device runs out of memory** | Very large inputs (over 500 MB) need a lot of memory. Use **Up to 8192 px** or smaller, or convert on a computer with the offline page or desktop tool. |
| **The offline page shows nothing on the map** | That's normal with the basemap off: the background is plain grey until you load a map. Tick the basemap box to see satellite imagery (needs internet). |

When you report a problem, include your device, TAK client and version, the input file's size, the coordinate system (for example UTM 16N) and the software that made the map. Report it at <https://github.com/AM-Ripple2/map-compressor/issues>.

---

## 10. Privacy details

- **No account, no cloud, no server.** Conversion happens in the app or browser you're using.
- **The offline page makes no network requests** with the basemap off. A built-in Content Security Policy blocks every request except the optional basemap.
- **The optional satellite basemap** downloads map tiles from Esri. This reveals the *area* you're viewing to Esri, never your image. The banner turns orange while it's on, and it's off every time you open the page.
- **The ATAK plugin** uses ATAK's built-in GDAL and doesn't connect to the internet. Files are only sent when you tap **Share…**.
- **Nothing is shared** until you choose to download, send or share a file.
