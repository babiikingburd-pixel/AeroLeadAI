# AeroLeadAI APEX8 — next build

This release focuses on turning the APEX7 codebase into a repeatable, buildable Windows deployment rather than adding another layer of speculative AI.

## Seven next improvements

1. **Windows zero-touch installer** — copies to `%LOCALAPPDATA%`, provisions Node LTS through WinGet when available, installs dependencies, builds, and can start the app.
2. **Build doctor / preflight gate** — verifies Node version, package integrity, required routes, installer assets, and the removal of the unused `xlsx` dependency before `next build`.
3. **Production lifecycle controls** — start/stop/uninstall scripts and a per-user startup task provide a simple local service lifecycle without requiring a Windows service wrapper.
4. **Environment safety** — `.env.local` is created only from the example template; no API keys are generated, embedded, or guessed by the installer.
5. **Deterministic dependency install** — Windows builds use `npm ci` against `package-lock.json`; the unused `xlsx` package was removed because no source file imports it and it was blocking package installation in the validation environment.
6. **Build verification command** — `npm run verify` gives a single pre-deploy gate that can be used locally or in CI before expensive production builds.
7. **Operational hardening foundation** — logs are written to `logs/server.log`, the launcher checks for an existing listener, and install/build failures stop immediately with actionable messages.

## Important build status

The source is prepared for a normal Windows/npm environment. The sandbox used for this packaging pass could not download npm tarballs from its restricted package mirror, so a complete `next build` could not be executed here. The installer is intentionally designed to run `npm ci` on the user's Windows machine using its configured npm registry.
