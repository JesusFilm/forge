# TV configuration and feature switches

For a teammate or AI agent building local Apple TV and Android TV test apps,
start with [Simulator testing setup](SIMULATOR-TESTING.md).

Use this guide to decide what to enable, where to change it, and how to check it.
Verified against the local integration branch on October 14, 2026. Source links
below are authoritative if this guide and a later implementation disagree.

Development instructions: [CLAUDE.md](CLAUDE.md). Repeatable checks and evidence:
[development harness](harnesses/development/HARNESS.md). Device distribution:
[DISTRIBUTION.md](DISTRIBUTION.md).

For simulator feedback QR, the local receiving server, and optional Linear key
setup, follow [Local feedback testing](../tv-feedback/LOCAL-FEEDBACK.md).

## Quick choices

| I want to…                                   | Change                                           | Where                                                          |
| -------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| Show the Apple TV Top Shelf style picker     | `EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED=true`  | Local `.env.local`; restart Metro and reload the app           |
| Hide that picker and use automatic Top Shelf | `EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED=false` | Local `.env.local`; restart Metro and reload the app           |
| Show the Animations menu                     | `ANIMATION_SETTINGS_ENABLED = true`              | [logoAnimations.ts](src/lib/logoAnimations.ts); reload the app |
| Hide the Animations menu                     | `ANIMATION_SETTINGS_ENABLED = false`             | Same file; direct animation routes also return to Settings     |
| Enable startup animation and its audio path  | `STARTUP_ANIMATION_ENABLED = true`               | Same file; terminate and relaunch the app                      |
| Disable startup animation and sound          | `STARTUP_ANIMATION_ENABLED = false`              | Same file; terminate and relaunch the app                      |
| Use the three-dot loading default            | `DEFAULT_LOADING_ANIMATION = "dots"`             | Same file; saved valid choices take precedence                 |
| Enable personalized recommendation delivery  | `EXPO_PUBLIC_TV_RECOMMENDATIONS_ENABLED=true`    | Local `.env.local`; requires TV's own fleet API key            |
| Use the legacy seeded recommendation rail    | `EXPO_PUBLIC_TV_RECOMMENDATIONS_ENABLED=false`   | Local `.env.local`; restart Metro and reload the app           |
| Show feedback entry points                   | Configure a real `EXPO_PUBLIC_TV_FEEDBACK_URL`   | Local `.env.local`; a URL, not a boolean                       |

Current checked-in code: animation menu **off**, startup intro **off**, loading
default **logo + three dots**. Local configuration when this guide was written:
Top Shelf picker **on**, recommendations **on** (enabled locally after the initial guide). Local values are not committed
and can differ between checkouts. This documentation does not change them.

## Environment boolean flags

Edit `apps/tv/.env.local` for local development. Use [.env.example](.env.example)
as a reference; do not overwrite an existing local file containing credentials.
Environment values are strings, and the parsers differ:

