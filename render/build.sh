#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

upstream=node_modules/.m14u-saavn
revision=fc6bd132193d1fc71c2ab3db373e78b92884f67c
mkdir -p "$upstream"
cd "$upstream"
git init --quiet
git fetch --quiet --depth 1 https://github.com/sumitkolhe/jiosaavn-api.git "$revision"
git checkout --quiet --detach FETCH_HEAD
npx --yes bun@1.4.2 install --frozen-lockfile --ignore-scripts
npx --yes bun@1.4.2 run tsc --declaration false
npx --yes bun@1.4.2 run tsc-alias
