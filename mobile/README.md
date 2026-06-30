# Stepstones Portal — Android app (Capacitor)

This wraps the live web portal (`https://cr-portal.vercel.app`) in a native Android shell.
Because `capacitor.config.json` uses `server.url`, the app always loads the **latest deployment** —
you do NOT rebuild the APK when you ship web changes. Rebuild only to change the icon, name, or native shell.

## Prerequisites (on your build machine)
- Node.js 18+
- Java JDK 17
- Android Studio (includes the Android SDK + Gradle)

## One-time setup
```bash
cd mobile
npm install
npx cap add android          # creates the android/ project
npm run assets               # generates launcher icons + splash from resources/icon.png & splash.png
npx cap sync
```

## Build the APK
Debug (for testing / sideload):
```bash
npm run build:debug
# output: mobile/android/app/build/outputs/apk/debug/app-debug.apk
```
Or open in Android Studio: `npx cap open android` → Run.

## Release build (for Play Store)
1. Create a signing keystore (keep it safe — you need it for every future update):
   ```bash
   keytool -genkey -v -keystore stepstones.keystore -alias stepstones -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Add signing config to `android/app/build.gradle` (or use Android Studio → Build → Generate Signed Bundle/APK).
3. `npm run build:release` → signed APK/AAB, then upload the **.aab** to Google Play Console.

## Notes
- App ID: `com.stepstones.crportal` — change in `capacitor.config.json` before first build if needed.
- Camera, microphone (voice notes) and file pickers work through the WebView; Android will prompt for
  permissions. If a permission is missing, add it to `android/app/src/main/AndroidManifest.xml`
  (INTERNET is added by default; add CAMERA / RECORD_AUDIO if prompts don't appear).
- Offline: this is a network app (Supabase). The shell shows a "Loading…" screen with no connection.

## Prefer no app store? Use the PWA instead
The site can also be made installable (Add to Home Screen, full-screen, offline shell) with a web
manifest + service worker — no Android build needed. Ask and I'll add it.
