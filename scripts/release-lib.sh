#!/usr/bin/env bash
# Shared helpers for the per-architecture release scripts. Source this; don't
# run it directly. Each release-*.sh builds one architecture's artifacts and
# uploads them to the GitHub release for the current package.json version.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

info() { printf '\033[36m•\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# `|| true` so a closed stdin doesn't trip `set -e`; defaults to No.
confirm() {
  local ans
  read -rp "$1 [y/N] " ans || true
  [[ "${ans:-N}" =~ ^[Yy]$ ]]
}

require_gh() {
  command -v gh >/dev/null 2>&1 || die "GitHub CLI 'gh' is required (https://cli.github.com)."
  gh auth status >/dev/null 2>&1 || die "Not logged in — run 'gh auth login' first."
}

ensure_deps() {
  [ -x node_modules/.bin/electron-builder ] || die "electron-builder missing — run 'npm install' first."
}

ensure_clean_tree() {
  git diff --quiet && git diff --cached --quiet || die "Working tree not clean — commit or stash first."
}

version() { node -p "require('./package.json').version"; }

# Make sure the vX.Y.Z tag exists and is pushed, so all three machines release
# the same commit. Creates it from HEAD (with confirmation) if missing.
ensure_tag() {
  local tag="$1"
  git fetch --tags --quiet || true
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    info "Tag $tag already exists."
  else
    local sha; sha="$(git rev-parse --short HEAD)"
    confirm "Create tag $tag at $sha and push it?" || die "Aborted: tag $tag is required."
    git tag -a "$tag" -m "Release ${tag#v}"
    git push origin "$tag"
    info "Created and pushed $tag."
  fi
}

ensure_release() {
  local tag="$1"
  if gh release view "$tag" >/dev/null 2>&1; then
    info "GitHub release $tag already exists."
  else
    confirm "Create GitHub release $tag?" || die "Aborted: release $tag is required."
    gh release create "$tag" --title "$tag" --notes "Media Sorter ${tag#v} — see CHANGELOG.md."
    info "Created release $tag."
  fi
}

# upload <tag> <file...> — overwrites same-named assets (--clobber).
upload() {
  local tag="$1"; shift
  [ "$#" -gt 0 ] || die "No artifacts to upload."
  local f
  for f in "$@"; do
    [ -f "$f" ] || die "Artifact not found: $f"
  done
  for f in "$@"; do
    info "Uploading $(basename "$f")…"
    gh release upload "$tag" "$f" --clobber
  done
  info "Done. Release: $(gh release view "$tag" --json url -q .url 2>/dev/null || echo "$tag")"
}
