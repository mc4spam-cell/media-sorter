#!/usr/bin/env bash
#
# release.sh — build Media Sorter for THIS machine, check the result, and
# (optionally) publish it to the GitHub release of the current version.
#
#   bash scripts/release.sh               build + publish (asks before tagging)
#   bash scripts/release.sh --no-upload   build + check only (local testing)
#
# Options:
#   --no-upload   don't tag / create the release / upload
#   --no-install  skip `npm ci` (reuse node_modules as is — only if you know)
#   --yes         answer yes to every question (unattended runs)
#   -h, --help    this help
#
# One script for the four targets, picked from the machine it runs on:
#
#   macOS Intel          mac-x64      Media Sorter-<v>-x64.dmg
#   macOS Apple Silicon  mac-arm64    Media Sorter-<v>-arm64.dmg
#   Linux x86_64         linux-amd64  media-sorter_<v>_amd64.deb + AppImage
#   Linux aarch64        linux-arm64  media-sorter_<v>_arm64.deb
#
# Each target must be built ON that platform: `npm ci` fetches the ffmpeg
# binary of the host only, so a cross-built package would ship the wrong one
# (no video thumbnails, no PNG/WebP rotation). The script refuses to try.
#
# Written for the bash 3.2 that ships with macOS.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---------- output ----------
info() { printf '\033[36m•\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

YES=0
UPLOAD=1
INSTALL=1
for a in "$@"; do
  case "$a" in
    --no-upload) UPLOAD=0 ;;
    --no-install) INSTALL=0 ;;
    --yes|-y) YES=1 ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $a (see --help)" ;;
  esac
done

# confirm "question" — default No; --yes answers yes. `|| true` so a closed
# stdin doesn't trip `set -e`.
confirm() {
  if [ "$YES" -eq 1 ]; then return 0; fi
  local ans
  read -rp "$1 [y/N] " ans || true
  case "${ans:-N}" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

# ---------- 1. environment ----------
step "Environment"

# A `PATH=...` export that forgot `:$PATH` drops the system directories; the
# mac build then fails with "spawn sips ENOENT". Put them back.
for d in /usr/bin /bin /usr/sbin /sbin; do
  case ":$PATH:" in *":$d:"*) ;; *) PATH="$PATH:$d"; warn "$d was missing from PATH — added." ;; esac
done
# Homebrew (Node) is not in PATH by default without a ~/.zprofile.
for d in /opt/homebrew/bin /usr/local/bin; do
  if [ -d "$d" ]; then case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac; fi
done
export PATH

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS/$ARCH" in
  Darwin/arm64)          TARGET=mac-arm64;   EB_ARCH=--arm64; FF_ARCH="arm64" ;;
  Darwin/x86_64)
    # An Apple Silicon Mac running this terminal under Rosetta reports x86_64.
    if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
      die "This terminal runs under Rosetta (x86_64 emulation) on an Apple Silicon Mac. Open a native terminal (uncheck 'Open using Rosetta')."
    fi
    TARGET=mac-x64;     EB_ARCH=--x64;   FF_ARCH="x86_64" ;;
  Linux/x86_64)          TARGET=linux-amd64; EB_ARCH=--x64;   FF_ARCH="x86-64" ;;
  Linux/aarch64|Linux/arm64) TARGET=linux-arm64; EB_ARCH=--arm64; FF_ARCH="aarch64" ;;
  *) die "Unsupported platform: $OS/$ARCH (macOS or Linux, x86_64 or arm64)." ;;
esac
ok "Target: $TARGET ($OS $ARCH)"

command -v git >/dev/null 2>&1 || die "git is missing."

# Node: the version package.json's "engines" asks for (>= x.y.z).
NEED_NODE="$(sed -n 's/.*"node": *">=\([0-9.]*\)".*/\1/p' package.json | head -1)"
NEED_NODE="${NEED_NODE:-18.0.0}"

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e '
    const need = process.argv[1].split(".").map(Number);
    const have = process.versions.node.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if ((have[i] || 0) > (need[i] || 0)) process.exit(0);
      if ((have[i] || 0) < (need[i] || 0)) process.exit(1);
    }
  ' "$NEED_NODE"
}
# Debian/Ubuntu ship an old standalone `npm` package (9.x) that breaks with a
# newer Node; the npm bundled with Node 22 is 10.x.
npm_ok() {
  command -v npm >/dev/null 2>&1 || return 1
  [ "$(npm -v | cut -d. -f1)" -ge 10 ]
}

