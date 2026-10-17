#!/usr/bin/env bash
#
# install-ubuntu.sh — build & install Media Sorter on Ubuntu / Debian.
# Run from inside the cloned repo:   bash install-ubuntu.sh
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
info "Installing system prerequisites (git, curl, FUSE for AppImage)…"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates libfuse2 || sudo apt-get install -y git curl ca-certificates libfuse2t64 || true

# ---- 2. Node.js (need >= 18) ------------------------------------------------
need_node=0
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 18 ] || { warn "Node $(node -v) is too old (need >= 18)."; need_node=1; }
else
  warn "Node.js not found."
  need_node=1
fi

if [ "$need_node" -eq 1 ]; then
  info "Installing Node.js 20.x via NodeSource…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
info "Using Node $(node -v) / npm $(npm -v)"

# ---- 3. optional editors (G / S shortcuts) ----------------------------------
# `|| true` so a closed stdin (non-interactive run) doesn't trip `set -e`;
# the default below (N) then applies.
read -rp "Install GIMP + Shotcut for the G/S shortcuts? [y/N] " ans || true
if [[ "${ans:-N}" =~ ^[Yy]$ ]]; then
  info "Installing GIMP and Shotcut…"
  sudo apt-get install -y gimp shotcut || warn "Could not install gimp/shotcut — skipping."
fi

# ---- 4. build ---------------------------------------------------------------
info "Installing npm dependencies…"
npm install

info "Building Linux packages (AppImage + deb)…"
npm run dist:linux

# ---- 5. install -------------------------------------------------------------
appimage="$(ls dist/*.AppImage 2>/dev/null | head -1 || true)"
deb="$(ls dist/*.deb 2>/dev/null | head -1 || true)"

[ -n "$appimage" ] && chmod +x "$appimage"

echo
bold "Build complete."
[ -n "$appimage" ] && echo "  • AppImage : $appimage"
[ -n "$deb" ]      && echo "  • Debian   : $deb"
echo

if [ -n "$deb" ]; then
  # `|| true` so a closed stdin doesn't trip `set -e`; default below (Y) applies.
  read -rp "Install the .deb system-wide now (adds it to your app menu)? [Y/n] " ans2 || true
  if [[ ! "${ans2:-Y}" =~ ^[Nn]$ ]]; then
    info "Installing $deb …"
    sudo apt-get install -y "./$deb"
    bold "Installed. Launch 'Media Sorter' from your applications menu."
    exit 0
  fi
fi

if [ -n "$appimage" ]; then
  bold "To run the portable version:"
  echo "  $appimage"
  echo "(You can move it to ~/Applications and double-click it.)"
fi
