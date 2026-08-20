#!/data/data/com.termux/files/usr/bin/bash
set -e
echo "AeroLeadAI production deploy"
command -v node >/dev/null || { echo "Node.js is required."; exit 1; }
echo "Node: $(node -v)"
echo "Installing dependencies..."
npm ci
echo "Running verification..."
npm run doctor
npm run verify
npm run apex:status
echo "Building..."
npm run build
echo "Deploying to Vercel..."
npx vercel login
npx vercel --prod
