#!/usr/bin/env bash
# Build the Map Compressor ATAK plugin for every ATAK version whose SDK is present.
#   ATAK_SDK_ROOT  folder holding <version>/ATAK-CIV-<version>-SDK  (default: ../../atak-sdk)
#   ANDROID_HOME   Android SDK (default: ~/Library/Android/sdk)
#   BUILD_TYPE     Debug (default) or Release
set -euo pipefail
cd "$(dirname "$0")"
ATAK_SDK_ROOT="${ATAK_SDK_ROOT:-$(cd ../.. && pwd)/atak-sdk}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BUILD_TYPE="${BUILD_TYPE:-Debug}"
if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME="$(ls -d "$HOME"/Library/Java/JavaVirtualMachines/jdk-17*/Contents/Home 2>/dev/null | head -1)"
  export JAVA_HOME
fi
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > local.properties
mkdir -p apk
built=0
for sdk in "$ATAK_SDK_ROOT"/*/ATAK-CIV-*-SDK; do
  [ -f "$sdk/main.jar" ] || continue
  full="$(basename "$sdk" | sed -E 's/ATAK-CIV-(.*)-SDK/\1/')"   # e.g. 5.6.0.26
  atak="$(echo "$full" | cut -d. -f1-3)"                           # e.g. 5.6.0
  echo "=== Building for ATAK $atak (SDK $full)"
  ./gradlew --no-daemon -q clean "assembleCiv${BUILD_TYPE}" \
      -PatakVersion="$atak" -Psdk.path="$sdk" -Ptakdev.plugin="$sdk/atak-gradle-takdev.jar"
  find app/build/outputs/apk -name "*.apk" -exec cp {} apk/ \;
  built=$((built + 1))
done
[ "$built" -gt 0 ] || { echo "No ATAK SDKs found under $ATAK_SDK_ROOT"; exit 1; }
echo "=== APKs:"; ls -1 apk
