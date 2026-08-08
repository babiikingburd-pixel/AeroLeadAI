# APEX8 build status

## Verified in packaging sandbox

- ZIP extracted successfully.
- `package.json` and `package-lock.json` parse as valid JSON.
- APEX8 doctor passes in non-build mode.
- Python self-improvement/evidence/worker modules pass `python -m compileall`.
- JavaScript doctor/prebuild scripts pass Node syntax checks.
- Unused `xlsx` dependency was removed from package metadata and lockfile because no application source imports it.

## Not honestly claimable here

A full `npm ci` / `next build` could not complete in this packaging sandbox because the sandbox's restricted npm mirror returned HTTP 404 for package tarballs. The APEX8 Windows installer therefore performs the final dependency install and production build on the target Windows machine using its configured npm registry.

Run after extraction on Windows:

```powershell
.\Install-AeroLeadAI.cmd -Start
```

Or build manually:

```powershell
.\Build-AeroLeadAI.cmd
```
