# Mobile (iOS and Android)

The iOS and Android apps are [Capacitor](https://capacitorjs.com/) shells around the same web build that GitHub Pages serves (see [ADR-0001](adr/0001-architecture.md)). The native projects live in `web/ios/` and `web/android/`, and `web/capacitor.config.ts` holds the shared settings:

- App ID (bundle ID / application ID): `io.github.isroma.solycerveza`
- App name: `Sol y Cerveza`
- Web assets: `web/dist`, the Vite output. `base: './'` in `vite.config.ts` keeps asset paths relative, which the WebView needs.

The native projects are committed. Their build outputs and the web assets copied into them are not (see `web/ios/.gitignore` and `web/android/.gitignore`).

## Local setup

Requirements for Capacitor 8:

- Node from `.nvmrc`, as for the web app.
- iOS: macOS with Xcode 26.0 or newer, plus an iOS Simulator runtime (Xcode > Settings > Components). The iOS project uses Swift Package Manager, so CocoaPods is not needed.
- Android: Android Studio 2025.2.1 (Otter) or newer, which ships the JDK 21 that Capacitor 8 needs, and an Android SDK with API 36. To build from the command line, set `ANDROID_HOME` (usually `~/Library/Android/sdk` on macOS) and `JAVA_HOME` to a JDK 21.

## Everyday commands

Run them from `web/`:

```sh
npm ci
npm run build           # web app into dist/
npx cap sync            # copy dist/ and the plugin config into ios/ and android/
npx cap open ios        # open the project in Xcode
npx cap open android    # open the project in Android Studio
```

Run `npm run build && npx cap sync` after every web change you want to see in the apps. `npx cap sync ios` or `npx cap sync android` syncs only one platform.

To run the app:

- iOS Simulator: in Xcode, pick the `App` scheme and a simulator, then Run. Or, from the terminal, `npx cap run ios` and choose a simulator.
- Android emulator: create a virtual device in Android Studio (Device Manager), then Run. Or `npx cap run android` and choose the emulator.

Live reload against the Vite dev server is possible (`server.url` in the Capacitor config), but it is not set up yet.

## What CI builds

`.github/workflows/mobile.yml` runs only by hand (`workflow_dispatch`: Actions → Mobile → Run workflow) while mobile is paused. It is not a required check. Both jobs build the web app and run `npx cap sync` for their platform, then:

- `android` (Ubuntu, JDK 21): `./gradlew assembleDebug`, and uploads the debug APK as the `sol-y-cerveza-debug-apk` artifact (kept 14 days). You can install it on a device or emulator with `adb install app-debug.apk`.
- `ios` (macOS 26, the runner's default Xcode): `xcodebuild` for the iOS Simulator with code signing disabled. It checks that the project compiles. It does not produce an installable artifact.

## Out of scope for now

- Geolocation to centre the map on the user (`@capacitor/geolocation`, plus the iOS and Android location permission strings). Follow-up to #7.
- App icons and splash screens: the projects still use Capacitor's defaults.
- Store distribution, which will need:
  - an Apple Developer Program membership, a distribution certificate and provisioning profile, and an App Store Connect record for the bundle ID;
  - a Google Play Console account and an upload keystore (Play App Signing), with the release build signed in CI from GitHub secrets;
  - store listings, a privacy policy and the permission justifications (location, once geolocation lands).
