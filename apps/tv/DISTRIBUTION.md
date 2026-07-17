# apps/tv — Test builds for external stakeholders

How to get the TV app onto a stakeholder's Apple TV or Android TV / Google TV
**without full store publishing**. Android is a sideloadable APK; Apple TV goes
through TestFlight (tvOS cannot be casually sideloaded).

All builds use EAS. The native `ios/`/`android/` dirs are gitignored, so EAS runs
a fresh managed prebuild on its servers. `EXPO_TV=1` (set in every `eas.json`
build profile) plus `isTV: true` in `app.json` guarantee a TV target, not a phone.

## One-time setup (interactive — run these yourself)

```bash
cd apps/tv
npx eas-cli login                 # sign in to the jesus-film-project account
npx eas-cli init                  # creates the EAS project, writes extra.eas.projectId into app.json
```

The app reads its data URL at build time from `EXPO_PUBLIC_GRAPHQL_URL`
(and optional `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN`). These are embedded in the JS
bundle, so a stakeholder build must point at **production admin**, not localhost.
Set them as EAS environment variables per environment (do NOT commit them):

```bash
# point preview + production builds at prod admin GraphQL
npx eas-cli env:create --environment preview    --name EXPO_PUBLIC_GRAPHQL_URL --value <prod-admin-graphql-url> --visibility plaintext
npx eas-cli env:create --environment production --name EXPO_PUBLIC_GRAPHQL_URL --value <prod-admin-graphql-url> --visibility plaintext
# prod admin REQUIRES a search token: set EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN to TV's OWN fleet key
# (a dedicated entry in admin's FLEET_ADMIN_API_KEYS CSV — never mobile's value).
# Use --visibility sensitive, NOT secret: EAS rejects `secret` for EXPO_PUBLIC_* vars (they inline
# into the bundle, so the value is extractable by design — the abuse ceiling is the guard, not secrecy).
npx eas-cli env:create --environment preview    --name EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN --value <tv-fleet-key> --visibility sensitive
npx eas-cli env:create --environment production --name EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN --value <tv-fleet-key> --visibility sensitive
```

## Android TV / Google TV — sideloadable APK (easiest, no review)

```bash
cd apps/tv
npx eas-cli build --platform android --profile preview
```

EAS returns a public install URL for an **APK** (the `preview` profile forces
`buildType: apk` and `distribution: internal`, so no device registration).
Give stakeholders the link. They install it by either:

- **Downloader app** (by AFTVnews, from the Play Store): open the EAS URL, install.
- `adb connect <tv-ip>:<port> && adb install <file>.apk` over the network. The
  port is `5555` only on Android 11 and earlier; **Android 13/14 randomizes the
  Wireless-debugging port on every reboot** — read the current `IP:port` from
  _Settings → System → Developer options → Wireless debugging_ (and pair once via
  "Pair device with pairing code"). See the `/build-android` command for the full
  Android-14 `adb pair`/`adb connect` flow.
- A Google Drive link → a file manager on the TV.

First they must enable _Settings → Developer options → Install unknown apps_ for
whichever app opens the APK.

For managed invites/feedback instead of a raw link: upload the same APK to
**Firebase App Distribution** (invite testers by email) or a **Play Console
Internal testing** track (up to 100 testers, no public listing).

## Apple TV (tvOS) — TestFlight (no full App Store review)

tvOS sideloading via EAS internal distribution needs each Apple TV's UDID
registered (ad-hoc) — painful for external people. Use TestFlight instead:

### Gotcha: eas-cli creates an iOS provisioning profile for managed TV apps

eas-cli (≤20.1.0) resolves the Apple platform from the native Xcode project's
`SDKROOT`/`TARGETED_DEVICE_FAMILY`. With `ios/` gitignored (managed workflow)
there is no Xcode project to read, so it silently defaults to **iOS** and creates
an `IOS_APP_STORE` profile — the cloud build then fails with
`Provisioning profile … has platforms "visionOS, watchOS, and iOS", which does
not match the current platform "tvOS"`.

One-time fix (only needed when [re]creating credentials, e.g. cert rotation):

1. Temporarily comment out `ios/` in `apps/tv/.gitignore`
2. `EXPO_TV=1 npx expo prebuild --clean -p ios --no-install`
3. Run the interactive `eas build -p ios --profile production`; it now resolves
   tvOS, flags the stored profile as missing from the tvOS list, and offers to
   generate — say yes (reuse the org distribution certificate; never generate a
   new cert, the team is capped at 2)
4. After the build succeeds: restore `.gitignore`, `rm -rf ios/`

The corrected tvOS profile persists on EAS servers; subsequent builds work in
managed mode. Run them `--non-interactive` so eas-cli uses stored credentials
as-is instead of re-resolving the platform (which would flip back to iOS).

```bash
cd apps/tv
npx eas-cli build --platform ios --profile production   # store-signed tvOS build (.ipa)
```

