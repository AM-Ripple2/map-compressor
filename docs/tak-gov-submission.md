# Submitting the ATAK plugin to TAK.gov (Third Party Pipeline)

TAK.gov's **Third Party Pipeline (TPP)** builds, security-scans and signs third-party plugins, so they load in standard (Play Store / TAK.gov) ATAK-CIV. Unsigned developer builds only load in the developer ATAK that ships with each SDK.

## What's ready

| Package (generated in `dist-tpp/`, not committed) | Builds |
|---|---|
| `MapCompressor-0.1-src-ATAK-5.6.0.zip` | plugin for ATAK-CIV 5.6.0 |
| `MapCompressor-0.1-src-ATAK-5.7.0.zip` | plugin for ATAK-CIV 5.7.0 |
| `MapCompressor-0.1-src-ATAK-5.8.0.zip` | plugin for ATAK-CIV 5.8.0 |

- **Contents:** each zip is the `atak-plugin/` source (the template project layout) with `atakVersion` preset in `gradle.properties`. There are no SDK files, build outputs or local settings.
- **Regenerating:** run the packaging step again after any source change. The zips are built from git-tracked files only.
- **Checked before release:**
  - Release builds (`assembleCivRelease`: ProGuard plus ATAK lint) pass for all three versions against the matching SDKs.
  - The 5.6 zip builds unmodified from a clean folder.
  - On a Galaxy S21, the plugin works on developer ATAK 5.6.0.26, 5.7.0.17 and 5.8.0.10.
- **Reviewer notes:** `atak-plugin/README.md` follows the TAK template sections (purpose, status, contacts, ports, equipment, compilation, developer notes).

## Steps (done by you, signed in to tak.gov)

1. **Accept the TPP agreement.** Go to **tak.gov → Third Party Pipeline** (`/user_builds`) and read and accept the terms. Key points: submissions are built and scanned automatically in a temporary environment, you keep ownership of your code, and it's a monitored US Government system.
2. **Submit each package** for the ATAK version it targets (5.6.0, 5.7.0, 5.8.0), CIV flavor.
3. **Download the signed APKs** for each version when the builds finish.
4. **Test a signed APK** on a device running the matching **release** ATAK-CIV, for example the S21 after restoring ATAK 5.6.0.26:
   - The plugin appears under **Plugins**.
   - Convert a GeoTIFF; the overlay is added to the map, the map zooms to it, and the border is see-through.
5. **Distribute** the signed APKs: sideload, MDM, or your TAK Server's plugin repository.

## If the pipeline reports problems

- **Build failures:** the build log will show the cause. Common ones are an ATAK version mismatch (check `atakVersion` in `gradle.properties`) and lint errors.
- **Security scan findings:** the plugin has no network code and no third-party libraries. It uses only Android, the ATAK SDK and ATAK's bundled GDAL, so findings are most likely informational.
- **The `android.bundle.enableUncompressedNativeLibs=false` setting:** the 5.6 build notes ask for it, but AGP 8.1+ rejects it (removed option) and the SDK template omits it. If TPP insists, raise it with TAK.gov support.