| Variable                                   | Values that enable it | Missing / other values  | Effect and source                                                                                                                                                                                                           |
| ------------------------------------------ | --------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED` | Exact `true` or `1`   | Disabled                | Apple TV only: Settings → Top Shelf — Beta and the saved style override. Does **not** disable automatic native Top Shelf. [Parser](src/lib/topShelf/preview.ts), [sync](src/lib/topShelf/sync.ts)                           |
| `EXPO_PUBLIC_TV_RECOMMENDATIONS_ENABLED`   | Exact `true` only     | Disabled, including `1` | Enables personalized delivery and recommendation Settings controls; also used by Top Shelf content selection and Google TV discovery preview. [Client](src/lib/recommendations/client.ts)                                   |
| `EXPO_PUBLIC_TV_PROFILE_ENABLED`           | None currently        | Profile stays hidden    | Legacy flag retained for compatibility. [profileFlagState.ts](src/lib/auth/profileFlagState.ts) always returns `false`, including in development. Re-enabling sign-in requires an intentional code change and verification. |

Use lowercase `true` / `false` consistently; `TRUE`, `yes`, and `on` are not
supported. Do not invent environment equivalents for the animation code switches.

### Top Shelf style choices

With the preview flag enabled on Apple TV, Settings → Top Shelf — Beta offers:

| Stored value | Menu label                     |
| ------------ | ------------------------------ |
| `automatic`  | Automatic — daily rotation     |
| `spotlight`  | Cinematic Spotlight            |
| `continue`   | Continue Watching              |
| `collection` | Discover the Collection        |
| `short`      | A Moment of Hope — short films |
| `journey`    | Choose Your Journey — topics   |

Choose a style, return to Apple TV Home, and highlight Watch in the top row.
A style without eligible content falls back to Automatic. The saved selection
survives hiding the picker, but its override is ignored while the flag is off.
The native extension must already be in the installed app; a JavaScript flag
cannot add it to an older binary. See [preview options](src/lib/topShelf/preview.ts).

### Native public-feed refresh — rebuild required

The native public-feed prototype is **off by default**. Without an endpoint,
Top Shelf continues using the app-owned snapshot and bundled fallback. The
Settings style picker flag above does not enable native fetching.

| Native build setting           | Effect                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TV_TOP_SHELF_FEED_URL`        | Optional public HTTPS feed URL, without credentials, query or fragment. Export it to the prebuild process, then rebuild and reinstall the Apple TV app/extension.                                |
| `TV_TOP_SHELF_FEED_LOCAL_QA=1` | Allows exact-loopback HTTP only in a Debug simulator build. The plugin removes the local endpoint and its ATS exception from Release; the native client also enforces the Debug simulator guard. |

These are native build inputs, not `EXPO_PUBLIC_*` variables or Metro settings.
Restarting Metro cannot change the installed extension's endpoint. An HTTPS
endpoint must implement the separate public-feed contract; pointing this at the
app's GraphQL URL is not sufficient. No production feed service is implemented
by this prototype, and Push is not included.

