#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
  echo "Usage: $0 [--local [PORT]] (PORT defaults to 5173)" >&2
  exit 2
}

unset CAPACITOR_DEBUG_URL
port=''
if (( $# > 0 )); then
  [[ "$1" == --local ]] && (( $# <= 2 )) || usage
  port=${2-5173}
  [[ "$port" =~ ^[1-9][0-9]{0,4}$ ]] && (( port <= 65535 )) || usage
  export CAPACITOR_DEBUG_URL="http://127.0.0.1:${port}"
fi

device=(adb -d)
if [[ -n "${ANDROID_SERIAL:-}" ]]; then
  device=(adb -s "$ANDROID_SERIAL")
fi

"${device[@]}" get-state
npm run android:build
"${device[@]}" install -r android/app/build/outputs/apk/debug/app-debug.apk
if [[ -n "$port" ]]; then
  "${device[@]}" reverse "tcp:${port}" "tcp:${port}"
fi
"${device[@]}" shell am start -n dev.m14u.app/.MainActivity
