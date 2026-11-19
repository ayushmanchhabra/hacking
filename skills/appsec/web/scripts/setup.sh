#!/usr/bin/env bash
#
# Fetch the OWASP Web Security Testing Guide (WSTG) documents into ./document
# so the web-appsec skill can test against the methodology locally.
#
# Only the WSTG `document/` directory is pulled, using a shallow, blobless,
# sparse checkout, so this downloads a few MB rather than the whole repo.
#
# Usage: bash scripts/setup.sh   (run from anywhere; paths resolve to the skill)
#
set -euo pipefail

WSTG_REPO="https://github.com/OWASP/wstg.git"
WSTG_BRANCH="master"

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$SKILL_DIR/.wstg"      # persistent sparse checkout (git-ignored)
DEST="$SKILL_DIR/document"      # what the skill reads from (git-ignored)

if ! command -v git >/dev/null 2>&1; then
  echo "error: git is required but not found on PATH" >&2
  exit 1
fi

if [ -d "$SRC_DIR/.git" ]; then
  echo "Refreshing WSTG checkout in $SRC_DIR ..."
  git -C "$SRC_DIR" fetch --depth 1 origin "$WSTG_BRANCH"
  git -C "$SRC_DIR" reset --hard "origin/$WSTG_BRANCH"
else
  echo "Fetching OWASP WSTG document/ (shallow, blobless, sparse) ..."
  rm -rf "$SRC_DIR"
  git clone --filter=blob:none --no-checkout --depth 1 \
    --branch "$WSTG_BRANCH" "$WSTG_REPO" "$SRC_DIR"
  git -C "$SRC_DIR" sparse-checkout set --no-cone document
  git -C "$SRC_DIR" checkout
fi

if [ ! -d "$SRC_DIR/document" ]; then
  echo "error: WSTG document/ directory not found after checkout" >&2
  exit 1
fi

# Expose the docs at ./document. Prefer a relative symlink; fall back to a copy
# on systems where symlinks aren't available (e.g. some Windows setups).
if ln -sfn ".wstg/document" "$DEST" 2>/dev/null && [ -d "$DEST" ]; then
  :
else
  rm -rf "$DEST"
  cp -R "$SRC_DIR/document" "$DEST"
fi

count="$(find "$SRC_DIR/document" -name '*.md' | wc -l | tr -d ' ')"
echo "Done. $count WSTG markdown documents available at ./document"
echo "Start at ./document/README.md (the WSTG table of contents)."