When tvOS invokes the extension, it can fetch public Spotlight, Collection, Short
and Journey content while Watch is closed. The system controls invocation;
there is no guaranteed polling interval or immediate refresh after an API edit.
For an enabled feed, endpoint/language/style determine public-content authority:
same-style app copy or item changes do not replace an accepted public feed or
its empty response. Continue Watching stays app-owned; the feed sends no viewing
history or progress. See the
[contract and cache rules](../../docs/solutions/integration-issues/tv-native-top-shelf-public-feed-20261020.md)
and the
[native validation record](../../docs/tv-system-home-validation-2026-10-02.md#october-20-native-public-feed-prototype)
for observed results and remaining limits.

### EAS profile values

These are the explicit values in [eas.json](eas.json), separate from local Metro:

| Profile       | Top Shelf picker | Recommendations | EAS environment |
| ------------- | ---------------- | --------------- | --------------- |
| `development` | `true`           | `true`          | `development`   |
| `preview`     | `true`           | `true`          | `preview`       |
| `beta`        | `true`           | `true`          | `preview`       |
| `production`  | `false`          | `true`          | `production`    |

All profiles set `EXPO_TV=1` and the Hermes override to `0.81.5`. Only
`development` opts into local networking. `preview` produces an Android APK;
`beta` produces an Android App Bundle for store testing. A local `expo start`
does not select an EAS build profile. Changing `.env.local` does not update an
already distributed app or its EAS environment. For a new EAS build, check both
the selected profile and its associated remote environment.

## Code switches and saved choices

The two booleans in [logoAnimations.ts](src/lib/logoAnimations.ts) are independent:

```ts
export const ANIMATION_SETTINGS_ENABLED = false
export const STARTUP_ANIMATION_ENABLED = false
```

Showing the menu does not enable the intro. Hiding the menu does not erase saved
animation choices. The startup session is process-local, so test with a full app
termination and launch, not only Fast Refresh. With startup disabled, its intro
component/audio does not mount and its restart-preview action is hidden.

`DEFAULT_STARTUP_ANIMATION` is `"09"` (Cinematic reveal), used when startup is
enabled. `DEFAULT_LOADING_ANIMATION` is `"dots"` (logo plus three red dots).
Both selectors also support the ten effects `"01"` through `"10"`; only Loading
supports `"dots"`. These are IDs, not booleans. Existing valid saved preferences
override defaults. To change an existing installation to dots, temporarily show
Animations, select **Loading → Logo + dots**, then hide the menu again if desired.
Do not clear all app data to change one preference.

Other user-facing controls are stored on each installation:

| Control                             | Initial behavior                                               | Where to change / source                                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personalized recommendations        | On unless previously withdrawn, when the build flag is enabled | Settings → Recommendations; [client.ts](src/lib/recommendations/client.ts). Turning the build flag off is not the same as withdrawing or resetting personalization.        |
| Showcase auto-start                 | Off (`autoStart: false`)                                       | Settings → Showcase Mode → Auto-start when the app opens; [prefs.ts](src/lib/showcaseMode/prefs.ts)                                                                        |
| Google TV Continue Watching sharing | Off until locally enabled                                      | Android Settings → Google TV Home → Content on Google TV Home; [googleTvHomeSync.ts](src/lib/googleTvHomeSync.ts). Turning it off requests removal of shared Home content. |
| Android “Use React Native player”   | Off; native Media3 is default                                  | Settings → Video player; `androidPlayerVariant: "native"` / `"existing"` in [watchPreferences.ts](src/lib/watchPreferences.ts)                                             |
| Apple TV player                     | Native A                                                       | Settings → Video player; `nativePlayerVariant: "native-a"`, `"native-b"`, or `"existing"` in [watchPreferences.ts](src/lib/watchPreferences.ts)                            |

Player choices, animation IDs and Top Shelf styles use `tv.watchPreferences.v1`.
Each simulator/device has its own preferences. Accessibility Reduce Motion is an
OS setting consumed by the app, not another `.env.local` feature flag.

## Configuration that acts like a switch

| Setting                                                                   | Behavior                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_TV_FEEDBACK_URL`                                             | Empty/unset hides feedback entry points. A nonempty value shows them; use a valid feedback service URL. The string `false` is nonempty and does **not** disable them. Rendering the menu does not prove device verification or QR generation works. |
| `EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER`                         | Public Android feedback verification configuration; not an on/off switch. Requires the native Play Integrity module and a compatible device/build. Apple verification uses its native path.                                                         |
| `EXPO_PUBLIC_DATADOG_CLIENT_TOKEN` + `EXPO_PUBLIC_DATADOG_APPLICATION_ID` | Both must be configured for RUM. Missing either makes it a no-op. Preserve configured telemetry; a client token is different from a build-time Datadog API key. See [datadog.ts](src/lib/datadog.ts).                                               |
| `DATADOG_API_KEY`                                                         | Build-time credential presence enables the existing Apple symbol-upload hook; keyless builds skip it. Android upload remains deferred. Never prefix this key with `EXPO_PUBLIC_`. See [build hook](scripts/eas-build-on-success.sh).                |

`EXPO_PUBLIC_GRAPHQL_URL` is the API endpoint. Recommendation requests require
`EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` set to TV's own fleet key. A successful public
catalogue/search request does not prove recommendation authentication works.
Keep credential values in ignored local configuration or the appropriate EAS
environment; do not copy them into this guide, commits, screenshots or logs.

## Native/build booleans — rebuild required

`TV_STARTUP_QA=1` selects the isolated Android package
`org.jesusfilm.tv.startupqa`. It also changes the **global** app name to
`Watch Startup QA` and URI scheme to `org.jesusfilm.startupqa`, including Apple
builds. The Apple bundle identifier stays unchanged. Leave this flag unset for
normal builds and Apple TV testing. See [app.config.js](app.config.js).

| Setting                                   | Current value / behavior                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_TV`                                 | `1` in TV commands/profiles; selects TV builds. It is not a menu toggle.                                                                                                                                                                                                                                                                                                      |
| `GOOGLE_TV_ENGAGE_TESTING`                | Exact `1` selects the verification manifest for Android **release** builds; unset uses the production manifest. Export it to the Gradle build process, not as an `EXPO_PUBLIC_*` variable. Debug omits the release production marker. See [build.gradle](modules/google-tv-home/android/build.gradle). Production discovery remains gated by onboarding/account requirements. |
| `expo.newArchEnabled`                     | `false` in [app.json](app.json); architecture setting, not a feature switch to toggle casually.                                                                                                                                                                                                                                                                               |
| Config TV plugin `isTV`                   | `true` in [app.json](app.json).                                                                                                                                                                                                                                                                                                                                               |
| Expo video `supportsBackgroundPlayback`   | `false` in [app.json](app.json).                                                                                                                                                                                                                                                                                                                                              |
| `EXPO_TV_ALLOW_LOCAL_NETWORKING`          | Exact `1` keeps the Apple local-network ATS exception during prebuild. Set on the EAS development profile only; unset/other values remove it. Local builds must export it explicitly when using Metro/local admin over HTTP. It is a build-time flag, not a Metro menu switch.                                                                                                |
| iOS `NSAllowsLocalNetworking`             | Seeded as `true` in [app.json](app.json), then removed by [withTVInfoPlistFixes.js](plugins/withTVInfoPlistFixes.js) unless the explicit development opt-in is set. Store profiles keep the exception off.                                                                                                                                                                    |
| iOS `ITSAppUsesNonExemptEncryption`       | `false` in [app.json](app.json); a distribution declaration, not an encryption enable/disable switch.                                                                                                                                                                                                                                                                         |
| `extra.router.origin`                     | `false` in [app.json](app.json); router configuration, not a visible feature.                                                                                                                                                                                                                                                                                                 |
| EAS `developmentClient` / `autoIncrement` | `developmentClient: true` on development; `autoIncrement: true` on production in [eas.json](eas.json). Build/distribution behavior only.                                                                                                                                                                                                                                      |

Internal booleans such as loading, focus, request-in-flight, subtitle state,
platform checks and `__DEV__` are runtime state or derived conditions. They are
not additional user configuration. Do not flip those to expose a menu.

For a local Apple TV development build that connects to Metro or a local admin,
export the local-network flag to the **prebuild process** before generating the
native project:

```bash
cd apps/tv
EXPO_TV=1 EXPO_TV_ALLOW_LOCAL_NETWORKING=1 REACT_NATIVE_OVERRIDE_NIGHTLY_BUILD_VERSION=0.81.5 pnpm exec expo prebuild --platform ios --no-install
```

Preserve existing generated native edits before regenerating. Follow the app
guide for Pods and the actual native build; starting Metro alone cannot change
an installed binary’s ATS settings. For store/native configuration verification,
leave this flag unset and inspect the generated app’s Info.plist to confirm the
local-network exception is absent. Do not enable arbitrary HTTP loads globally.

## Apply and verify a change

1. Confirm the checkout, branch and existing edits with `git status --short --branch`.
2. Edit only the intended setting. Keep credentials and existing saved preferences.
3. For `.env.local`, stop this checkout's Metro process and restart from the
   repository root:

   ```bash
   bash scripts/setup-sim-env.sh tv
   cd apps/tv
   EXPO_TV=1 REACT_NATIVE_OVERRIDE_NIGHTLY_BUILD_VERSION=0.81.5 pnpm exec expo start --dev-client --localhost --port 8081
   ```

   The setup script can seed missing local configuration. Verify the intended TV
   endpoint/key source without printing credentials; do not substitute another
   app's production fleet key. Reload the installed development client connected
   to this Metro. If a value still appears stale, restart Metro with `--clear`.

4. For code constants, reload JavaScript; fully terminate/relaunch for startup
   changes. For native/plugin/build changes, follow the app guide to regenerate
   and rebuild the intended target, preserving any generated local work first.
5. Verify the visible setting, remote focus, action and Back on the intended
   platform. Apple TV flags will not expose Apple menus on Android. Check existing
   saved choices if a changed default appears ineffective.
6. For a shipped build, use the documented build/distribution workflow. Restarting
   local Metro changes only development clients using it.

## Branch cleanup checklist

Integration snapshot: `feat/tv-discovery-local`, HEAD `6eb25dc94`. Personalized
recommendations, Google TV Home and the development harness were integrated locally.
Apple Top Shelf was already inherited through main. The draft PR preparation
combines these changes with the animation defaults, tests and this guide on
`feat/tv-discovery-draft`, based on main `0c22078df`, while retaining the original
integration branch locally. The raw chat transcript is excluded from the PR.

- [ ] Review `git diff` and untracked files. Keep the requested animation changes,
      regression tests, this guide and relevant plan/roadmap updates together in
      deliberate commits. Review the separate generated chat transcript before
      staging it; avoid `git add .`.
- [ ] Keep `.env.local`, `.local-tools`, generated native directories, build outputs
      and harness test results out of commits. Preserve local evidence before any
      optional disk cleanup; do not use a blanket `git clean -fdx`.
- [ ] Run TV typecheck, lint, Jest and changed-file formatting before a PR; run the
      harness checks if its implementation changes. Existing runtime evidence is
      linked in the [integration plan](../../docs/plans/2026-10-14-tv-discovery-local-integration.md)
      and [animation plan](../../docs/plans/2026-10-14-tv-animation-defaults.md).
- [ ] Complete Android runtime/focus/Back and performance checks on a selected
      device; the native build passing does not establish Google TV Home placement.
      Verify actual recommendation playback evidence acceptance and physical-device
      feedback verification before claiming those paths fully tested.
- [ ] Before a PR, fetch and compare with current main, inspect scope and resolve
      any conflicts. The earlier main comparison is a dated snapshot, not a claim
      that main has not changed since.
- [ ] After review, commit the remaining local work. Push/open/merge a PR or delete
      branches only as part of the intended follow-up; this guide performs none
      of those actions. Keep SSD branches until their work is accounted for.

## Maintaining this guide (human or AI)

Recheck parsers and consumers whenever adding or changing a feature switch. Search
from the repository root, excluding tests when building the configuration list:

```bash
rg -n 'process\.env|export const .* = (true|false)' apps/tv/src apps/tv/app --glob '!*.test.*'
rg -n 'System.getenv|process\.env' apps/tv/modules apps/tv/plugins apps/tv/scripts
```

Also inspect `.env.example`, `eas.json`, `app.json`, `SettingsScreen.tsx`, stored
preferences and native manifests. Record accepted values, missing-value behavior,
platform restrictions, saved-choice precedence and whether reload or rebuild is
needed. Keep code constants separate from environment flags. Never paste a full
local environment file into AI output to audit a few boolean flags.

### Development catalogue and feedback separation

`EXPO_PUBLIC_GRAPHQL_URL` selects the catalogue/playback backend independently of
`EXPO_PUBLIC_TV_FEEDBACK_URL`. A simulator can use the real production catalogue
while its development-only feedback URL remains a signed staging link. Use the
configured consumer fleet key for that catalogue; never use an admin credential.
Restart Metro and the apps after changing either setting.

Development recommendation identities are stored separately for each normalized
GraphQL endpoint. The former unscoped identity is deliberately not migrated, so
a synthetic fixture identity cannot be reused against a real service. Release
builds retain their existing identity key, and personalization choices remain
unchanged. Generating a new feedback QR only updates feedback settings.
