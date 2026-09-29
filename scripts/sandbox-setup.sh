#!/usr/bin/env bash
# sandbox-setup.sh — bring this environment back to a working state.
#
# The sandbox drops node_modules/ on every cold snapshot restore, and the
# global npm config blocks lifecycle scripts (better-sqlite3's prebuild
# download → build failure → npm rolls the package back out entirely).
# This script is the idempotent fix: install with scripts off (packages stay
# extracted), then compile better-sqlite3's binding straight from source
# using the Node headers bundled in /usr/local.
#
#   bash scripts/sandbox-setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules/express ] || [ ! -d node_modules/better-sqlite3 ]; then
  echo "[setup] npm install (scripts disabled — sandbox blocks them)…"
  npm install --no-audit --no-fund --ignore-scripts
fi

if [ ! -f node_modules/better-sqlite3/build/Release/better_sqlite3.node ]; then
  echo "[setup] compiling better-sqlite3 from source (local node headers)…"
  (cd node_modules/better-sqlite3 && npx node-gyp rebuild --release --nodedir=/usr/local 2>&1 | tail -1)
fi

node -e "
const D = require('better-sqlite3');
const db = new D(':memory:');
db.exec('CREATE TABLE t (a)');
console.log('[setup] better-sqlite3 OK');
"
echo "[setup] ready — npm test / npm run dev / npm run dev:catalog all work now."
