#!/usr/bin/env bash
set -euo pipefail
umask 077

tag=${1:?Provide a release tag}
[[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Expected a stable tag such as v1.1.0'; exit 1; }
: "${APK_KEYSTORE_BASE64:?Missing release keystore}"
: "${APK_KEYSTORE_PASSWORD:?Missing release keystore password}"
tools="${ANDROID_HOME:?Missing Android SDK}/build-tools/37.0.0"
unsigned=android/app/build/outputs/apk/release/app-release-unsigned.apk
version=$("$tools/aapt" dump badging "$unsigned" | sed -n "s/^package:.* versionName='\([^']*\)'.*/\1/p")
[[ $tag == "v$version" ]] || { echo "Tag $tag does not match APK version $version"; exit 1; }

tmp=$(mktemp -d)
trap 'rm -f "$tmp/key.p12" "$tmp/aligned.apk"; rmdir "$tmp"' EXIT
printf '%s' "$APK_KEYSTORE_BASE64" | base64 --decode > "$tmp/key.p12"
"$tools/zipalign" -P 16 -f 4 "$unsigned" "$tmp/aligned.apk"
"$tools/apksigner" sign --ks "$tmp/key.p12" --ks-key-alias m14u --ks-pass env:APK_KEYSTORE_PASSWORD \
  --v4-signing-enabled false --out m14u.apk "$tmp/aligned.apk"
"$tools/apksigner" verify --print-certs m14u.apk
