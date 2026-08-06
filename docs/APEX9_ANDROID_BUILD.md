# AeroLeadAI APEX9 — Android Build Guide

APEX9 is designed to let an Android phone act as the build/control machine through **Termux** while preserving the Windows installer/build path.

## What Android can do

- Install Node.js LTS, Git, zip/unzip through Termux.
- Install the project's npm dependencies.
- Run `npm run doctor` and `npm run verify`.
- Run the Next.js production build.
- Start the production server with `npm start`.
- Package a portable source/build bundle into `android/artifacts/`.
- Transfer that bundle to a Windows PC for the Windows installer.

## What Android does not do by default

The Windows installer is not built natively by Termux. The Windows build remains in `windows/build-windows.ps1` and the Windows installer remains `Install-AeroLeadAI.cmd` / `install-windows.ps1`.

## Install on Android

1. Install **Termux from a trusted/current source**.
2. Copy/extract the AeroLeadAI project into Termux-accessible storage.
3. In Termux, enter the project directory.
4. Run:

```bash
bash ./android/setup-termux.sh
```

## Build

```bash
bash ./android/build-aeroleadai.sh
```

The script creates a timestamped ZIP under:

`android/artifacts/`

## Run locally on Android

```bash
npm start
```

The Next.js server listens on the configured port (currently 5000). On Android, open the local address from the same device/browser.

## Recommended phone-to-Windows flow

**Android:** build + verify → create ZIP → transfer ZIP → **Windows:** run `Install-AeroLeadAI.cmd` or the Windows build script.

## Troubleshooting

- `pkg: command not found`: you are not running inside Termux.
- Node below 20: run `pkg upgrade` and `pkg install nodejs-lts`.
- npm registry/network errors: retry on a stable connection; APEX9 does not bypass npm registry failures.
- Storage permission errors: use Termux storage access and keep the project in a Termux-readable location.
