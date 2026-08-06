#!/data/data/com.termux/files/usr/bin/bash
# AeroLeadAI APEX 9.6 — Termux environment setup.
set -euo pipefail
command -v pkg >/dev/null 2>&1 || { echo "FAIL: 'pkg' not found — this script must run inside Termux."; exit 1; }
echo "== Updating Termux packages"
pkg update -y && pkg upgrade -y
echo "== Installing toolchain (nodejs-lts, git, zip, unzip)"
pkg install -y nodejs-lts git zip unzip
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "FAIL: Node $(node -v) detected; APEX 9.6 requires Node 20+. Run 'pkg upgrade' and re-run."; exit 1
fi
echo "OK   Node $(node -v) / npm $(npm -v)"
echo "== Installing project dependencies"
npm install --no-audit --no-fund
echo "== Running build gates"
npm run doctor
npm run verify
echo
echo "Setup complete. Next: bash ./android/build-aeroleadai.sh"