if ! node_ok || ! npm_ok; then
  have="node $(node -v 2>/dev/null || echo none), npm $(npm -v 2>/dev/null || echo none)"
  if [ "$OS" = "Linux" ] && command -v apt-get >/dev/null 2>&1; then
    warn "Need Node >= $NEED_NODE with its own npm 10+ (have: $have)."
    if confirm "Replace them with Node 22 from NodeSource (removes apt's nodejs/npm)?"; then
      sudo apt-get remove -y npm nodejs || true
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs
      hash -r
    fi
    node_ok && npm_ok || die "Still not right: $(node -v 2>/dev/null) / npm $(npm -v 2>/dev/null)."
  else
    die "Need Node >= $NEED_NODE with npm 10+ (have: $have). On macOS: brew install node"
  fi
fi
ok "Node $(node -v), npm $(npm -v)"

# ---------- 2. source tree and version ----------
step "Source"
V="$(node -p "require('./package.json').version")"
TAG="v$V"
HEAD_SHA="$(git rev-parse HEAD)"
info "Version $V, commit $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

DIRTY=0
git diff --quiet && git diff --cached --quiet || DIRTY=1

git fetch --tags --quiet 2>/dev/null || warn "git fetch failed (offline?) — using local tags."
TAG_SHA="$(git rev-parse -q --verify "refs/tags/$TAG^{commit}" 2>/dev/null || true)"

if [ "$UPLOAD" -eq 1 ]; then
  [ "$DIRTY" -eq 0 ] || die "Uncommitted changes — commit or stash them before publishing."
  if [ -n "$TAG_SHA" ]; then
    # Every machine must build the tagged commit, not whatever is checked out.
    [ "$TAG_SHA" = "$HEAD_SHA" ] || die "$TAG points to $(git rev-parse --short "$TAG_SHA"), not HEAD. Run: git checkout $TAG"
    ok "HEAD is $TAG."
  else
    [ -n "$(git branch -r --contains HEAD 2>/dev/null)" ] || die "HEAD isn't pushed yet — git push first."
    confirm "Tag $TAG doesn't exist. Create it at $(git rev-parse --short HEAD) and push it?" || die "Aborted: $TAG is required to publish."
    git tag -a "$TAG" -m "Media Sorter $V"
    git push origin "$TAG"
    ok "Created and pushed $TAG."
  fi
else
  [ "$DIRTY" -eq 0 ] || warn "Uncommitted changes — building them anyway (--no-upload)."
  [ -n "$TAG_SHA" ] && [ "$TAG_SHA" != "$HEAD_SHA" ] && warn "HEAD is not $TAG (local test build)."
  true
fi

# ---------- 3. dependencies ----------
step "Dependencies"
if [ "$INSTALL" -eq 1 ]; then
  # Always reinstall from the lockfile: node_modules left by another branch
  # would silently build the wrong Electron, and ffmpeg-static must be the
  # binary of THIS machine.
  info "npm ci…"
  npm ci --no-audit --no-fund
else
  warn "Skipping npm ci (--no-install)."
fi
EB="./node_modules/.bin/electron-builder"
[ -x "$EB" ] || die "electron-builder missing — run without --no-install."
ok "Electron $(node -p "require('electron/package.json').version"), electron-builder $(node -p "require('electron-builder/package.json').version")"

if [ "$TARGET" = "linux-arm64" ]; then
  # electron-builder's bundled fpm (the .deb packager) is an x86_64 build.
  if ! command -v fpm >/dev/null 2>&1; then
    warn "linux-arm64 needs the system fpm to build the .deb."
    confirm "Install it (sudo apt-get install ruby ruby-dev build-essential; sudo gem install fpm)?" \
      || die "fpm is required on arm64."
    sudo apt-get install -y ruby ruby-dev build-essential
    sudo gem install --no-document fpm
  fi
  export USE_SYSTEM_FPM=true
  ok "Using system fpm ($(command -v fpm))."
fi

# ---------- 4. build ----------
step "Build ($TARGET)"
case "$TARGET" in
  mac-*)
    rm -rf dist/mac dist/mac-arm64
    CSC_IDENTITY_AUTO_DISCOVERY=false "$EB" --mac dmg "$EB_ARCH"
    ;;
  linux-amd64)
    rm -rf dist/linux-unpacked
    "$EB" --linux deb AppImage "$EB_ARCH"
    ;;
  linux-arm64)
    # AppImage left out: its arm64 tooling is unreliable and the .deb is the
    # real target (it registers "Open with").
    rm -rf dist/linux-arm64-unpacked
    "$EB" --linux deb "$EB_ARCH"
    ;;
esac

