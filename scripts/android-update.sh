#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
adb -d get-state
npm run android:build
adb -d install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -d shell am start -n dev.m14u.app/.MainActivity
