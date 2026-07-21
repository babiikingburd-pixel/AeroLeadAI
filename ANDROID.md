# AeroLeadAI — Android app

This wraps the existing Next.js app (deployed on Vercel) in a native Android
shell via [Capacitor](https://capacitorjs.com/). It is NOT a rewrite — the
native app just opens a WebView pointed at your live Vercel deployment, so
every feature (batch pipeline, ZIP scan, vision agents, etc.) works exactly
as it does in the browser, and future web changes ship to the Android app
automatically with zero rebuild, as long as they don't touch native config.

## Before you build — set the real production URL

`capacitor.config.json` currently points at:

```json
"server": { "url": "https://aero-lead-ai.vercel.app" }
```

That's a guess based on your Vercel project name — **verify it's your actual
production domain** (Vercel dashboard → your project → Domains) before
building, or the app will fail to load. If you use a custom domain, put that
here instead. After changing it, run `npm run cap:sync` to push the change
into the native project.

## One-time setup

1. Install Android Studio (you already have it) and open it at least once so
   it finishes installing the Android SDK.
2. `npm install`
3. `npm run cap:sync` — copies web config into the native project.
4. `npm run android:open` — opens `android/` in Android Studio (or open the
   `android` folder manually from Android Studio's "Open" dialog).

## Building

- **Run on a device/emulator (debug):** in Android Studio, press Run ▶ with
  a device selected. This installs a debug build that loads your live
  Vercel URL — no signing needed.
- **Build a release `.apk`/`.aab`:** Build → Generate Signed Bundle / APK.
  You'll need to create a signing keystore the first time (Android Studio
  walks you through this) — keep that keystore file safe, you need the same
  one for every future update. `.jks`/`.keystore` files are already excluded
  via `android/.gitignore` — never commit them.
- **Publish to the Play Store:** upload the signed `.aab` through the Play
  Console. You'll need a $25 one-time Play Developer account if you don't
  have one.

## What's native vs. what's web

- Native: app icon, splash screen, package identity (`com.aeroleadai.app`),
  install/launch behavior, INTERNET permission.
- Web (unchanged): every screen, the batch pipeline, ZIP scan, vision
  agents, auth, storage — all still served live from Vercel.
- File uploads (`<input type="file">` for roof/tree/driveway photos) work
  out of the box — Android's WebView already offers the native camera/
  gallery picker for those inputs, no extra native code needed.

## Changing the app id / name later

- App name: `android/app/src/main/res/values/strings.xml` (`app_name`).
- Package id: `applicationId` in `android/app/build.gradle` and
  `namespace` in the same file — change both together, and only before
  your first Play Store upload (changing it after publishing creates a
  new, separate app listing).