Requires the Apple Developer Program ($99/yr) and a **tvOS** App Store Connect app
record for `org.jesusfilm.forgewatch` (Apple ID `6791428415`). Since PR #1590 the
TV and mobile apps share that single unified "Jesus Film Watch" record (iOS +
tvOS platforms in one listing); the pre-unification `org.jesusfilm.forgetv`
record (`6781137518`) was renamed "…Legacy" and is dormant. The record MUST have
the tvOS platform — if it's missing, add it in App Store Connect
(**Add Platform → tvOS**). Note `appleTVImages` requires no alpha channel and
exact sizes; the `withTVInfoPlistFixes` config plugin (`apps/tv/plugins/`) strips
the stray `LSRequiresIPhoneOS` key that config-tv leaves in (tvOS hygiene).

### Gotcha (CRITICAL): do NOT use `eas submit` for tvOS — it delivers as iOS

`eas submit --platform ios` uploads the tvOS `.ipa` **declaring the platform as
iOS**, so App Store Connect runs iOS validation against a tvOS binary and rejects
every delivery — the build never registers, you just get an email:

```
ITMS-90508  DTPlatformName 'appletvos' is invalid
ITMS-90545  provisioning profile is not compatible with iOS apps
ITMS-90713  CFBundleIconName missing            (iOS-only key)
ITMS-90039  CFBundleIcons.CFBundlePrimaryIcon type mismatch   (iOS dict form)
```

The binary is correct tvOS — only the delivery platform is wrong. **Submit with
Apple's `altool`, explicitly typed `appletvos`.** Put the ASC API key at
`~/.appstoreconnect/private_keys/AuthKey_<KeyID>.p8`, then:

```bash
# download the latest build's .ipa by CLI (no browser needed):
URL=$(npx eas-cli build:list --platform ios --profile production --limit 1 --json --non-interactive \
  | node -e "process.stdin.once('data',d=>process.stdout.write(JSON.parse(d)[0].artifacts.applicationArchiveUrl))")
curl -fL "$URL" -o /tmp/jfw.ipa
# <KeyID> and <IssuerID> are the ASC API key identifiers (NOT the app/team id),
# kept alongside the .p8 in ~/.appstoreconnect/private_keys/ (e.g. an info.txt). Then:
xcrun altool --validate-app -f /tmp/jfw.ipa -t appletvos \
  --apiKey <KeyID> --apiIssuer <IssuerID>   # dry run: SAME ITMS checks, no upload
xcrun altool --upload-app   -f /tmp/jfw.ipa -t appletvos \
  --apiKey <KeyID> --apiIssuer <IssuerID>   # the real upload
```

**Always `--validate-app` first** — it runs every ITMS check without spending a
delivery, so you confirm a clean "VERIFY SUCCEEDED" before uploading. The
Transporter Mac app also works (it auto-detects tvOS from the binary).
`eas submit` does not, and there is no flag to make it.

For the same reason, `apps/tv/eas.json` deliberately has **no `submit` section**:
an accidental `eas submit` fails fast with "Missing submit profile" instead of
burning doomed deliveries. Do NOT re-add it "for consistency" with mobile —
mobile's populated profile marks eas submit as its blessed path; TV's is altool.

- **Internal testing**: up to 100 testers who are members of your App Store
  Connect team. No Beta App Review; builds are ready in minutes.
- **External testing**: up to 10,000 testers via email or a public link. Requires
  a one-time light Beta App Review per build train (much faster than full review).

Testers install the **TestFlight** app on their Apple TV, sign in, and download.

## Recommendation

| Stakeholders | Android TV                         | Apple TV                                 |
| ------------ | ---------------------------------- | ---------------------------------------- |
| Inside JFP   | `--profile preview` APK link       | TestFlight internal (instant, no review) |
| External     | `--profile preview` APK / Firebase | TestFlight external (light beta review)  |

## App icons

Assets live in `apps/tv/assets/` — the JFP "sign" mark (`jesusfilm-sign.svg`,
`#EF3340`) centered on the Crimson Gallery field `#161311`. Wired in `app.json`
via `expo.icon` (base) and the config-tv plugin's `appleTVImages` (all 7 brand
assets) + `androidTVBanner` (the Android TV leanback tile).

Two hard requirements when regenerating:

- **Exact sizes, no alpha.** `@react-native-tvos/config-tv` requires ALL 7
  `appleTVImages` to exist (`icon` 1280×768, `iconSmall` 400×240, `iconSmall2x`
  800×480, `topShelf` 1920×720 + `2x` 3840×1440, `topShelfWide` 2320×720 + `2x`
  4640×1440) and Apple rejects icons with an alpha channel. `sips` can't strip
  alpha; generate with `sharp` (`.flatten().removeAlpha()`).
- **Do NOT set the config-tv `androidTVIcon`.** It writes `ic_launcher.png` into
  the same mipmaps where `expo.icon` writes `ic_launcher.webp`, so aapt2 fails the
  Android build with "Duplicate resources". `expo.icon` already supplies the
  launcher icon; the Android TV home tile uses `androidTVBanner`, not the icon.
