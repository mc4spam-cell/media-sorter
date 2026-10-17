#!/usr/bin/env bash
# Build and publish the Linux packages (.deb + AppImage). Must run on Linux so
# the bundled ffmpeg binary matches the platform (a macOS build would ship the
# macOS ffmpeg and video thumbnails would not work).
set -euo pipefail
source "$(dirname "$0")/release-lib.sh"

[[ "$(uname -s)" == "Linux" ]] || die "Run this on Linux (for the correct ffmpeg binary)."
require_gh
ensure_deps
ensure_clean_tree

V="$(version)"; TAG="v$V"
info "Releasing Linux (amd64) — $TAG"
ensure_tag "$TAG"
ensure_release "$TAG"

info "Building .deb + AppImage…"
./node_modules/.bin/electron-builder --linux AppImage deb

shopt -s nullglob; artifacts=( dist/*.deb dist/*.AppImage ); shopt -u nullglob
[ "${#artifacts[@]}" -gt 0 ] || die "No Linux artifacts produced in dist/."
upload "$TAG" "${artifacts[@]}"