# ---------- 5. check ----------
step "Check"
case "$TARGET" in
  mac-x64)     ARTIFACTS="dist/Media Sorter-$V-x64.dmg";   APPDIR="dist/mac/Media Sorter.app/Contents/Resources/app" ;;
  mac-arm64)   ARTIFACTS="dist/Media Sorter-$V-arm64.dmg"; APPDIR="dist/mac-arm64/Media Sorter.app/Contents/Resources/app" ;;
  linux-amd64) ARTIFACTS="dist/media-sorter_${V}_amd64.deb|dist/Media Sorter-$V.AppImage"; APPDIR="dist/linux-unpacked/resources/app" ;;
  linux-arm64) ARTIFACTS="dist/media-sorter_${V}_arm64.deb"; APPDIR="dist/linux-arm64-unpacked/resources/app" ;;
esac

IFS='|' read -r -a FILES <<< "$ARTIFACTS"
for f in "${FILES[@]}"; do
  [ -f "$f" ] || die "Expected artifact not found: $f"
  ok "$f ($(du -h "$f" | cut -f1))"
done

[ -f "$APPDIR/lib/undo.js" ] && [ -f "$APPDIR/lib/rotate.js" ] || die "lib/ is missing from the package ($APPDIR) — check build.files."
[ "$(node -p "require('./$APPDIR/package.json').version")" = "$V" ] || die "Packaged version isn't $V."
ok "Package contents (lib/, version $V)"

FF="$APPDIR/node_modules/ffmpeg-static/ffmpeg"
[ -x "$FF" ] || die "Bundled ffmpeg missing or not executable: $FF"
if command -v file >/dev/null 2>&1; then
  file "$FF" | grep -q "$FF_ARCH" || die "Bundled ffmpeg is not $FF_ARCH: $(file -b "$FF")"
  ok "ffmpeg is $FF_ARCH"
else
  warn "'file' not installed — skipped the ffmpeg architecture check."
fi
# WebP rotation needs libwebp; the app falls back to a system ffmpeg
# (/usr/bin/ffmpeg…) when the bundled one lacks it (Linux arm64 build).
if "$FF" -hide_banner -encoders 2>/dev/null | grep -q libwebp; then
  ok "ffmpeg can encode WebP (rotation)"
else
  SYS_FF=""
  for f in /usr/bin/ffmpeg /usr/local/bin/ffmpeg /opt/homebrew/bin/ffmpeg; do
    if [ -x "$f" ] && "$f" -hide_banner -encoders 2>/dev/null | grep -q libwebp; then SYS_FF="$f"; break; fi
  done
  if [ -n "$SYS_FF" ]; then
    ok "Bundled ffmpeg has no WebP encoder; the app will use $SYS_FF for WebP rotation."
  else
    warn "Bundled ffmpeg has no WebP encoder: on $TARGET, WebP rotation needs a system ffmpeg (sudo apt install ffmpeg) on the machine running the app."
  fi
fi

# Checking out a tag leaves git in "detached HEAD" (git warns about it): fine
# for building; this tells how to get back.
back_to_branch() {
  if ! git symbolic-ref -q HEAD >/dev/null; then
    echo
    info "You're on $(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD) (detached HEAD, expected after 'git checkout vX.Y.Z'). Back to main: git checkout main"
  fi
}

if [ "$UPLOAD" -eq 0 ]; then
  step "Done (not published)"
  for f in "${FILES[@]}"; do echo "  $f"; done
  case "$TARGET" in
    # From /tmp: apt can't read files in a private home directory as its _apt
    # user and prints a harmless "unsandboxed as root" notice otherwise.
    linux-*) echo; echo "Install: cp '${FILES[0]}' /tmp/ && sudo apt install '/tmp/$(basename "${FILES[0]}")'" ;;
  esac
  back_to_branch
  exit 0
fi

# ---------- 6. publish ----------
step "Publish $TAG"
command -v gh >/dev/null 2>&1 || die "GitHub CLI 'gh' is required to publish (https://cli.github.com) — or use --no-upload."
gh auth status >/dev/null 2>&1 || die "Not logged in to GitHub — run 'gh auth login'."

if gh release view "$TAG" >/dev/null 2>&1; then
  ok "Release $TAG exists."
else
  confirm "Create the GitHub release $TAG?" || die "Aborted."
  NOTES="$(mktemp)"
  # Release notes = this version's CHANGELOG section.
  awk -v v="$V" '
    $0 ~ "^## \\[" v "\\]" { on = 1; next }
    on && /^## \[/ { exit }
    on { print }
  ' CHANGELOG.md > "$NOTES"
  [ -s "$NOTES" ] || echo "Media Sorter $V — see CHANGELOG.md." > "$NOTES"
  gh release create "$TAG" --verify-tag --title "$TAG" --notes-file "$NOTES"
  rm -f "$NOTES"
  ok "Created release $TAG."
fi

for f in "${FILES[@]}"; do
  info "Uploading $(basename "$f")…"
  gh release upload "$TAG" "$f" --clobber
done
ok "Published: $(gh release view "$TAG" --json url -q .url)"
back_to_branch
