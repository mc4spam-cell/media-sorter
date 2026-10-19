#!/usr/bin/env bash
#
# install-ubuntu.sh — build & install Media Sorter on Ubuntu / Debian
# (x86_64 or arm64). Run from inside the cloned repo:   bash install-ubuntu.sh
#
# The build itself (Node/npm check, npm ci, fpm on arm64, package checks) is
# scripts/release.sh --no-upload; this wrapper adds the system packages, the
# optional editors and the installation of the .deb.
#
set -euo pipefail

# ---- pretty output ----------------------------------------------------------
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# Always operate from the script's own directory (the project root).
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -f package.json ] || die "package.json not found — run this from the media-sorter project folder."

# ---- 1. system prerequisites ------------------------------------------------
info "Installing system prerequisites (git, curl, file, FUSE for AppImage)…"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates file libfuse2 \
  || sudo apt-get install -y git curl ca-certificates file libfuse2t64 || true

# ---- 2. optional editors (G / S shortcuts) ----------------------------------
# `|| true` so a closed stdin (non-interactive run) doesn't trip `set -e`;
# the default below (N) then applies.
read -rp "Install GIMP + Shotcut for the G/S shortcuts? [y/N] " ans || true
if [[ "${ans:-N}" =~ ^[Yy]$ ]]; then
  info "Installing GIMP and Shotcut…"
  sudo apt-get install -y gimp shotcut || warn "Could not install gimp/shotcut — skipping."
fi

# ---- 3. build (Node 22 + npm, npm ci, packages, checks) ---------------------
bash scripts/release.sh --no-upload

# ---- 4. install -------------------------------------------------------------
version="$(node -p "require('./package.json').version")"
case "$(uname -m)" in
  x86_64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) arch="$(uname -m)" ;;
esac
deb="dist/media-sorter_${version}_${arch}.deb"
[ -f "$deb" ] || die "Package not found: $deb"

echo
# `|| true` so a closed stdin doesn't trip `set -e`; default below (Y) applies.
read -rp "Install $deb system-wide now (adds it to your app menu)? [Y/n] " ans2 || true
if [[ ! "${ans2:-Y}" =~ ^[Nn]$ ]]; then
  info "Installing $deb …"
  sudo apt-get install -y "./$deb"
  bold "Installed. Launch 'Media Sorter' from your applications menu."
else
  bold "Not installed. Later: sudo apt install ./$deb"
fi
