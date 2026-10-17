#!/usr/bin/env bash
# Build and publish the macOS Intel (x64) DMG. Run on any Mac (electron-builder
# cross-builds x64 with the --x64 flag).
set -euo pipefail
source "$(dirname "$0")/release-lib.sh"

[[ "$(uname -s)" == "Darwin" ]] || die "Run this on macOS."
require_gh
ensure_deps
ensure_clean_tree

V="$(version)"; TAG="v$V"
info "Releasing macOS Intel (x64) — $TAG"
ensure_tag "$TAG"
ensure_release "$TAG"

info "Building x64 DMG…"
CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder --mac dmg --x64

shopt -s nullglob; dmgs=( dist/*-x64.dmg ); shopt -u nullglob
[ "${#dmgs[@]}" -gt 0 ] || die "No x64 DMG produced in dist/."
upload "$TAG" "${dmgs[@]}"
