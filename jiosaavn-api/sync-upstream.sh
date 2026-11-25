#!/usr/bin/env bash
set -euo pipefail

directory=$(cd -- "$(dirname -- "$0")" && pwd)
source_dir=$(mktemp -d)
trap 'rm -rf -- "$source_dir"' EXIT
git clone --quiet --depth 1 --single-branch --branch main https://github.com/ODSkyler/jiosaavn-api.git "$source_dir"
mkdir -p "$directory/upstream"
git -C "$source_dir" show HEAD:api/songs.js > "$directory/upstream/songs.js"
git -C "$source_dir" show HEAD:LICENSE > "$directory/upstream/LICENSE"
git -C "$source_dir" rev-parse HEAD > "$directory/upstream/REVISION"
