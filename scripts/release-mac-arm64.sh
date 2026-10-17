#!/usr/bin/env bash
# Build and publish the macOS Apple Silicon (arm64) DMG. Run on any Mac
# (electron-builder cross-builds arm64 with the --arm64 flag).
set -euo pipefail
source "$(dirname "$0")/release-lib.sh"

[[ "$(uname -s)" == "Darwin" ]] || die "Run this on macOS."
require_gh
ensure_deps
ensure_clean_tree

V="$(version)"; TAG="v$V"
info "Releasing macOS Apple Silicon (arm64) — $TAG"
ensure_tag "$TAG"
ensure_release "$TAG"

info "Building arm64 DMG…"
CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder --mac dmg --arm64

shopt -s nullglob; dmgs=( dist/*-arm64.dmg ); shopt -u nullglob
[ "${#dmgs[@]}" -gt 0 ] || die "No arm64 DMG produced in dist/."
upload "$TAG" "${dmgs[@]}"
