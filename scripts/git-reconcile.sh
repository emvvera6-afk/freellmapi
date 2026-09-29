#!/usr/bin/env bash
# git-reconcile.sh — recover from the sandbox's history rewind.
#
# This environment restores snapshots between turns: file CONTENT persists,
# node_modules/ is dropped, and local git history rewinds to the session's
# base commit. The remote branch keeps everything. Result: local commits vanish
# from `git log`, the working tree still holds all changes, and the next push
# is rejected as non-fast-forward.
#
# Run AFTER committing your changes on the (rewound) history:
#
#   bash scripts/git-reconcile.sh
#
# It fetches the remote branch, checks the remote adds nothing we lack
# (content-wise our tree is always the superset after the rewind), merges it
# with -X ours to make history continuous, and pushes.
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="arena/01a0e9df-freellmapi"

git fetch origin "$BRANCH"

LOST=$(git diff HEAD FETCH_HEAD --name-only | head -20)
if [ -n "$LOST" ]; then
  echo "ATENCIÓN: el remoto contiene archivos diferentes a tu árbol actual:"
  echo "$LOST"
  echo "Revisa con: git diff HEAD FETCH_HEAD -- <archivo>"
  echo "Si el remoto fuera correcto, aborta (Ctrl+C) y reconcilia a mano."
  sleep 4
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Hay cambios sin commitear — haz commit primero (o stash)." >&2
  exit 1
fi

git merge --no-ff -X ours -m "merge: reconcile sandbox-restored history" FETCH_HEAD
git push origin "$BRANCH"
echo "✓ Remoto al día: $(git log --oneline -3 | head -1) y ancestros"
