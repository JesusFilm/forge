# Build and test Watch TV on simulators

Audience: a teammate or an AI coding agent working in their own Forge checkout.
Updated: 27 October 2026.

## Intended result

| Area                         | Configuration                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------- |
| Catalogue and video playback | `https://admin.jesusfilm.org/api/graphql` — production                          |
| Simulator feedback           | Signed link to `https://web-staging-7801.up.railway.app/tv/simulator` — staging |
| Apple target                 | Apple TV **4K simulator**, Development/Debug build                              |
| Android target               | **Android TV emulator**, Development/Debug build                                |
| Feedback destination         | TV Beta Feedback in Linear, through the staging server                          |

Production catalogue access and simulator feedback are independent. Do not point
catalogue traffic at an old offline proxy such as `127.0.0.1:19061`; that fixture
blocks uncaptured playback/search operations. Do not use the deleted feedback
host `web-staging-920a.up.railway.app` for new tests.

This guide does not authorize store uploads, deployment changes, production
content edits, credential rotation, or extra Linear test tickets. Normal app
usage uses the configured production APIs. Keep the existing analytics and
recommendation behavior; never replay synthetic fixture evidence to production.

## 1. Inspect the checkout and tools

Read the root `AGENTS.md` and `CLAUDE.md`, [TV conventions](CLAUDE.md),
[feature switches](README.md), and the
[development harness](harnesses/development/HARNESS.md).

From the repository root:

```bash
git status --short --branch
git fetch origin
```

