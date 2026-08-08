#!/data/data/com.termux/files/usr/bin/bash
# AeroLeadAI APEX 9.6 — Android/Termux production build + portable bundle.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
STAMP="$(date +%Y%m%d-%H%M%S)"
ART="$ROOT/android/artifacts"
mkdir -p "$ART"
[ -d node_modules ] || npm install --no-audit --no-fund
echo "== Build gates"
npm run doctor
npm run verify
npm run apex:status
echo "== Production build"
npm run build
BUNDLE="$ART/AeroLeadAI-APEX9.6-$STAMP.zip"
echo "== Packaging portable bundle -> $BUNDLE"
zip -qr "$BUNDLE" . \
  -x 'node_modules/*' -x '.next/cache/*' -x 'android/artifacts/*' \
  -x '.git/*' -x '.env.local' -x 'relay_app/build/*'
echo
echo "OK   Bundle: $BUNDLE"
echo "     Transfer to Windows and run Install-AeroLeadAI.cmd, or run 'npm start' here."
