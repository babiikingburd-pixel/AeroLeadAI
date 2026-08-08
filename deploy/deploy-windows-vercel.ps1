$ErrorActionPreference = "Stop"
Write-Host "AeroLeadAI production deploy"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required." }
node --version
npm --version
npm ci
npm run doctor
npm run verify
npm run apex:status
npm run build
npx vercel login
npx vercel --prod