Use `main` after [PR #2854](https://github.com/JesusFilm/forge/pull/2854) is merged.
Before merge, use `codex/tv-feedback-simulator`. Inspect existing edits before
switching branches; do not reset or clean someone else's work. Do not assume the
feature is present just because a branch is named `main`.

Required tools:

- A supported Node installation; Node 24.x was used for the verified local run.
- Corepack and the repository-pinned **pnpm 9.12.3**. Do not substitute a globally
  installed newer pnpm when installing or running repository hooks.
- Apple TV: macOS, Xcode, its command-line tools, CocoaPods, and a tvOS simulator
  runtime. Xcode 27 presents simulators in **Device Hub**.
- Android TV: Android SDK/emulator, a TV AVD matching the Mac's CPU architecture,
  and JDK 17. Use an Android TV/Google TV image, not a phone AVD.

```bash
corepack pnpm --version
corepack pnpm install --frozen-lockfile
xcode-select -p                 # Apple host only
xcrun simctl list devices available
adb devices                    # Android host only
```

If Corepack or a native tool is missing, report that prerequisite and install it
through the developer's approved setup. Do not use another person's absolute
`/Users/...` tool paths or simulator IDs. Record the selected devices and ensure
adequate free disk space before native builds.

## 2. Prepare local configuration

Run the repository setup helper **before starting Metro**:

```bash
bash scripts/setup-sim-env.sh tv
```

This seeds a worktree from its main checkout when possible. A teammate's clean
clone may have no local credentials, so a missing/blank-token warning is expected
until they obtain the approved TV consumer key. The helper's success does not
prove the endpoint or credential belongs to the intended environment: it can
also inherit an old URL or another app's token. Verify the source privately and
use **TV's own production fleet key**, never a mobile fleet key, admin key,
Linear key, or Apple signing key.

Edit `apps/tv/.env.local`, preserving unrelated valid settings:

```ini
EXPO_PUBLIC_GRAPHQL_URL=https://admin.jesusfilm.org/api/graphql
EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN="<approved TV production consumer fleet key>"
EXPO_PUBLIC_TV_RECOMMENDATIONS_ENABLED=true

EXPO_PUBLIC_TV_FEEDBACK_SIMULATOR_ENABLED=true
EXPO_PUBLIC_TV_FEEDBACK_URL="<complete signed simulator feedback URL>"

# Optional Apple TV beta style menu:
EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED=true
```

Replace both placeholders before testing. Ask the owner for the credential's
approved configuration location and for a fresh signed link; never request a
secret pasted into chat. The fleet key is needed for personalized recommendations;
basic public catalogue reads and search can have different access requirements.
Do not report recommendation readiness based only on successful playback.

**Keep the signed URL quoted.** It contains `#token=...`; an unquoted `#` is a
dotenv comment and silently discards the token. Do not use the staging base URL
alone. Check for conflicting values in `.env.development.local` or other local
environment files, without printing their credentials or bearer links.

```bash
git check-ignore --quiet apps/tv/.env.local
chmod 600 apps/tv/.env.local
```

Keep private configuration out of Git. Do not disable native simulator checks or
change Release behavior to expose the feedback menu. Development recommendation
identities are separated by GraphQL endpoint; the old unscoped fixture identity
is not migrated. Personalization choices and existing app data are preserved.

## 3. Obtain or refresh the signed feedback URL

The staging server trusts one configured Ed25519 public key. A teammate does not
need the private signing key or a Linear API key. Request a link from the current
authorized issuer. On the issuer's Mac, where the matching key already exists in
Keychain, run from the repository root:

```bash
node apps/tv-feedback/scripts/simulator-token.mjs issue \
  --output "$HOME/Downloads/watch-tv-feedback-link.txt" \
  --ttl 7200
```

Share the generated link privately and place the complete value in the quoted
TV environment setting above. The CLI prints metadata, not the bearer URL.
It uses Node 20+ and writes the link file with restricted permissions.

A link lasts at most **two hours**. A phone session lasts at most 30 minutes and
never past token expiry. Generate a fresh link, update the local TV environment,
and fully restart Metro and the app when it expires.

Do not run `init` on a teammate's Mac and replace the shared server public key as
an onboarding shortcut; that would invalidate other developers' sessions. If
independent issuers are needed, coordinate that server configuration separately.
See [the issuer and server guide](../tv-feedback/LOCAL-FEEDBACK.md).

## 4. Build the native development clients

Use the following exports in each build/Metro terminal. Local Expo commands do
not automatically inherit the environment declared in EAS build profiles.

```bash
export EXPO_TV=1
export EXPO_TV_ALLOW_LOCAL_NETWORKING=1
export REACT_NATIVE_OVERRIDE_NIGHTLY_BUILD_VERSION=0.81.5
```

The local-network flag allows the Apple development client to reach local Metro.
Do not enable arbitrary HTTP loads globally or carry a simulator override into
store release configuration. TV requires a native development client; Expo Go is
not the target.

For a fresh checkout, generate the native project for the platform being tested:

```bash
cd apps/tv
corepack pnpm exec expo prebuild --platform ios
# Or, for Android:
corepack pnpm exec expo prebuild --platform android
```

Before regenerating an existing native project, inspect and preserve any local
native edits. Do not run `prebuild --clean` over unreviewed work. For Apple,
resolve Pods through the normal Expo/CocoaPods setup if prebuild reports a
missing dependency.

Run from the repository root, with the exports above still set:

```bash
# Apple TV: choose an available Apple TV 4K simulator.
corepack pnpm --filter @forge/tv ios --device

# Android: start the selected TV AVD, then choose that emulator.
corepack pnpm --filter @forge/tv android --device
```

These commands build development apps and normally start Metro. Keep that Metro
terminal running. Do not run the root `pnpm ios`/`pnpm android` commands: those
target the mobile app. `pnpm --filter @forge/tv build` is only a placeholder and
is not proof that a native binary was built.

Reuse one Metro session for both devices. For later launches, or if Metro must
be started separately, use this from `apps/tv`:

```bash
corepack pnpm exec expo start --dev-client --localhost --port 8081 --clear
```

For an Android emulator using localhost, map that exact Metro port:

```bash
adb -s <selected-emulator-serial> reverse tcp:8081 tcp:8081
```

Connect both installed development clients to that Metro URL. Use the same port
throughout; if another process owns 8081, choose an unused port and update the
connection and reverse mapping. Do not kill unrelated Metro sessions. Stop the
old app/Metro processes **before** editing environment files, then relaunch;
Fast Refresh alone is not sufficient for an environment change.

Xcode 27: open **Xcode → Open Developer Tool → Device Hub**, then select the
chosen Apple TV. Earlier Xcode versions may show **Simulator** instead. If a
booted device appears invisible, inspect the selected device and window/display
placement before erasing or recreating it.

### Native-command fallback

If the Expo command builds successfully but cannot open the simulator UI (for
example, it still looks for `Simulator.app` on an Xcode 27 installation), use the
native tools rather than reinstalling Xcode or clearing device data. Start the
Metro session described above first. Substitute your selected IDs, not the
owner's QA device IDs.

Apple TV, from the repository root after prebuild/Pods:

```bash
TV_SIMULATOR_UDID="<selected Apple TV 4K simulator UDID>"
TV_DERIVED_DATA="$HOME/Library/Developer/Xcode/DerivedData/WatchTV-QA"
# Boot the selected simulator first if it is currently shut down.
xcodebuild \
  -workspace apps/tv/ios/JesusFilmWatch.xcworkspace \
  -scheme JesusFilmWatch -configuration Debug -sdk appletvsimulator \
  -destination "platform=tvOS Simulator,id=$TV_SIMULATOR_UDID" \
  -derivedDataPath "$TV_DERIVED_DATA" CODE_SIGN_IDENTITY=- build
xcrun simctl install "$TV_SIMULATOR_UDID" \
  "$TV_DERIVED_DATA/Build/Products/Debug-appletvsimulator/JesusFilmWatch.app"
xcrun simctl openurl "$TV_SIMULATOR_UDID" \
  'org.jesusfilm.forgetv://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'
```

Open the selected device in Device Hub through Xcode's developer-tool menu. On
the verified Xcode 27 installation the application is at
`$(xcode-select -p)/../Applications/DeviceHub.app`; discover its location on other
installations instead of assuming it exists.

Android TV, from the repository root after prebuild:

```bash
TV_EMULATOR_SERIAL="<selected Android TV emulator serial>"
(cd apps/tv/android && ./gradlew :app:assembleDebug)
adb -s "$TV_EMULATOR_SERIAL" install -r \
  apps/tv/android/app/build/outputs/apk/debug/app-debug.apk
adb -s "$TV_EMULATOR_SERIAL" reverse tcp:8081 tcp:8081
adb -s "$TV_EMULATOR_SERIAL" shell am start -W \
  -a android.intent.action.VIEW \
  -d 'org.jesusfilm.forgetv://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'
```

The URL's encoded port must match Metro. Wait for Home to render before opening
another deep link; sending one while the development client is still loading
can return to the launcher instead of the intended screen.

## 5. Acceptance checks and evidence

Record the commit, target device/OS, build result, and API origins without keys.
Do not substitute mocks for these final checks:

1. Home loads real catalogue data on both devices. The offline proxy is not the
   configured endpoint. Remote focus, Select, and Back/Menu work.
2. Open a real title, press Play, and verify advancing video rather than a poster
   or spinner. Check pause/resume and return navigation. Record a short clip or
   timed screenshots; report audio separately if it was not checked.
3. Open **Feedback** from each TV app. Decode or scan the actual displayed QR.
   It must use `web-staging-7801.up.railway.app/tv/simulator` with a signed token.
4. On a phone, select **Start simulator feedback**. Check photo selection,
   annotation and review. A screenshot of the review page is not a delivery
   receipt. Do not press **Send feedback** unless a real Linear test ticket has
   been explicitly authorized; successful submission creates a real issue.
5. Verify an expired/invalid link is rejected, and a fresh link works after the
   environment/Metro restart. A phone can use a different network from the Mac.
6. Keep evidence locally, excluding bearer URLs, secrets and QR pixels from
   public reports. Do not clear app storage, reset Keychain, uninstall apps or
   wipe emulator data merely to recover a failed test.

For source changes, use the harness and checks appropriate to the change:

```bash
corepack pnpm --filter @forge/tv typecheck
corepack pnpm --filter @forge/tv lint
corepack pnpm --filter @forge/tv test -- --runInBand
```

Native module/plugin changes require a native rebuild. JavaScript-only or
configuration changes usually need a Metro restart/reload, provided the installed
binary contains the required native modules.

## Troubleshooting

| Symptom                                         | Check                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No Feedback menu                                | Nonempty quoted feedback URL, exact simulator flag `true`, Debug/development TV build, and native simulator/emulator confirmation.                                              |
| Simulator feedback unavailable                  | Token was truncated by an unquoted `#`, wrong hostname, stale bundle, or wrong native build.                                                                                    |
| Phone says invalid/expired link                 | Obtain a fresh link from the trusted issuer; update `.env.local` and restart Metro/app.                                                                                         |
| Home works but video is unavailable             | Confirm the app is using production GraphQL, not the offline proxy. Then inspect the real video/dub response and media error; do not assume every failure is configuration.     |
| Development launcher appears instead of the app | Confirm Metro is ready, the device is connected to the correct port, and Android reverse mapping exists. Reconnect once and inspect current errors rather than looping blindly. |
| Windows are missing                             | Check Device Hub versus Simulator, the selected device, minimized windows and other displays.                                                                                   |
| Signature mismatch during installation          | Preserve data and stop to resolve the intended package/signing identity; do not automatically uninstall.                                                                        |

## Verified baseline and limits

On 27 October 2026, JESUS playback was observed on both QA platforms using the
production catalogue. Both simulator feedback links opened authorized staging
sessions. This does not establish every movie, language, account feature,
physical-device integrity flow, or new Linear delivery.

The owner-specific Desktop launcher and `/Users/up/...` paths are ignored local
helpers, not a portable part of this repository. A teammate's AI should follow
this guide using that teammate's own tool paths and device IDs. Existing
TestFlight/Play artifacts are separate; merging this PR does not rebuild or
reconfigure an already-installed beta.
