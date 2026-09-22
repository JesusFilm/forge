# apps/mobile — Expo Watch App

## Stack

- React Native with Expo (SDK 57, managed workflow)
- Expo Router for file-based navigation
- @forge/admin-graphql with gql.tada for typed GraphQL operations
- Apollo Client (InMemoryCache, no persistence)
- expo-video for HLS playback
- expo-image for optimized image loading
- @shopify/flash-list for virtualized section feed

## Architecture

This is a Server-Driven UI (SDUI) app. Admin controls the content
blocks and their order via the Experience content type. The app renders them.

**Home tab — Experience-driven body, client-owned hero.** The Home body renders
from the prod `watch-home` homepage Experience (`watchSetting.homepageExperience`,
locale `en` — the same Experience web renders), adapted into the existing
`WatchHomeModel`/`HomeShelf` shape by `src/lib/watchHome/experienceAdapter.ts`
(lean cards from flat `MediaCollectionBlock` items; NOT the SDUI
`/experience/[slug]` renderers). Under-curated items (null authored
title/image overrides — e.g. the prod "Acts of the Apostles" shelf) additively
hydrate title/image from the linked video by `coreId`: `itemToCard` falls back to
`video.locales[0].title` + `pickAdminImage(video.images)` (then a mux thumbnail),
authored overrides always winning. The hero pager stays client-owned and is never
Experience-driven (feat-172). Config split by lifecycle in `src/lib/watchHome/`:
`heroConfig.ts` is LIVE — **mirror any web hero-curation change here** (hero
sources, playlist sequence, mux inserts) until feat-160 moves curation into
admin; `fallbackConfig.ts` is a FROZEN emergency body fallback (null / fetch
error / zero renderable shelves) — do NOT mirror web there. `useWatchHome`
fetches the Experience and the lean `watchHomeVideos` payload in parallel
(**never select `dubs` in the bulk fragment; jest guards enforce it on both the
videos fetch and the `watchSetting` path**), then top-up-fetches the divergent
Experience coreIds the config pool doesn't cover (`topUpFetch.ts`, chunked, 3s
deadline, last-good reuse on failure) and assembles the model via
`assembleWatchHomeModel` — the config model (client-owned hero) is built from the
config videos ONLY (so a top-up short film can't leak into the hero, feat-172)
while Experience cards hydrate off the merged index. Body-from-Experience-else-
config resolves via `resolveWatchHomeModel`, a PURE resolver that logs nothing;
the signal lives in `useWatchHome`'s reconcile ladder, which routes every config
fallback AND every dropped top-up through `logWatchHomeFallback`
(`src/lib/watchHome/logWatchHomeFallback.ts`) as
`datadogLog.warn("watch_home_fallback", { reason, body_source })` — never silent,
incl. `topup-error`. Both stay context attributes, never interpolated into the
message, or Datadog loses the facet. A failed required-videos fetch is a
different signal (`watch_home.videos_failed`), and the empty-videos-over-snapshot
guard and the outer catch only set the retry error; the v3
snapshot persists config + `hydrationVideos` separately for instant cold launch. `buildWatchHomeModelFromVideos` → `HomeScreen`
(three-layer hero pager / shelves / overlay); hero streams resolve lazily per
slide via `useHeroStream`. Experiences still render via the SDUI pipeline below,
hosted at `/experience/[slug]`.

### SDUI Pipeline

```
Admin GraphQL → gql.tada typed query → dispatcher → renderers
```

- **Query**: Defined in `src/lib/queries.ts` using `adminGraphql()` from `@forge/admin-graphql`
- **Fragments**: while the Watch category-rail rollout can still roll Admin back to a pre-rail schema, import `adminLegacyWatchExperienceFragment` from `@forge/admin-graphql/fragments` and spread `...AdminLegacyWatchExperience`. Mobile does not render the Web-only rail, so naming its new GraphQL type would only make released native bundles incompatible with an old or rolled-back Admin. Return to the canonical fragment only after the compatibility window closes.
- **Dispatcher**: `src/components/sections/SectionDispatcher.tsx` — switch on `__typename`
- **Renderers**: `src/components/sections/*Renderer.tsx` — one per block type

### Key Patterns

- **No normalizer layer**: Renderers receive admin fragment types directly via the `AdminBlock` union type. The dispatcher switches on `__typename` (e.g., `"VideoHeroBlock"`, `"TextBlock"`).
- **Flat-video posture**: Admin blocks carry `videoId` and `streamingUrl` but no nested video object. Renderers use block-level `imageUrl`/`titleOverride` for display. VideoHero derives poster from Mux thumbnail URL.
- **Flat container model**: Admin's `ContainerBlock` uses flat `content[]` with `ContainerSlotBlock` markers instead of nested `slots[].slotContent`. `groupBySlotMarker()` reconstructs slot groups.
- **ExperienceProvider at root layout**: Wraps the root Stack so both tabs and video detail route have access.
- **Three-layer hero**: the hero (zIndex 0) is absolutely-positioned behind FlashList, with an interactive overlay (zIndex 2, `pointerEvents="box-none"`) above the scroll view for anything tappable. SDUI/CuratedHomeLayout path: visual elements render in the hero layer and invisible overlay Pressables are positioned over them via `measureLayout`. HomeScreen path: visible chrome Pressables (Watch Now / insert CTA / mute) render directly in the overlay and fade with scroll, while hero swipes are claimed by a capture-phase PanResponder on the screen root and forwarded to the pager.
- **One-decoder discipline**: only the active hero/player mounts a video decoder — episode cards and background surfaces render posters, never VideoViews. (There is no global "VideoDecoderBudget" context; that was never built.)
- **Hero transition hold**: leaving a PLAYING hero slide sets `transitionFromId` (pagerReducer) — the departing page keeps hosting the live video through the scroll animation; pause + replaceAsync swap defer until the settle (SLIDE_SHOWN), with SUSPEND/SLIDES_SET/MAX_DWELL as release valves. `heroPageVideoState()` is the tested render-time host selector; during a hold, outgoing-stream `playToEnd`/`PLAY_STARTED`/errors are guarded so they can't advance past or reveal the incoming slide.
- **Hero stream failure cooldown**: failed `GET_VIDEO_BY_SLUG` resolutions open a per-slug module-scope backoff window (`heroStreamCooldown.ts`, 60s doubling to 10min) that suppresses hook + prefetch retries; any query success for the slug — or a successful pull-to-refresh (`clearAllHeroStreamCooldowns`) — releases it.
- **One expo-video lifecycle adapter**: player creation goes through `useManagedVideoPlayer` (frozen source, replaceAsync swap, AppState pause/resume) — a jest guard forbids BOTH `useVideoPlayer(` and `createVideoPlayer(` outside it, plus a three-entry allowlist (`HomeHeroPager`'s bespoke swap engine, `VideoHeroRenderer`, and the shared test double `src/test-utils/expoVideoMock.ts`). `createVideoPlayer` is named separately because its player does NOT release with the component — the "outlives the route" hole.
- **expo-image everywhere**: Never use RN `<Image>`. Always `expo-image` with `recyclingKey`.

## Conventions

- Follow Expo Router file-based routing conventions.
- Use `@forge/admin-graphql` for all GraphQL operations — never define queries in `@forge/admin-graphql` package itself.
- System font (`fontFamily: 'System'`) for platform-native typography (SF Pro iOS, Roboto Android).
- `hexToRgba(color, 0)` for gradient stops — never `"transparent"`.
- Validate all CMS-sourced URLs via `validateUrl.ts` before use.
- Card/poster art comes from `pickCardImage` in `src/lib/cardImage.ts` (SYNC with `apps/tv`) — never hand-roll a field chain. A record's bare `images[].url` is the variant-less Cloudflare delivery base and 400s, so it ranks LAST; the scan is field-major so a `videoStill`-first entry falls through to a sibling's cinematic art. Any query selecting `images` must select `videoStill` too.
- Composite React keys: `key={\`${item.__typename}-${index}\`}` or content-derived keys.
- Admin's `name: JSON` fields are locale maps — use `pickLocalizedName()` from `src/lib/pickLocalizedName.ts`.
- **Bible verse text comes from admin's resolved `BibleCitation.passage`, never from a public Bible mirror.** The old jsDelivr fetch dropped verse ranges, inlined footnotes, truncated poetry to its first line, and credited nobody. The read is a COMPANION query (`GET_VIDEO_BIBLE_PASSAGES` in `src/lib/queries.ts`), never a selection on `watchVideoFragment` — five call sites execute that fragment and only the watch screen renders a Bible card. `documentId: id` on `videoBySlug` **itself** is load-bearing: without it the companion write cannot normalize the video, so it replaces the shared reference and a SUCCESSFUL passage read silently collapses the player-gating query. `src/lib/__tests__/queries.test.ts` guards both halves, and `biblePassages.test.ts` pins the cache mechanism against a real `InMemoryCache`. A passage reaches a card only through the fail-closed gate in `src/lib/biblePassages.ts` — all eight values, the seven strings on truthiness (admin passes provider columns through raw, so a present-but-blank field is a real shape) and `versionId` as a positive integer. **Scripture never renders uncredited:** when the card cannot fit a verse with its translation and copyright, `src/lib/bibleCardFit.ts` drops the VERSE, not the credit. `apps/tv` still holds its own copy of the retired mirror stack and does NOT inherit this.

## Admin endpoint resolution (feat-339)

**A development bundle defaults to local admin** —
`http://localhost:3003/api/graphql`, rewritten to `10.0.2.2` on the Android
emulator. No env file required: a fresh clone or a fresh worktree is already
pointed at local admin. Release bundles are unchanged and default to production.
All of this lives in `src/lib/adminEndpoint.ts`, a dependency-free leaf that
`src/env.ts` and `src/lib/config.ts` both consume.

- **A development bundle resolving to `admin.jesusfilm.org` refuses to start.**
  A local session writes `RecordWatchSearchEvent` rows plus admin-side search
  traces into the production database, and opening Discover fires six searches
  before anyone types. The throw happens at `src/env.ts` module scope, and the
  message names the resolved host and the override.
  **Which surface shows it is not guaranteed — do not build on either.**
  `app/_layout.tsx`'s `require`-in-`try/catch` catches the throw only when its
  guarded require is the first evaluation path into `env.ts`. That is a property
  of the current import graph, not of the guard, and ordinary feature work
  changes it. Both surfaces have been observed on this app:
  the RN dev error overlay (2026-08-07, stack
  `env.ts -> config.ts -> apolloClient.ts -> useWatchHome.ts` — a screen's static
  import chain reaching `env.ts` outside the guard), and the Startup Error panel
  (2026-08-11, after an unrelated PR changed `_layout.tsx`'s require block).
  Either way the message is verbatim and selectable, which is why R2 needs no new
  UI. This only matters in development: the refusal is `__DEV__`-gated, so a
  release bundle never reaches it. Full mechanism:
  `docs/solutions/best-practices/expo-router-require-guard-containment-is-order-dependent.md`.
- **`EXPO_PUBLIC_ALLOW_PRODUCTION_ADMIN=1` opts back in**, deliberately and
  visibly — the startup line then names production on every launch.
- **Only the known production host refuses.** A LAN address, a tunnel, or an
  emulator alias boots normally, so physical-device work is unaffected.
- **Every development launch prints its endpoint**:
  `[admin-endpoint] admin_endpoint.url=… admin_endpoint.kind=…`.
- **An endpoint that refuses connections raises a dev-only banner** over Home
  (`src/components/DevEndpointNotice.tsx`) instead of letting the frozen
  `fallbackConfig` masquerade as loaded content.

**Per-machine overrides go in `apps/mobile/.env.development.local`** — never
`.env.local`. `fetch-secrets` replaces `.env.local` wholesale, so a hand-added
line there is lost on the next run; and `.env.development.local` is never loaded
in production mode, so it cannot be inlined into a published bundle.

Local admin needs `pnpm --filter @forge/admin dev` on port 3003 against a
pgvector-capable Postgres. Getting production-shaped content into it is tracked
under `feat-328`; until then Home falls through to its frozen fallback.

## App icon

Every icon asset is generated from one vector source by
`scripts/generate-app-icon.mjs` (`pnpm icons:generate`). **Never hand-edit the
PNGs or `assets/AppIcon.icon/` — regenerate.** The script borrows `apps/admin`'s
`sharp` on purpose; adding it here would ship a native binary into every EAS build.

- **iOS** uses a real Icon Composer bundle (`ios.icon: "./assets/AppIcon.icon"`),
  supported by Expo's `withIosIcons` (SDK 54+). Layers stay FLAT — iOS 26 applies the
  specular highlight and drop shadow itself, so baking them in double-applies them.
- `icon.json` is hand-authored against a schema recovered from Xcode 26's
  `IconComposerFoundation` (verified 2026-08-07, Xcode 26.5). Two rules it
  enforces that are easy to trip over: colours are strings `"srgb:r,g,b,a"`
  with **alpha required**, and a `linear-gradient` takes a bare array of
  **exactly two** colours.
- Validate any `icon.json` change before pushing with this command **exactly** —
  the flags are load-bearing:

  ```bash
  xcrun actool --compile /tmp/iconcheck --platform iphoneos \
    --minimum-deployment-target 26.0 --app-icon AppIcon \
    --output-partial-info-plist /tmp/iconcheck/p.plist assets/AppIcon.icon
  ```

  `mkdir -p /tmp/iconcheck` first. **Without `--platform` and
  `--minimum-deployment-target`, actool exits 0 and compiles nothing** — it
  prints only a notices plist, so an abbreviated invocation silently passes on a
  broken bundle. With them, exit code is trustworthy: 0 plus an `Assets.car` on
  success, 1 plus a `com.apple.actool.errors` key on failure.

- **Android** gets separate foreground / background / monochrome layers. The symbol
  is drawn at `0.6 × 72/108` of the canvas, not `0.6` — Android's 108dp canvas only
  shows its middle 72dp, so matching iOS's apparent size needs the smaller number.
- The symbol is centred on its **centroid** (53.9% / 41.6% of its box), not its
  bounding box; the sliced corner removes weight and a box-centred symbol sags.
  Every run re-derives those constants from the path and aborts before writing
  anything if they have drifted, so a stale `CX`/`CY` cannot reach an asset.
  `--verify-centroid` runs the same check on its own and prints the measurement.
- The JFP symbol on near-black is **not** one of the four symbol-on-background
  combinations `brandpad.io/jfp` permits. It matches the existing tvOS tile, which
  has the same issue. Pending a waiver from the brand owner.

## Cold-start splash

**The animated splash is OFF** (`ANIMATED_SPLASH_ENABLED = false` in
`src/lib/splash/animatedSplashEnabled.ts`, since 2026-09-15 — the product lead
did not approve the animation). The code stays in the tree, disabled, not
removed: `SplashHost`, `SplashCoveredTree`, `SplashSequence`, the splash
session, the embedded Noto Serif face, and the projector rasters. Do not delete
any of it. The `expo-font` plugin entry and its TTF are fingerprint inputs, so
removing them moves the runtime version. `SplashSequence` imports the two
projector rasters statically, so deleting one fails the bundler with `Unable to
resolve module` and nothing ships. A warm dev server is NOT the check: it can
keep serving a cached bundle after the file is gone. Verified by hand
2026-09-15 — `npx expo export --platform ios` exits 0 with the raster and exits
1 without it, naming `SplashSequence.tsx`, while a live Metro served a
byte-identical cached bundle either way.

What a cold launch does with the flag off: the native splash shows
`assets/splash-icon.png` — the JFP symbol on the `#1c1917` ground — until the
React tree's first commit, then Home. `app/_layout.tsx` still takes the native
hold at module scope (KTD2) and `SplashHost` still lowers it, on the same
never-plays path a deep-link launch takes. `getSplashSession().start()` settles
that snapshot synchronously, so nothing waits on the deep-link gate. The flag is
a required `createSplashSession` dep. `splashSession.test.ts` pins the
singleton's behaviour against the constant, and
`src/lib/splash/__tests__/splashKillSwitch.guard.test.js` pins the four halves
no behavioural suite ties together: the call site passes the constant and not a
literal, the flag file declares it exactly once as a bare literal, the
generator reads that file with the same pattern, and the committed PNG matches
the flag by md5.

**The native asset follows the flag, and the generator enforces it.**
`pnpm icons:generate` reads the flag file by regex (one line, bare literal;
the generator refuses a second declaration, even a commented one) and emits
the symbol when off, the flat field when on. A flip without a regeneration, or
a hand-edited PNG, fails the guard.

**The symbol reaches a binary only through prebuild.** Every binary built from
the flat asset — dev clients from 2026-09-10 to 2026-09-15 and TestFlight
1.0.0 (7) — runs this JS as a flat field, then Home, with no logo anywhere.
Android is the same restore as before #2216: `enableFullScreenImage_legacy` is
iOS-only, and Android draws the symbol as the small icon in its system-splash
slot.

To see the new native splash on a local simulator:

1. `npx expo prebuild --platform ios --no-install`. `expo run:ios` skips
   prebuild when `ios/` exists, so without this step the build ships the old
   imageset. Prebuild rewrites `ios/Podfile`; before `pod install`, re-add the
   `post_install` hook that puts `__STDC_WANT_LIB_EXT1__=1` on the `MMKVCore`
   and `MMKV` targets, or the build fails on `memset_s` under Xcode 26 (see
   `docs/solutions/integration-issues/expo-dev-launcher-root-vc-blocks-fullscreen-rotate.md`).
2. Confirm `ios/forgewatch/Images.xcassets/SplashScreenLegacy.imageset/image.png`
   changed (it is RGBA and about 12 KB with the symbol; the flat field was
   5,861 B).
3. `npx expo run:ios --device <udid>`.

To re-enable, all three steps, in one PR:

1. Set `ANIMATED_SPLASH_ENABLED = true`.
2. Run `pnpm icons:generate` — the native splash must be flat again, or the
   handover shows a symbol-to-blank flip.
3. Ship a NATIVE build before the next `eas update`. The asset moves the
   fingerprint runtime version. A whole-branch OTA targets a runtime no
   installed build carries and reaches nobody; a flag-only OTA on the old
   runtime cuts from the flat field straight to Home.

The reverse (this change) needs the same native build for the same reason. The
design record is `docs/plans/2026-09-09-1059-feat-mobile-animated-splash-plan.md`.

**Until that native build ships, the production channel is dark.** Every
`update:production` from `main` targets a runtime version no installed build
carries. `eas update` still exits 0 and reports success, so an unrelated JS
hotfix published in this window reaches nobody and nothing says so. Installed
testers keep the animation until they install the new build. The only OTA that
could reach them is the flag off with the OLD flat asset, and
`splashKillSwitch.guard.test.js` rejects that pairing by md5 on any committed
tree, by design. **Open decision, owner: the release caller.** The default
posture is to wait for the build. Taking the animation off installed devices
sooner needs a deliberate throwaway-branch OTA and an explicit call; do not
improvise it from `main`.

**With the splash ON it plays over a reminder launch, and the budget is not
why:** `isExternalLaunch` reads a flag only `registerDeepLinkUrl` sets, and a
reminder tap calls `registerDeepLinkSlug`. Teach that read about
reminder-origin arrivals; a wider `SPLASH_SKIP_DECISION_BUDGET_MS` changes
nothing (`docs/plans/2026-09-16-1101-feat-mobile-lapse-reminders-plan.md`).

## Running on a simulator (env setup)

**Before launching apps/mobile on a simulator, ALWAYS run
`bash scripts/setup-sim-env.sh mobile` first.** Fresh git worktrees don't
inherit `.env.local` (gitignored), so `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` (the
`WatchSearch`-scoped consumer bearer) is absent and search silently falls back
to the shared anonymous rate-limit bucket until it's seeded.

The script is idempotent: it seeds `apps/mobile/.env.local` from the main
checkout with the search token. It deliberately does NOT copy
`EXPO_PUBLIC_ADMIN_GRAPHQL_URL` — the code default covers it, and propagating
whatever the main checkout carried is how a worktree ends up on production admin
without anyone deciding to. It's a shortcut — the canonical way to populate the
full env (and the fallback on a fresh solo clone with no other checkout) is
`pnpm --filter @forge/mobile fetch-secrets` (Doppler `forge-mobile`). Run either
BEFORE `expo start` — Expo inlines `EXPO_PUBLIC_*` at bundler startup, so a
change made after boot needs a Metro restart to take effect.

## Publishing an EAS Update

Use the scripts. Both name their EAS environment and disable dotenv, so a
developer's local env files cannot reach a published bundle:

```bash
pnpm --filter @forge/mobile update:preview     # preview channel
pnpm --filter @forge/mobile update:production  # production channel — every beta tester
```

Each element is load-bearing:

- `--environment <name>` pulls the EAS Environment values AND makes `eas-cli`
  inject `EXPO_NO_DOTENV=1` into the export subprocess. Without it, `expo export`
  runs in production mode and reads `.env.local`.
- `EXPO_NO_DOTENV=1` is set explicitly too, so the guarantee does not rest on a
  CLI internal that `eas.json` floors only at `>= 16.0.0`.
- `--message` stops a fire-and-forget script prompting on stdin.
- `touch src/env.ts` is belt-and-braces against the stale-Metro-cache white
  screen recorded in
  `docs/solutions/runtime-errors/metro-env-inlining-eas-update-white-screen-20260410.md`.

The old preview script copied `.env.production` over `.env.local` and restored
it on exit. That file is dead Strapi-era configuration with no admin endpoint,
no search bearer, and no Datadog variables, so the swap that prevented the leak
also stripped published previews of telemetry. Delete your local copy; nothing
reads it. The Strapi token inside it is a separate rotation task — deleting a
local file does not revoke it.

Rollback is `eas update:rollback --channel <preview|production>`. Exercise it
once on preview before you ever need it on production.

**Any `eas.json` change moves the runtime version, and the next `update:*`
then reaches no installed build.** The app uses the fingerprint
`runtimeVersion` policy, and `@expo/fingerprint` hashes `eas.json` as a build
input. An update published after such a commit targets a runtime version that
no installed build carries. The publish exits 0 and reports nothing. Before
you publish, compare two values. The first is the `runtimeVersion` of the
latest FINISHED `production` build, from
`eas build:list --platform ios --limit 1 --json`. The second is the runtime
version that `eas update` prints. When they differ, ship a native build and
let testers install it first. JS-only changes under `src/` and `app/` do not
move the version. The same rule already applies to config plugins and native
modules.

**Change the public app name without renaming `expo.name`.** `expo.name` also
names the `ios/forgewatch` project, and some storage keys use the same
`forge-watch` text, so do not change them. Set
`ios.infoPlist.CFBundleDisplayName` and `plugins/withAndroidAppName.js`
instead. See
`docs/solutions/best-practices/expo-app-display-name-without-renaming-expo-name.md`.

**`eas.json` sets `cli.requireCommit: true`.** An OTA update reaches every
tester in minutes with no store review, so publishing an uncommitted working
tree would ship code that exists nowhere in git. Two things about it are not
obvious:

- The clean-tree check runs `git status` from the REPO ROOT, not `apps/mobile`.
  A colleague's stray untracked file under `apps/admin` blocks a mobile publish.
- If you answer yes to its "Commit changes to git?" prompt it runs `git add -A`
  across all seven apps. Do not do that mid-incident — commit by hand instead.

It also applies to `eas build`, so a local experiment no longer reaches a build
archive uncommitted.

**Never set `EXPO_PUBLIC_ADMIN_GRAPHQL_URL` in an EAS environment.** With dotenv
disabled, resolution falls through to the in-code production default, which is
already correct and already reviewed. A dashboard-typed URL runs zod on the
device — a scheme-less host or stray whitespace would throw at module scope and
hard-fail startup for every beta tester.

## iOS build numbers (TestFlight)

**EAS owns the build number** (`cli.appVersionSource: "remote"` +
`production.autoIncrement: true`, the same shape `apps/tv` uses), so `app.json`
carries no `ios.buildNumber` and every `production` build takes the next
number without a commit. The version string (`expo.version`, `1.0.0`) stays
in `app.json`; bump it by hand when testers should see a new marketing
version. Read the counter with
`eas build:version:get --platform ios --profile production`; set it with
`eas build:version:set` only to seed or repair it.

Why it is remote: before this, a `production` build resolved to `1.0.0 (1)`
every time, and App Store Connect already held iOS build 1 from 2026-07-16,
so the next upload would have been rejected as a duplicate. The record
(`ascAppId` 6791428415, "Jesus Film Watch") is shared with `apps/tv`; App
Store Connect keeps one build list per platform, so the tvOS numbers do not
constrain iOS.

## EAS builder toolchain pins

`eas.json` has a `base` profile that every build profile extends, directly
or through `preview`. It pins `node` and `pnpm` and sets
`SHARP_IGNORE_GLOBAL_LIBVIPS=1`. Keep `pnpm` equal to `packageManager` in the
root `package.json`, character for character. Keep `node` on the same major
as `.nvmrc`. `.nvmrc` holds only the major (`24`), and `eas.json` needs a
full semver, so the patch is the release the last green build used. Bump all
three together. `app/__tests__/easToolchainPins.guard.test.js` pins both
rules, the `extends` chain, and the env. A pin bump edits `eas.json`, so it
moves the runtime version; see "Publishing an EAS Update". Never pass
`--profile base`: it resolves to a store build with no channel and no
build-number increment.

Why: EAS takes its toolchain from the current default VM image, not from
`packageManager`. On 2026-08-28 the default moved to macOS Tahoe / Xcode
26.6 / Node 22 / pnpm 11.9.0. Two mobile production builds then failed in
`Install dependencies` on `sharp@0.34.5`, an `apps/admin` dependency the
icon script borrows. Two separate facts, verified from the build logs:

- pnpm 11 ignores the root `package.json` `pnpm` field
  (`packageExtensions`, `overrides`, `patchedDependencies`). The pins fix
  that. They did NOT fix sharp — build `dfabe6e3` failed the same way on
  Node 24.14.1 / pnpm 9.12.3.
- The new image carries a global libvips. sharp's `install/check.js`
  exits 1 silently when `useGlobalLibvips()` is true. pnpm then runs
  `npm run build`. That build needs `node-gyp` and fails with "Please add
  node-gyp to your dependencies". The prebuilt `@img/sharp-darwin-arm64`
  package is in the lockfile the whole time; `SHARP_IGNORE_GLOBAL_LIBVIPS=1`
  makes sharp use it. The last good builds (mobile 2026-07-16, TV
  2026-08-19) ran on the older Sequoia image, which had no global libvips.

`apps/tv` carries neither the pins nor the env and will hit the same
failure on its next build. EAS build logs are Brotli-encoded JSON lines.
Fetch `logFiles[0]` from `eas build:view <id> --json` with Node and
`zlib.brotliDecompressSync`; python and curl on this machine lack Brotli.

## Observability (Datadog)

Client-side RUM + Logs via `@datadog/mobile-react-native`; helpers in
`src/lib/datadog.ts` (`datadogLog`, `reportDatadogError`).

- **Never name a custom log attribute `source`, `host`, `service`, `status`,
  `message`, or `trace_id`.** Datadog reserves them and drops the attribute on
  ingest — no error, no warning, and the log itself still looks healthy. Prefix
  with a feature namespace (`watch_search.*`) or pick a free name
  (`feed_source`, `http_status`, `error_message`). ES6 shorthand (`{ message }`)
  collides just the same and is the form review misses. Eight such collisions
  shipped before anyone queried the facets, with every emit-side test passing;
  `src/lib/__tests__/datadogReservedAttributes.guard.test.js` now blocks a
  ninth. Background: see
  `docs/solutions/conventions/datadog-reserved-log-attribute-name-shadowing.md`.

## Common Pitfalls

- Android VideoView z-order: renders on top of all RN Views. Place video BEHIND scroll content.
- **The ambient wash hands over to BLACK while the video plays (`WatchAmbient`), for EVERY video, by decision — not by detection.** It is POSTER-derived, so once playback moves past that frame it no longer describes what is on screen, and on a video with baked-in letterbox bars it frames them. It cross-fades to pure black rather than simply away, because black is what those bars ARE — handing over to `BG_COLOR` would still leave them ~28 levels off their surround. Both layers ride ONE value (the black is `playFade` inverted), so they can never both be up or both be gone. The black holds solid to the player's bottom edge then dissolves into `BG_COLOR` across the bleed, with that midpoint DERIVED from `topInset + playerHeight` — ending an opaque band on the clipped edge is the seam this layer was already fixed for once. `PLAYING_OPACITY_MULTIPLIER` is the knob (0 = full handover, 1 = old behaviour); `PLAY_FADE_MS` is deliberately slow (3s) so it reads as the room settling rather than a glitch. The animated opacity MUST NOT land in the same style array as `styles.root` — it would win over `AMBIENT_MAX_OPACITY` and silently discard the contrast ceiling while that ceiling's own guard stays green. Play state arrives via the module-scope request store (`setPlaying` / `usePlaybackPlaying`), mirroring `loadFailed`, because the host is a `<Stack>` SIBLING and no context or prop path reaches the route's layers.
- **Detecting baked-in letterbox bars on-device was investigated and REJECTED (2026-08-27) — do not re-litigate without new evidence.** Bars are in the PIXELS, not the container: `pilgrims-progress` is stored 1920x1080 on every rendition with 137 black rows top and bottom, so `VideoTrack.size` / `VideoThumbnail.width` / aspect metadata are all blind to it. Sampling frames DOES work (Mux `image.mux.com/<id>/thumbnail.png?time=&width=64`, requiring symmetry + steadiness across >=3 mid-timeline frames — a single middle frame false-positives on dark scenes, measured on `the-birth-of-jesus`), but the framing VARIES within one video (no bars t=3-20s on the same asset), only 1 in 11 videos is affected, and each cold bespoke Mux render costs ~0.93s TTFB. The unconditional fade above solves the same symptom with none of that. **Landmine if you retry:** feeding expo-video's `VideoThumbnail` into expo-image's `generateThumbhashAsync`/`generateBlurhashAsync` HANGS FOREVER on iOS — both internal `Either.get()` casts return nil, the generator never runs, and the promise never settles, so a prototype just looks like a slow network call. The only real JS-only pixel route is an offscreen `react-native-webview` canvas (already a shipped dependency; `image.mux.com` sends `access-control-allow-origin: *`).
- **A group `opacity` over stacked children needs `needsOffscreenAlphaCompositing` on Android.** Android applies a ViewGroup's opacity to EACH CHILD unless the subtree is composited offscreen first, so an OPAQUE overlay stops covering what is beneath it — it blends over an already-dimmed sibling instead. `WatchAmbient` is the worked case: poster + gradient under `opacity: 0.45`, where the gradient's opaque tail could never reach `BG_COLOR`, so the wash ended in a hard seam at its clipped bottom edge instead of dissolving into the page. iOS composites correctly on its own and measured byte-identical either way, which is exactly why it shipped. Diagnose it by giving the overlay an unmistakable opaque colour and sampling pixels: leaking reads as the overlay PLUS a tint (`#8a177f`), correct reads as the overlay alone (`#810e7f` = 45% magenta over `BG_COLOR`). Suspect this whenever a fade looks right on iOS and terminates in a line on Android — `zIndex` does NOT fix it, because the defect is compositing, not draw order.
- ScrollView gesture preemption: interactive hero elements need `pointerEvents="box-none"` pass-through.
- Lazy Apollo Client init: never module-scope. Use `getApolloClient()` getter.
- `contentParagraphs` is `string[]` (JSON field) — validate with `Array.isArray()`.
- `Math.round()` all scaled font sizes on Android (sub-pixel = blurry).
- Admin blocks use flat `videoId` — no nested `video { slug, images }` join. Use block-level `imageUrl`/`mediaUrl` for thumbnails, `deriveMuxThumbnailUrl()` for VideoHero poster.
- **`replaceAsync` settles when the source is SET, not LOADED** (on Android it is aliased to `replace`), so anything written in its `.then()` runs while the player still holds the OUTGOING item. A `currentTime` write there is silently discarded; a `play()` is the mild form. Resume and seek on `sourceLoad`, and scope the listener to the source that requested it — the app shares ONE player, so another surface's load will otherwise take your seek. Codified in `src/hooks/useAutostartPlayback.ts` and `src/lib/recoverPlayback.ts`; the tvOS route to the same premise is `docs/solutions/integration-issues/expo-video-replaceasync-seek-silently-dropped-tvos.md`. The shared jest double reproduces the real settle-before-load order, so this is testable.
- **Set `preservesPitch` EXPLICITLY on every player — never trust the default.** expo-video's TS types document it as `@default true`, but the ANDROID native default is `false` (`expo-video/android/.../player/VideoPlayer.kt`: `var preservesPitch = false`), and `applyPitchCorrection` then sets `pitch = speed`. So a playback-speed pick also shifted the speaker's voice up or down — chipmunk at 1.5x, baritone at 0.75x. iOS never showed it because AVPlayer corrects pitch itself, which is exactly why the wrong default survived review. `useManagedVideoPlayer` sets it at creation, which covers every surface that can change speed (the heroes are muted and never change rate). Measured on the Pixel 9a emulator by reading the property back through the native getter: `false` before the set, `true` after. The shared jest double defaults it to `false` ON PURPOSE — mirroring Android, not the types — so the assertion in `useManagedVideoPlayer.test.tsx` can only pass if the app sets it.
- Gating chrome — or any recovery affordance — behind a load: enumerate every path that fails to release the gate. "Playback started OR the player errored" misses "neither": backgrounding mid-load, and a source that wedges without ever erroring. Both leave the viewer with no controls and no way out, and neither logs anything. Always pair such a gate with an unconditional time-based release, and gate the tap target with the same predicate as the chrome it hides. See `docs/solutions/logic-errors/mobile-watch-autostart-veil-gate-missing-release-path.md`.
- iOS 26 makes the stack back-swipe FULL-WIDTH by default (react-native-screens turns it on when `fullScreenSwipeEnabled` is unset), and a JS PanResponder can never outrace it: the native recognizer claims the touch at delivery, before JS runs. So a rightward scrub on the seek bar IS the pop gesture. **Split the screen instead of racing it.** The watch/series routes confine the pop to a 24pt left strip via `gestureResponseDistance`, and the Scrubber DECLINES touches that start inside that strip (`mayStartScrub` in `src/lib/scrubber.ts`, on BOTH responder gates). One constant feeds both halves (`src/lib/backSwipe.ts`) so they cannot disagree. `fullScreenGestureEnabled: false` is the wrong tool — it kills ALL back-swipe on iOS 26, because no legacy edge recognizer fires.
- **Do not gate the back-swipe on chrome visibility.** An earlier fix held `gestureEnabled` false while the player chrome was mounted. `shouldArmHideTimer` never arms while paused or ended, so the chrome never auto-hides in those states and the hold never released: pausing a video killed the edge back-swipe for the screen's whole life. Only fullscreen may disable the gesture. Every `gestureEnabled` write must still land on BOTH the screen and its parent stack — the pop that dismisses a nested route belongs to the ROOT stack, which consults only its own top screen. `app/__tests__/backSwipeGesture.guard.test.js` pins the layout options AND the edge width; `useFullscreenPresentation.test.tsx` pins that the gesture stays enabled outside fullscreen.
- **Never set a react-native-screens `orientation` screen option.** `expo-screen-orientation`'s `ScreenOrientationViewController` answers UIKit from its OWN registry mask — what `lockAsync` writes — only while no screen carries an orientation. The moment one does, it defers to the react-native-screens view-controller chain instead, and a **dev client** has `expo-dev-launcher`'s `DevLauncherViewController` sitting in that chain: the resolved mask loses landscape, UIKit refuses the geometry request (`UIWindowScene.interfaceOrientationsNotSupported`, readable via `xcrun simctl spawn <udid> log stream`), fullscreen stays portrait, and leaving fullscreen strands the details page in landscape until the route pops. The option was always redundant — `src/lib/orientation.ts`'s lock already names the orientation on both platforms — so `useFullscreenPresentation` sets only the lock, and the dev client now rotates exactly like a Release build. Verified 2026-08-26 on the iPhone 17 Pro Max simulator in BOTH build types. `app/__tests__/screenOrientationOption.guard.test.js` blocks the one-line revert across every `.ts`/`.tsx` file under `app/` and `src/`, with a >100-file floor so the scan cannot silently go empty. It has TWO rules, and both are live: Rule 1 matches the key next to a quoted orientation value anywhere in the file (this catches the ternary across line breaks); Rule 2 matches a bare `orientation` KEY of any value shape — named constant, shorthand property — but only inside a brace-matched `screenOptions`/`options` object, so `src/lib/watchHome/`'s unrelated `orientation` key does not trip it. See `docs/solutions/integration-issues/expo-screen-orientation-rnscreens-deferral-blocks-fullscreen-rotate.md`.
- **`PlayerSlot` must never depend on getting exactly one good `onLayout`.** `measureInWindow` SILENTLY drops its callback when the native node is not attached yet, and the host (`PlaybackHost`) returns null while the slot's rect is null — so one unlucky cold open leaves an opaque black box with no poster, no chrome, and no recovery except leaving the screen. Measured on the iPhone 17 Pro Max simulator over 10 cold deep-link opens: 2/10 on unmodified main, 0/10 after the bounded `requestAnimationFrame` re-measure. Three parts, and all three matter: retry until a rect lands, refuse a zero-size measure, and gate `isDrawn` on the RECT rather than on the attachment so the slot keeps its own poster while the host has nothing to draw. `src/components/watch/__tests__/PlayerSlot.test.tsx` drives a real `measureInWindow` callback and pins all three parts: a zero-size measure publishes nothing, a valid one publishes exactly the measured rect, and the pump stops asking once a rect lands. Exhaustion logs `player_slot.measure_exhausted` once, so an unmeasurable slot is visible in production instead of silent. The instrumentation that separates the cases is a `console.log` in `measureIntoStore` plus one inside the `measureInWindow` callback — `onLayout` fires in BOTH the good and the black run; only the callback differs. See `docs/solutions/integration-issues/expo-screen-orientation-rnscreens-deferral-blocks-fullscreen-rotate.md`.
- Search requires `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` (mobile's OWN dedicated fleet key — its own entry in admin's `FLEET_ADMIN_API_KEYS` CSV, NOT `WEB_ADMIN_API_KEYS`, and never the same value as TV's; provision in EAS Environments per profile, `.env.local` for dev). `watchSearch` is a PUBLIC resolver, so the bearer buys a per-device rate-limit bucket, not access; a missing/rotated key degrades to the shared `public:<ip>` bucket rather than an `UNAUTHENTICATED` error. The bearer rides ONLY on the `WatchSearch` operation — never attach it to public queries, or every public query also spends the fleet key's rate-limit budget. Admin buckets a fleet key per device (`consumer:<key>:v:<viewer_id>` from the `x-viewer-id` header, else `consumer:<key>:<ip>`), so the fleet doesn't collapse into one bucket. See `src/lib/authHeaders.ts`.

## Auth + watch progress (feat: mobile login & continue watching)

- **Login is hosted-only (feat-349)**: every sign-in entry point calls
  `signInWithHostedPage()` in `src/lib/authActions.ts`. It opens the hosted
  auth login page in a system browser sheet (the Better Auth `jfp` self-RP
  flow) and is single-flight — a second call joins the in-flight attempt.
  The app renders no credential UI of its own; a new auth method reaches
  mobile when the auth platform enables it, with no app release. The auth
  side sets `prompt: "login"` on the `jfp` provider, so the sheet always
  shows the login form after sign-out. A user cancel settles session-less —
  the expo plugin never throws for it — so a thrown browser open always
  classifies as a retryable error (`src/lib/authFlows.ts`).
- **The hosted flow is `signIn.social({ provider: "jfp" })`, and the Better
  Auth client version is pinned in LOCKSTEP with `apps/auth`.** Better Auth
  1.7 removed the generic-oauth plugin's own endpoints (`/sign-in/oauth2`,
  `/oauth2/callback/:id`) and its `genericOAuthClient`; generic providers now
  ride the core `/sign-in/social` + `/callback/:id`. Auth moved to 1.7.1 on
  2026-08-24 (#1978) while mobile stayed on 1.6.2, so every sign-in from
  TestFlight build 1.0.0 (4) POSTed to a route that no longer existed: 404 →
  `result.error` → the retry card, with no sheet ever opening. No mobile test
  could see it — the client is mocked at the module boundary and the server
  lives in another package — so
  `src/lib/__tests__/betterAuthVersionLockstep.guard.test.js` reads BOTH
  manifests and fails on any drift of `better-auth` / `@better-auth/expo`.
  Bump the two apps together, in one PR; auth's
  `mobile-expo-plugin.guard.test.ts` pins the installed `@better-auth/expo`
  dist and fails on every bump until the mirrored proxy is re-verified.
  Five auth-side pieces the same flow depends on:
  the route wrapper must pass a `forgemobile://` callback through
  (`resolveMobileCallbackURL`); `mobileAwareExpoPlugin` must re-admit the
  self-RP authorize URL in the 1.7 browser proxy — a bare `expo()` there ends
  every sign-in on `{"message":"Invalid authorizationURL"}` inside the sheet;
  `accountLinking.requireLocalEmailVerified` must stay `false`, or a user
  without a `jfp` account row (every hosted sign-up) ends on
  `error=account_not_linked` and the app reads a quiet cancel; the
  session stamp must read `params.id` (the 1.7 core callback is
  `/callback/:id`), or the JWT carries no mobile claim for progress writes;
  and `selfRpStateCookiePlugin` must plant the self-RP `state` cookie again
  when `/oauth2/authorize` hands the browser its code — a Google or Okta
  sign-in on the hosted page is a second OAuth flow in the same sheet that
  consumes the ONE `state` cookie 1.7 checks, so without it every provider
  sign-in ended on `forgemobile:///?error=state_mismatch` and the app read a
  quiet cancel (build 1.0.0 (5), 2026-09-07; the password form never
  triggers it, which is why the #2176 verification passed). A quiet cancel
  hides every one of these from the user: when the sheet closes and the
  Profile tab still says Sign in, read production auth's deploy log first.
  `@better-auth/utils` rides the same lockstep: it is `@better-auth/core`'s
  EXACT peer, and with both apps carrying `core`, pnpm resolved auth's peers
  against `better-call`'s `^0.5.0` walk, split `core` into two lockfile
  variants, and failed auth's typecheck — the explicit `0.4.2` pin in BOTH
  manifests holds the walk. A provider-side failure inside the flow returns
  as `forgemobile:///?error=<code>` (auth's `errorCallbackURL`); the Expo
  client ignores that param, so the app reads a quiet cancel, but the sheet
  no longer strands on a web page. Deploy order: auth first, then the
  mobile build.
- **iOS auth session is EPHEMERAL** (`webBrowserOptions.preferEphemeralSession`
  on the expo client, iOS-only): no Safari cookie sharing, so no per-sign-in
  "Wants to Use…to Sign In" consent alert and no iOS shared-device residual.
  This reverses the July KTD2 non-ephemeral choice; the accepted cost is no
  one-tap reuse of an existing Safari IdP login (social users re-authenticate
  each sign-in). SCOPE: the residual claim is iOS-only. On Android the Custom
  Tab keeps the `auth.jesusfilm.org` cookie in Chrome after app sign-out (the
  flag does not apply there); `prompt=login` still guards the in-app path.
  Only observable at iOS runtime — verify in the simulator, not jest.
- **Android callback scheme — accepted risk (2026-08-12)**: the session cookie
  rides the `forgemobile://` custom scheme — the expo client reads `?cookie=`
  off the callback and stores it. On Android a custom scheme is unverifiable, so
  a co-installed app declaring `forgemobile` could intercept the session bearer.
  feat-349 deleted the other flows, so this is now the ONLY mobile sign-in
  channel. Accepted for now: short session lifetime + this-device-only
  SecureStore. FOLLOW-UP before a wide Android production release: evaluate an
  `https://auth.jesusfilm.org/…` App Link callback (`assetlinks.json`), gated on
  `@better-auth/expo` accepting an https callback. iOS is unaffected —
  `ASWebAuthenticationSession` binds the callback to the calling app.
- **Session**: `src/lib/authSession.ts` owns the Better Auth Expo client
  (lazy getter, never module-scope) and a subscribable snapshot readable
  WITHOUT React — the Apollo link and recorder read it directly. Credentials
  live in SecureStore with this-device-only accessibility; Android backup is
  opted out via `app.json` `allowBackup: false`. The short-lived user JWT is
  memory-only with single-flight refresh-on-expiry.
- **Operation-scoped user JWT (same law as the fleet search bearer)**: the
  signed-in JWT rides ONLY the progress operations
  (`PROGRESS_OPERATION_NAMES` in `src/lib/authHeaders.ts`); the async
  `createUserJwtLink` sits ahead of the sync header links and forwards every
  other operation untouched. Guard tests pin the gate to the operations
  actually sent — never widen it.
- **Progress store**: `src/lib/watchProgress/` — account-tagged in-memory
  store + versioned AsyncStorage snapshot + account-bound offline queue
  (slug-keyed for downloaded playback; admin resolves slugs server-side).
  Recording rides `useManagedVideoPlayer`'s existing 1s poll via
  `options.progress` (heroes never reach the adapter, so they're excluded
  structurally); writes batch at most once per 30s (admin's rate limiter
  allows 30 mutations/min — never write per-tick), forced on
  pause/background/unmount/end AND on the two explicit session endings the
  mini player added — `dismiss` (the viewer closed the window) and `replace`
  (new content took the player over). Those two split what `unmount` used to
  conflate, because progress attribution needs them apart. Progress is
  signed-in ONLY (R10): sign-out empties store, snapshot, and queue via
  `attachProgressLifecycle`.
- **Bars**: one `WatchProgressBar` (store-subscribed by videoId, <1% hidden,
  ≥90% snaps full) on every card surface EXCEPT the Library downloads row
  (deferred — the row stores only a slug). Fold progress into
  `accessibilityLabel` via `progressAccessibilityText`.
- **RUM identity**: `setDatadogRumUser` receives the opaque auth subject id
  only — never email or display name.

## Recommendations API client (feat-516)

`src/lib/recommendations/` is the mobile client for Admin's source-free
recommendations API (`docs/operations/user-recommendations.md`). It ships the
data layer and playback attribution only; the Home shelf is `feat-517`.

- **The fleet bearer rides the eight recommendation operations, and admin
  REQUIRES it there.** `carriesFleetBearer` in `src/lib/authHeaders.ts` admits
  `WatchSearch` plus `RECOMMENDATION_OPERATION_NAMES`
  (`src/lib/recommendations/operationNames.ts`). On search the bearer only buys
  a rate-limit bucket; on these operations a fleet caller is admitted only with
  the bearer AND a proven viewer handle, so a missing header is
  `UNAUTHENTICATED`, not a coarser bucket. `authHeaders.test.ts` pins the set
  to the documents in `operations.ts`, and
  `operations.contract.guard.test.js` validates every document against the
  committed `apps/admin/schema.graphql`. Mobile never sends `sessionDigest`,
  `consentReceiptDigest` or `profileTokenDigest`: those are the Web backend's
  authority, and admin rejects a request that mixes them with viewer tokens.
- **One anonymous viewer per installation, in SecureStore.**
  `viewerIdentity.ts` holds the server-minted `viewerToken` (180-day handle)
  and `sessionToken` in one JSON record under
  `forge-watch.recommendation-viewer.v1`, this-device-only. `get()` bootstraps
  lazily with one shared flight. Installations are independent; there is no
  account linking. Sign-out does not touch it.
- **An `UNAUTHENTICATED` answer never discards the stored viewer by itself.**
  Admin uses one error for a dead handle AND a broken app bearer, and the
  stored viewer is this install's whole history. A rejection marks the record
  suspect; the next `get()` re-verifies it with `status`, and only when that
  is rejected too AND a bootstrap under the same bearer SUCCEEDS is the
  handle replaced. A rejected bootstrap means the bearer is the fault: the
  viewer is kept and a 60 s cooldown applies. A FRESH handle (under 5 min)
  enters the cooldown before any verification. `withdraw`/`delete` keep the
  handle in its essential-only state; nothing bootstraps a replacement to undo
  an opt-out. Every profile transition notifies `subscribe()` listeners, and
  `useUserRecommendations` refreshes on it. A suspect handle whose `status`
  probe fails TRANSIENTLY keeps serving and is not probed again for 60 s
  (`VERIFY_RETRY_BACKOFF_MS`); without that, every `get()` during an Admin
  degradation was one more `status` mutation against the shared bucket.
- **Admin's rate limiter answers HTTP 200, and the client treats it as
  transient.** `@envelop/rate-limiter` emits an `errors[]` entry with
  `extensions.http.statusCode: 429` and no `code` (Yoga reads
  `extensions.http.status`, so the HTTP status stays 200). `errors.ts` maps
  that, and an edge HTTP 429, to `RATE_LIMITED` with the `Retry-After` window,
  never to the definitive `GRAPHQL_ERROR`. A limited claim, including its
  context issuance, waits the window once instead of spending an attempt; a
  limited evidence send retries once after the window, never 100 ms later; a
  limited facts batch pauses the drain for the window without spending a
  delivery attempt, at most three times per episode, then drops the batch and
  keeps the episode open; a limited bootstrap is a cooldown
  (`bootstrap_rate_limited`), not a failed bearer.
  The bucket is 30 mutations per minute per `x-viewer-id`, shared by every
  recommendation mutation the launch sends.
- **Session rotation takes its random bytes from `expo-crypto`.** Hermes
  ships no `crypto.getRandomValues`, and Expo's runtime installs no `crypto`
  global, so `secureRandomToken()` in `random.ts` tries the runtime's
  WebCrypto first (jest, a browser) and then requires `expo-crypto` lazily
  (the device). A source that throws or leaves the buffer untouched (the
  jest mock of the native module) yields null, never a weaker token. With
  the source present the store rotates the session after 24 h of inactivity
  and links it with `status` first; without one it reports
  `session_rotation_unavailable` once per launch, so "no idle installs" and
  "no random source" differ in the dashboard. `expo-crypto` is a NATIVE
  module (added 2026-09-17): it moves the fingerprint runtime version, so a
  native build must ship before the next `eas update` reaches anyone. A
  claim nonce may fall back to the runtime's plain generator: it is a
  correlation key bound to the viewer credentials, not a secret.
- **No bearer, no network.** With `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` unset the
  store answers `unprovisioned` and nothing is sent. A development bundle
  against local admin usually fails the bootstrap with `UNAUTHENTICATED`
  (the production fleet key is not in local admin's keyring); that is one
  request, then the cooldown.
- **Delivery is strict.** `delivery.ts` accepts a served slate only whole:
  contract `user-recommendation-v1`, surface `watch-for-you-v1`, a request id,
  exactly the requested count, positions in index order, distinct target
  media. A served envelope that fails those checks is `invalid_delivery`; a
  `fallback`, `empty` or `unavailable` envelope carries Admin's own reason,
  so the log keeps a fault apart from an honest miss. `environment_disabled`
  is `disabled`; `cooldown`, `in_flight`, `admission_unavailable`,
  `delivery_timeout` and `service_unavailable` are retryable;
  `coverage_unavailable` is not. `useUserRecommendations` retries once after
  5 s, three attempts, and refreshes on locale or audio-language change. The
  response's `expiresAt` is the authority on the item capabilities (ten
  minutes today): past it the hook sends no evidence and returns null from
  `select`; the UI refreshes instead.
  `resolveRecommendationContext` maps the watch preference to
  `{ locale: "en", audioLanguageSlug: prefs.audioLanguageSlug ?? "english" }`.
- **Evidence and selection mirror Web's literals.** `render` carries
  `{ surfacePolicy: "watch-for-you-v1" }`, `impression`
  `{ visibilityPolicy: "watch-for-you-v1" }`, both under
  `recommendation-evidence-v1`, one mutation per fact, deduplicated per
  request, item and kind. Impression ELIGIBILITY (50% visible for one
  continuous second) is the UI's job. `select` mints a claim nonce, stores it
  in the module-scope pending-claim store BEFORE the mutation, and resolves
  with the slug to open even when the send fails. Only the statuses in
  `ACKNOWLEDGED_SELECTION_STATUSES` (`accepted`, `replay`) count as
  acknowledged; a `conflict` or any status this client does not know is
  reported and the recorder's claim attempt decides. `useUserRecommendations`
  serves no items, evidence or selection while `enabled` is false, and a
  selection stays single-flight across a profile refresh.
- **Playback attribution runs for every playback the root host owns.**
  `useManagedVideoPlayer` creates one `playbackRecorder.ts` per Admin video id
  when `ownsSession` is set (the SDUI routes never get one) and keeps it across
  a dub switch. A recorder created after playback began (the seed path: a
  search result or a Home tile plays the seed stream before the record loads)
  is primed with the player's live playing state, or it would never record
  `playback_start`. The recorder claims an episode from the pending selection
  nonce, else issues a playback context from `playbackDiscovery.ts`
  (single-video search results mark `search`, external links mark `share`,
  everything else is `direct`) and claims that. A series search result opens
  a list, so the search tab carries `?from=search` (`DISCOVERY_ROUTE_PARAM`)
  into the series route and the episode tap there marks the episode;
  `seriesSearchDiscovery.guard.test.js` pins both halves because the series
  screen has no render suite. Facts follow admin's strict schemas and
  Web's caps: 16 per mutation, 8 KB per body, 128 per episode, three delivery
  attempts, observations dropped first, and nothing sent past the episode's
  `hardUntil`; the budget is charged only for facts that are queued. The
  context issuance is part of the claim: it shares the claim's three
  attempts and its one window deferral, and it takes the discovery mark once,
  so a transient answer to `issueWatchPlaybackContext` no longer abandons the
  episode. After `dispose()` the recorder starts no claim retry, issues no
  context and takes neither the selection nonce nor the discovery mark (a
  replacement recorder for the same media needs them), but a claim chain
  already in flight (an issuance or the claim itself) still delivers the held
  facts once, and a facts drain already in flight finishes its own retry
  ladder. `useManagedVideoPlayer.recommendations.test.tsx`
  pins the wiring; `playbackRecorder.test.ts` pins the decisions. Budget:
  about one claim plus one facts mutation per 10 s while playing, under
  admin's 30 mutations per minute per `x-viewer-id` bucket.
- **`EXPO_PUBLIC_RECOMMENDATIONS_ENABLED` is an opt-OUT switch.** Unset keeps
  the client on; only `false` or `0` turns it off. Expo inlines the value, so
  a flip needs an update publish.
- **Telemetry attributes are `rec_`-prefixed** (`recommendation.identity`,
  `recommendation.delivery`, `recommendation.evidence`,
  `recommendation.playback_degraded`). No token, capability, nonce, episode id
  or request id ever reaches a log.
- **No real Admin endpoint has been exercised.** The handoff established no
  enabled development endpoint, and production must not receive test
  identities. The device smoke ran against a throwaway local proxy (see the
  `feat-516` ticket's Results); the first real-environment smoke (bootstrap,
  `status`, one playback episode) is the first step of `feat-517`. Beware
  port 3003 for such a proxy: a real local admin usually owns it, and the
  simulator resolves `localhost` to it over IPv6 while a proxy on
  `127.0.0.1:3003` sits idle.
- **The adapter's `abandoned` session reason is NOT an episode ending.** It
  fires on the first source arrival and on every dub switch; mapping it to a
  route exit ended every episode 19 ms after it began on device.
  `useManagedVideoPlayer.recommendations.test.tsx` pins that only `dismissed`
  and `replaced` close the episode from `endSession`.

## Mini player and the root-owned playback session (feat-367)

**The app owns ONE player and ONE video view, and neither belongs to a route.**
`src/components/watch/PlaybackHost.tsx` mounts as a sibling of the `<Stack>` in
`app/_layout.tsx` and holds the app's single `useManagedVideoPlayer` adapter.
A route that wants video renders `src/components/watch/PlayerSlot.tsx`: a
transparent box that reserves the layout, measures itself in WINDOW
coordinates, and publishes a playback request. The host draws its one video
view into that rect. The chrome rides in the host layer too, not in the route.

- **Never mount a second player or a second video view for one video.** The
  video view keeps ONE position in the host's tree in every state — full,
  floating, suppressed. The full view and the floating window differ only in
  the frame's geometry and in which chrome renders beside it. Moving the view
  between parents remounts the surface, which is a black flash.
  `rootPlayerOwnership.guard.test.js` pins the shape.
- **The session lives in module scope, not React context.** `src/lib/miniPlayer/`
  holds it: `store.ts` (the session), `playbackRequest.ts` (the slot-to-host
  channel), plus the pure `presentation.ts`, `suppression.ts`, `layout.ts`,
  `heroYield.ts` and `pictureInPicture.ts`. The host is a `<Stack>` SIBLING, so
  a context could not reach both halves.
- **One identity predicate: `sameSessionContent` in `store.ts`.** A screen
  that mounts onto the video already floating publishes its descriptor by
  slug alone, because the group-scoped `WatchSessionProvider` holds no record
  until its effect runs; the id follows a commit later. The store's
  replacement, its merge, and the host's adoption all read that predicate, so
  the remount keeps the session. The host also holds the last progress
  identity it resolved for the same slug (`holdProgressIdentity` in
  `PlaybackHost.tsx`), so the id-less render neither re-keys the progress
  recorder nor disposes the recommendation recorder. Before 2026-09-22 every
  expand ended the session as `replaced`, reloaded the video from 0:00, and
  claimed a second recommendation episode.
- **`MiniPlayerWindow.tsx` is chrome, never a second video view.** It draws the
  controls, the drag, the ended/failed states and the accessibility surface over
  the frame the host animates. The drag node never takes the native driver
  (a PanResponder writing it with `setValue` fails silently under one); the
  shrink and exit wrappers always do. Do not mix drivers on one node.

**Android `textureView` is mandatory on EVERY video view.** Keep
`surfaceType={Platform.OS === "android" ? "textureView" : undefined}` on each
one. A SurfaceView composites outside the RN view hierarchy and punches through
anything drawn above it, so controls and captions stop rendering over the
video. `homeHeroAndroidCompositing.guard.test.ts` pins this on all five video
surfaces (the host, `HomeHeroPager`, `VideoHeroRenderer`, and the two SDUI
routes `app/video/[sectionKey].tsx` + `app/collection/[sectionKey].tsx`).
No-op on iOS. The guard is an ENUMERATION, not a sweep: the two SDUI routes
predated it by four months and shipped without the prop because nobody added
them to the list. Add a case whenever you add a `<VideoView>`.

**Sheet suppression is cross-platform; the hazard it prevents is Android-only.**
The window hides while an in-app sheet is presented and returns to its corner
when the sheet closes. Two mechanisms, because the app presents sheets two
ways — six real sheet ROUTES (`IN_APP_SHEET_ROUTE_PATTERNS` in
`src/lib/miniPlayer/suppression.ts`, read from `app/watch/_layout.tsx` and
`app/series/_layout.tsx`) and three sheets that are component state, counted by
`getNonRouteSheetCounter()` and keyed by id so an unbalanced call is
attributable. Keep both in step with those layouts. The rule runs on both
platforms even though only Android paints through a sheet, so behaviour does
not fork per platform. Suppression hides by opacity and drops pointer events —
it never unmounts the view.

**Picture-in-picture: one props object, one latch, chrome-only suppression.**
Every video view that can enter the OS window spreads
`pictureInPictureViewProps()` from `src/lib/miniPlayer/pictureInPicture.ts`.
It wires `onPictureInPictureStart/Stop` to `setPipHold`, and three separate
requirements rest on those four props arriving together — a view that enters
the OS window without feeding the latch is paused by the AppState handler,
is unmounted by the host mid-window, and takes the floating window's chrome
with it. `startsPictureInPictureAutomatically` belongs to exactly ONE mounted
view: expo-video elects a single candidate across every view carrying it and
re-parents only the elected view's player back out.

- **While the latch is set, suppress CHROME only — never unmount the video
  view.** Unregistering the view fires expo-video's unguarded native path. The
  presentation selector returns `hidden` for a PiP hold on the same branch as
  sheet suppression by RESULT only; the mechanisms differ.
- **The latch must be released on teardown.** A stuck hold exempts EVERY
  adapter from the background pause, because that decision reads one store
  field.

**Every player surface autostarts behind a poster and a spinner.** Opening a
video IS the viewer asking to watch it, so no surface may sit on a play button
waiting for a second tap. `/watch/[slug]` gets this from `VideoPlayer.tsx`'s
`awaitingAutostart`; the two SDUI routes get it from
`src/hooks/useAutostartPlayback.ts`, which is the same gate without the cast
entanglement `VideoPlayer` has to carry. Neither SDUI route autostarted for
months because the paths were written separately and nobody compared them —
`video/[sectionKey]` sat on a tap-to-play poster, `collection/[sectionKey]` had
no poster at all. If you add a fourth player surface, use the hook.

The gate's release paths are the whole point, and there are three: playback
started, the source errored, or `AUTOSTART_VEIL_TIMEOUT_MS` elapsed. The third
is not optional — a load that neither starts nor errors would otherwise strand
the viewer under a veil with no controls.

**On the SDUI routes the poster and the veil share ONE predicate —
`awaitingAutostart`.** Gating the poster on `!hasStarted` there strands the
viewer: on the error and timeout paths the veil lifts while the opaque poster
stays over the native transport. `pointerEvents="none"` keeps the controls
reachable by touch, which is not the same as visible.

**The deciding property is z-order, not the predicate pair.** `VideoPlayer.tsx`
gates its poster on `(!hasStarted || castRemoteActive || ended)` against the
same `awaitingAutostart` veil and is CORRECT, because its chrome is React,
renders after the poster in the same parent, and mounts on exactly the paths
that lift the veil. The SDUI routes set `nativeControls`, so their transport
lives inside the `VideoView` and any later sibling covers it — which is why they
need the shared predicate and `/watch/[slug]` does not. Before copying a gate
between player surfaces, check which side of that line you are on. The general
rule: every layer that can hide the recovery affordance must clear on every path
that releases the gate.

## Lapse reminders (local notifications)

**Two LOCAL notifications — day 1 and day 7 after the last app use — that
reopen the last video the viewer watched.** The app registers no push token and
calls no server. `src/contexts/LapseReminderProvider.tsx` is the only host: it
mounts inside `ExperienceSelectionProvider` in `app/_layout.tsx` and wires four
pure modules — the schedule pass (`src/lib/lapseReminders/lifecycle.ts`), the
once-per-install permission prompt (`permissionPrompt.ts`), the tap handler
(`tapHandler.ts`) and the last-watched writer (`src/lib/lastWatched/`). Each
one takes every dependency by injection, so the whole feature tests with no
native module. That same design is why the guards below exist. The design
record is `docs/plans/2026-09-16-1101-feat-mobile-lapse-reminders-plan.md`; it defines
the KTD, R and AE numbers the source comments cite.

- **`LAPSE_REMINDERS_ENABLED` is the whole kill switch, and OFF is not inert.**
  It sits in `src/lib/lapseReminders/constants.ts`, on one line, as a bare
  literal, in a file that imports nothing — so it flips by OTA alone. With it
  off the schedule pass still runs, and it cancels both identifiers and
  dismisses every delivered reminder. The tap handler still consumes a pending
  tap and clears the stored response; the gate only stops the navigation. That
  clear matters: an uncleared response replays on every later attach for the
  life of the install. The prompt asks nothing, and it writes no asked-once
  latch, so the first launch of a build that turns the feature on still gets
  its one prompt. `lapseRemindersKillSwitch.guard.test.js` pins the
  one-line shape, the zero-import leaf, and that no other module declares the
  same name.
- **`src/lib/lapseReminders/notificationsAdapter.ts` is the ONLY file that may
  import `expo-notifications`.** `lapseReminderWiring.guard.test.js` walks the
  source tree for the specifier and fails on a second importer. It also pins
  the provider's mount point and the adapter `require` inside `app/_layout.tsx`'s
  guarded block — that require is what registers the foreground handler at the
  adapter's module scope, so a reminder that fires while the app is open shows
  nothing. `notificationsEntryPoint.guard.test.js` covers the other side: it
  resolves the installed module, checks every call the adapter makes, pins the
  version floor, and rejects the two deprecated `*Async` spellings of the
  last-response pair. The adapter binds the SYNCHRONOUS pair, because on a cold
  start the OS replays the tap into the last response rather than into the
  listener.
- **The injected log sink must stay named `telemetry`, and every context must
  stay an inline object literal.** `datadogReservedAttributes.guard.test.js`
  sweeps for Datadog's reserved attribute names, and it reads only sinks
  spelled `datadogLog`, `DdLogs` or `telemetry`. It follows an INLINE literal
  only; a context hoisted into a variable is a documented blind spot. So a
  rename to `log`, or a hoisted context, takes every emit site out of the sweep
  with the whole suite still green. Datadog then drops a reserved name on
  ingest with no error, and only the facet goes missing.
  `lapseReminderWiring.guard.test.js` pins the literal `telemetry: datadogLog`
  in the provider.
- **The notification icon is a DEDICATED asset. Never point the plugin at
  `adaptive-icon-monochrome.png`.** Android draws a notification icon from the
  ALPHA CHANNEL alone, so both assets are a white mark on transparency and the
  swap looks safe. The monochrome one is drawn for the 108dp adaptive canvas
  whose middle 72dp shows, so it put the mark at 40.6% x 30.2% of the
  status-bar slot (measured 2026-09-16). `scripts/generate-app-icon.mjs` emits
  `assets/notification-icon.png` from the same source at its own
  `WIDTH_NOTIFICATION`. `appJsonNotifications.guard.test.js` decodes the
  committed PNG and measures its alpha bounding box against
  `MIN_MARK_WIDTH_FRACTION`, with the adaptive silhouette as the positive
  control. The same guard pins `defaultChannel` and
  `enableBackgroundRemoteNotifications` as unset, and both exact-alarm
  permissions as absent.
- **The last-watched writer's private `lastWrittenSlug` latch is deliberately
  NOT reset on a record clear (AE9).** It lives in
  `src/lib/lastWatched/lifecycle.ts`. A sign-out clears the record but does not
  stop playback, so a reset would re-record the video that is still playing and
  point the reminders back at the previous account. The test named "does NOT
  re-record the same video after a sign-out clears the record" in
  `src/lib/lastWatched/__tests__/lifecycle.test.ts` fails on a reset.
- **Two fixed identifiers: `lapse-reminder-day1` and `lapse-reminder-day7`.**
  Scheduling under an identifier that is already pending REPLACES it, which is
  how the two-at-most bound holds by construction, with no window between a
  cancel and a schedule where nothing is pending. **That replacement is a
  platform contract on iOS and only INFERRED on Android.** The U7 device pass
  proves it; until that pass runs, treat the Android half as unverified. KTD2
  carries the fallback order — schedule the new pair first, then cancel the old
  pair by identifier.
- **The reminder body NAMES the video, and the title travels in the record, not
  in the payload.** `src/lib/lapseReminders/copy.ts` is the only place a body is
  built: `LAPSE_REMINDER_COPY_TITLED` when the record carries a title,
  `LAPSE_REMINDER_COPY` when it does not. Both sets must stay — a record written
  before titles, or one whose title failed the sanitizer, still has to read as a
  finished sentence. The title is baked into the body AT SCHEDULE TIME, so a
  pending reminder keeps the title it was scheduled with. It never enters the
  notification payload: the tap still reads the slug alone, so a CMS title can
  never steer navigation.
- **`LAST_WATCHED_VERSION` deliberately did NOT move when `videoTitle` was
  added.** The field is optional on read, so every v1 record on an upgrading
  device still parses and simply has no title. Bumping the version would void
  those records and send the next reminder to Home. The test named "reads a
  record written before titles as having none" pins this, and it writes the
  literal `1` rather than the constant — written as the constant it would move
  with a bump and could never fail.
- **Only a title from the RESOLVED video record may be persisted, never one
  from a deep-link seed.** `displayTitle` in `app/watch/[slug].tsx` is
  `video?.title ?? seed?.title`, and `decodeWatchSeed` validates the seed's
  `imageUrl` and `playbackId` but not its `title`. A crafted
  `forgemobile://watch/<slug>?seed={"title":"…","playbackId":"<any public mux
id>"}` autostarts, so the writer would otherwise persist attacker text and
  post it on a locked device under the app's own name. `PlaybackSessionDescriptor`
  therefore carries `titleFromRecord`, and `attachLastWatchedWriter` writes a
  title only when it is true. The field is REQUIRED, so a new session producer
  has to state provenance. The seed may still paint on screen, where the viewer
  has context.
- **The writer allows exactly ONE corrective upgrade per slug.** A downloaded
  video plays before the query supplying its title resolves, so the first write
  is untitled; without the upgrade a slug-only latch would leave that video
  unnamed for good. The upgrade is bounded to empty-then-titled, which is what
  keeps AE9 intact — dropping the bound turns AE9's own test red.
- **The title is sanitized where the record is, not where it is displayed.**
  `sanitizeLastWatchedTitle` runs on BOTH the write and the read — the parser
  must not trust a stored value the current serializer would never have written.
  It strips C0/DEL/C1, the Unicode line and paragraph separators, and the bidi
  and zero-width format characters: on a lock screen the body has no title
  field, so a bidi override reverses the app's own sentence around the title.
  The cap counts CODE POINTS, because a UTF-16 slice can cut a surrogate pair
  and leave a lone surrogate that is not representable on the native bridge.
- **Write that character class with `\x`/`\u` ESCAPES, never raw bytes.** A
  literal NUL in the source makes git classify the whole file as binary, and
  `git diff` then shows `Binary files ... differ` — so no PR can review the one
  module that bounds what reaches a lock screen. This already happened once.
- **The body renders on the lock screen.** Naming the video means the video name
  is visible without unlocking. That was an explicit product call on 2026-09-17,
  reversing R14's "neither names the video". If it is ever revisited, the lever
  is `lapseReminderBody`, not the call site.
- **A tap reads the payload and nothing else, and the payload is untrusted.**
  The in-memory record may not have hydrated on a cold start, so
  `payload.ts` re-validates the version, the kind and the target,
  caps the serialized payload at 1024 BYTES (not characters), and falls back to
  Home for every shape it rejects. The cold tap then waits for the experience
  selection to settle, bounded by `LAPSE_REMINDER_TAP_DEADLINE_MS`: the
  experience shell swaps its element type when the stored slug resolves, which
  remounts the stack under any route pushed before it.
- **Adding the module moved the fingerprint runtime version, so a native build
  must ship before any `eas update`.** `apps/mobile/package.json` and
  `app.json` are both fingerprint inputs, and the plugin entry plus the new
  asset changed them. An OTA published before that build targets a runtime no
  installed app carries; `eas update` still exits 0 and reaches nobody. The
  production channel is already dark for the splash change, so this feature
  rides the same build.

## Cast SDK sheet theming

**Every cast sheet is drawn by the Cast SDK, not by us, and the only lever is
native.** `react-native-google-cast` exposes no styling API (its one
styling-adjacent prop is `CastButton`'s `tintColor`, which tints the glyph
only). `ios/` and `android/` are gitignored prebuild output, so both halves
ship as config plugins, and a change to either needs a **new native build** —
it moves the fingerprint runtime version, so an OTA update cannot deliver it.

- **iOS — `plugins/withCastUIStyle.js`.** Injects a `GCKUIStyle` block into
  `AppDelegate.swift`. Three facts, each of which cost a build to learn:
  - The block MUST sit **after** the vendor's
    `GCKCastContext.setSharedInstanceWith(options)`.
    `GCKUIStyle.sharedInstance()`'s `dispatch_once` reads
    `GCKCastContext.sharedInstance()`, which raises an uncatchable ObjC
    exception when the context is unset. The plugin is therefore listed
    **before** `react-native-google-cast` in `app.json` — AppDelegate mods run
    in reverse array order.
  - The block's begin marker carries a **content hash** of the emitted Swift, and
    a mismatch excises the old block before inserting. `expo prebuild` REUSES an
    existing `ios/` rather than recreating it, so a name-only sentinel made an
    edited block look already-applied and kept building the previous palette.
  - The trailing call is **`apply()`**, not the header's `applyStyle` — Swift
    renames the selector. Only a real compile catches this; the unit tests
    pinned the header spelling and stayed green while the build failed.
  - Colours only. `-[GCKUIStyle contentSizeDidChange:]` re-runs
    `initDefaultFonts`, so a custom font is wiped the first time the reader
    changes text size.
- **The `deviceChooser` subtree does NOT own the chooser's title or Cancel
  button.** `_styleAttributesForNavigation` is captured once in `viewDidLoad`
  from `connectionController` and `syncWithCastState` never reassigns it, so
  both sheets' nav bars come from
  `deviceControl.connectionController.navigation`.
- **A base pass sets every node, so any per-surface difference needs an
  explicit override after it.** The connected sheet's play/pause shipped at
  `TEXT_SECONDARY` — the same muted grey as a decorative row glyph — because
  only the base pass had touched it. Verified by sampling pixels, not by eye.
- **Not every cast surface is a sheet.** The expanded controls are a
  full-screen player (`BLACK`); the mini controller is a bar docked over
  content (`SURFACE_COLOR`); only the dialogs take `BG_COLOR`.
- **Android has no `GCKUIStyle`** — `plugins/withAndroidCastTheme.js` writes
  `mediaRouteTheme` + `cast*Style` items onto `AppTheme`, because every cast
  dialog resolves its theme from the **Activity**, not from the cast button's
  `ContextThemeWrapper`. Each new style MUST inherit its SDK parent
  (`Theme.MediaRouter*`, `CastExpandedController`, …); a bare parent drops
  every SDK default and nothing at runtime says so. `aapt2` is the authority —
  it fails on an unresolvable parent or a nonexistent attribute.
- **Every `react-native-google-cast` import stays under `src/lib/cast/`, with
  one allowlisted exception: `src/hooks/useCastPlayback.ts`.**
  `castImports.guard.test.js` fails the suite otherwise, and it carries TWO
  allowlists — `ALLOWED_PREFIX` for the directory and an `ALLOWED_FILES` set for
  that one file, pinned by its own positive control. The hook sits outside the
  directory because `useCastSession`, `useCastState`, `useMediaStatus` and
  `useStreamPosition` are React hooks, while `src/lib/cast/` holds pure logic.
  Add a file to `ALLOWED_FILES` only when the SDK hands you a React hook. The
  same rule is why `src/lib/cast/NativeCastButton.tsx` is a wrapper in that
  directory rather than a component folder.
- **The cast CONTROL differs by platform, and that is deliberate.**
  `showCastDialog()` is implemented differently on each side, so one shared
  affordance cannot serve both:
  - iOS calls `[GCKCastContext.sharedInstance presentCastDialog]` directly
    (`RNGCCastContext.m:78`), so the app-drawn `MaterialIcons "cast"` glyph in
    `PlayerControls` works, and keeps its `cast-connected` variant and its
    state-aware label ("Casting to <device>").
  - Android calls `RNGoogleCastButtonManager.getCurrent()` then
    `performClick()` (`RNGCCastContext.java:128`) — it can only click a native
    `MediaRouteButton` that is already attached, and that registry is filled
    only by `ColorableMediaRouteButton.onAttachedToWindow`. Android therefore
    renders the SDK's own button as the real control
    (`src/lib/cast/NativeCastButton.tsx`), inside the same `Frosted` backplate
    the AirPlay picker already uses.
    **Do not reintroduce a hidden button to feed that registry.** An earlier
    version mounted an invisible 1pt `<CastButton>` beside the visible glyph. It
    worked, but it left a gap between "a glyph is visible" and "a button is
    registered" — and that gap WAS the original Android bug: the glyph appeared
    whenever a receiver was discovered and did nothing at all, because nothing
    had ever mounted a native button. Using the native button as the control
    closes the gap by construction.
- **Android must NOT gate the control on `castUi.available`; iOS must.**
  What was MEASURED on a Galaxy Tab S8 (Android 16, 2026-08-24): both Chromecasts
  sat in the app's own `MediaRouter` route list for minutes while
  `getCastState()` still answered `noDevicesAvailable`; it read `notConnected`
  seconds after the chooser dialog was opened. That is enough to show the signal
  is not trustworthy on Android, which is all the fix needs.
  **The CAUSE is not established.** No counterfactual was run — a button
  attached but never tapped was never observed, so "attaching and using a button
  is what flips it" remains one hypothesis among several (discovery latency,
  foreground state, and a GMS-side cache all fit the same observation). Do not
  cite this as an SDK contract. iOS keeps the gate — its `presentCastDialog`
  needs no attached button, so its state is trustworthy there.
- **The SDK button never self-hides**, so the always-visible Android glyph is
  correct, not a leak. In mediarouter 1.8.0-beta01 `MediaRouteButton` has no
  visibility logic at all and `setAlwaysVisible(boolean)` is a no-op stub
  (`0: return` in its bytecode) — the old auto-hide behaviour is gone.
- **`tintColor` is the only styling lever on the SDK button.** The connected
  artwork is the SDK's, not `cast-connected`. Its accessibility label does reach
  the native view (`content-desc="Cast"`, verified 2026-08-21); whether the
  state-aware variant survives a live session is unverified.
- **These sheets follow the SYSTEM appearance, not the app's.** `app.json` sets
  `userInterfaceStyle: "automatic"` while every RN surface is hard-coded dark,
  so an unstyled sheet renders light on a light-mode phone. Setting every
  colour explicitly is what pins them dark; re-check in light mode after any
  change. **iOS verified 2026-08-21** (sheet band held at luminance 25/255 with
  the system in light appearance, iPhone 17 Pro Max simulator). **Android is NOT
  verified in light mode** — that half still rests on an argument, not a
  measurement: `values-night/` carries no cast resources, so the explicit hex
  wins in either mode.
- **The CLASSIC Android chooser is VERIFIED on hardware (Galaxy Tab S8,
  Android 16, 2026-08-24)** against two real Chromecasts, by sampling pixels:
  ground `#1c1917` (441,041 pixels MATCHED that value inside the panel), title
  and both route labels `#f5f5f4`, and **zero** pixels of stock `#303030`
  (`background_material_dark`), `#424242` (`background_floating_material_dark`)
  or `#d0021b` (the stock cast red). **The DYNAMIC chooser is still unverified
  and probably still unthemed** — see the text-appearance bullet below. The SDK
  `<CastButton>` does mount under RN 0.86 Fabric interop — `content-desc="Cast"`,
  `clickable=true` in `uiautomator dump`.
- **The dialog's GROUND is `android:windowBackground`, not
  `android:colorBackground`.** `ThemeOverlay.AppCompat.Dark` sets BOTH to
  `@color/background_material_dark` (`#303030`); the first version set only
  `colorBackground` and the measured ground stayed stock while our text colours
  landed. Overriding `windowBackground` costs no dialog inset or corner radius
  because the stock value is a flat colour, not `abc_dialog_material_background`.
- **An emulator cannot verify any of this** — multicast is mangled
  (`AOSP-MdnsDiscoveryManag: Error while decoding multicast packet`), so no
  receiver is ever discovered. Use a physical device on a real LAN.
- **`MediaRouter: onRestoreRoute()` in logcat is NOT evidence a button
  attached** — the lines repeat on a ~25s cadence (70 in one session), so they
  are `CastContext`'s own route loop, not a one-shot `onAttachedToWindow`. Prove
  attachment with `uiautomator dump` and look for `content-desc="Cast"`.
- **Discovery itself was never the problem.** GMS registers its own
  `MediaRouter` callback with `flags=4` and the provider binds without help:
  `MediaRouteProviderProxy … CastMediaRoute2ProviderService_Persistent` delivers
  the routes into the app's process. So `MediaTransferReceiver` and a custom
  discovery module are both unnecessary, and the `media transfer = false` line
  from `MediaRouterProxy` is a red herring. Enable
  `setprop log.tag.AxMediaRouter DEBUG` BEFORE process start (the tag is read in
  a static initializer) and read the `Route added:` lines.
- **Two Android theme levers are probably inert — confirmed from the AAR, not
  guessed.** `Theme.MediaRouter` has parent `ThemeOverlay.AppCompat.Dark`, so the
  dark parent choice is right. But it sets `mediaRouteBodyTextAppearance` and
  `mediaRouteHeaderTextAppearance` to `TextAppearance.MediaRouter.Dynamic.*`,
  which hardcode `android:textColor` to `#FFFFFF` (route rows) and `#BDC1C6`
  (header). A text appearance's own `textColor` beats the theme-level
  `android:textColorPrimary` / `android:textColorSecondary` this plugin sets, so
  on the dynamic dialog those two items do nothing. The result is still
  light-on-dark, just not through our tokens. To actually own it, override those
  two text-appearance attributes with styles carrying our colours. Which dialog
  variant appears (dynamic vs classic) depends on whether the receiver advertises
  dynamic groups — device-only. **Observed 2026-08-24: two ordinary Chromecasts
  produce the CLASSIC chooser** (`mr_chooser_dialog` — "Cast to" plus a
  `ListView`), where `android:textColorPrimary` DOES land: the labels measured
  `#f5f5f4`, our token, not the `#FFFFFF` the dynamic text appearance forces. So
  the inertness above is real but scoped to a variant we have not yet seen.
- **Verify by sampling pixels.** The stock cast red `#D0021B` and our `#CB333B`
  pass a glance and fail the design system. On iOS: `xcrun simctl io … screenshot`
  → `ffmpeg -pix_fmt rgb24` → read the bytes. The Android equivalent is
  `adb exec-out screencap -p` into the same ffmpeg step; it was exercised on the
  classic chooser on 2026-08-24. Note that iOS lifts button labels
  inside the nav pill and toolbar by a uniform ~+13 per channel (`#a8a29e`
  renders `#b6afaa`, `#e96067` renders `#f76d73`), so compare the _delta_
  across two differently-coloured buttons rather than expecting an exact hex.
- Cast discovery **does** work from the iOS simulator, but only after a few
  seconds — an absent cast glyph early in a session means "not discovered yet",
  not "unsupported".

## Raw file export — save to a folder the viewer picks

**The export writes into a folder the viewer chooses, never into the photo
library.** Product leadership decided this on 2026-09-15; the photo-library
destination that shipped in #2232 is retired and `expo-media-library` is gone
from the app. The picker is `Directory.pickDirectoryAsync()` from
`expo-file-system`, which the app already links, so the change added no native
module — but removing one moves the fingerprint runtime version, so a native
build must ship before the next `eas update`.

- **The seam is `src/lib/rawExportRuntime.ts`, and only it.** Every other
  export module is pure. The adapter's `ExportDestinationPort`
  (`pickFolder` / `listNames` / `copyInto` / `removeIfExists`) is bound there
  to `Directory` and `File`. `documentDirectory` still comes from `expo-file-system/legacy`: the
  package root re-exports it through a stub that throws.
- **Pick FIRST, then dismiss, then run.** The order lives in
  `src/lib/rawExportStart.ts`. Both routes (`app/watch/download.tsx`,
  `app/series/download.tsx`) hand it the pick, the dismiss and the start as
  callbacks on ONE object literal, so neither route body carries a step order
  of its own. A dismissed sheet has no view controller to present from, and
  both orders compile, so `rawExportStart.test.ts` pins the order by CALLING
  the helper. `rawExportWiring.guard.test.js` holds only that each raw starter
  delegates to `startRawExportAfterPick(` and never dismisses by hand — a
  position comparison there would read an object literal's declaration order,
  which means nothing. A dismissed picker starts nothing and reports nothing;
  the sheet stays open.
- **A series picks ONCE.** `SeriesExportRun.folder` threads one grant into
  every episode. Each episode still stages, copies and deletes one at a time,
  so R8's space arithmetic did not change.
- **The picker IS the consent.** There is no permission step, no refusal
  outcome, and no Settings action on the report card. A folder the app cannot
  write to fails at the copy, as `destinationWriteError`. No Info.plist key
  and no runtime prompt: the document picker is consent-per-action, and the
  app receives a security-scoped URL for the one folder picked, never the
  device's files.
- **The confirm button reads "Open", by decision (2026-09-16).** UIKit labels
  its folder picker that way and the title is not configurable. "Save" exists
  only in export mode, which needs a native module this app does not have;
  that is `feat-509`. Do not try to relabel it from JS — there is no lever.
- **A folder grant dies with the process.** `expo-file-system` opens the
  security scope on pick and never closes it (`FilePickingUtils.swift`), and
  ships no bookmark API, so a picked folder does not survive a relaunch.
  Every staged note is therefore DISCARDED by the launch sweep; the deferred
  write, the app-state gate and the foreground completion effect are all
  gone. Android's SAF grant is persistable, but the recovery model is
  deliberately uniform across platforms.
- **The saved file is named by RENAMING the staged source, never by joining a
  name onto the folder's uri.** Android's picker returns a SAF tree uri, and
  `DocumentFile.fromTreeUri` resolves any appended segment back to the tree's
  ROOT document — so `new File(new Directory(folder.uri), name)` is the folder
  itself, and `copy()` throws `InvalidTypeFileException` on a directory. Expo's
  SAF branch takes the child's name from the SOURCE file
  (`CopyMoveStrategy.SAF.prepareAsDestination` -> `findFile(source.fileName)`),
  so the runtime binding renames the staged file and then copies it into the
  `Directory`. One code path serves both platforms.
  **This is invisible to jest and to an iOS device run.** Every adapter test
  injects a fake port, and iOS joins paths happily. Only an Android device
  proves it. `rawExportWiring.guard.test.js` pins the rename and rejects the
  join shape.
- **A name collision takes a suffix, not an overwrite.** `suffixFileName` in
  `src/lib/transferPort.ts` finds `Name (2).mp4`, bounded to
  `RAW_EXPORT_MAX_FILENAME_LENGTH`. The free-name search reads the folder ONCE
  through `listNames`, because Android resolves no per-name `exists` probe
  against a SAF tree — a probe there answers for the folder, not the child.
- **A failed copy cleans up after itself at the DESTINATION.** `File.copy` is a
  plain non-atomic byte copy on both platforms, so an interrupted copy leaves a
  truncated file under the final name in the viewer's own folder. `copyToFolder`
  removes it best-effort in its catch. R18 is not satisfied by clearing the
  staging directory alone.
- **`signalBackgroundCompletion` fires AFTER the copy, not before it.** The
  signal releases the shared background-session handler, and iOS may suspend the
  process once it lands. Signalling first meant a download that finished in the
  background could copy ~165 MB with no background window.
- **Do not add `UIFileSharingEnabled` or `LSSupportsOpeningDocumentsInPlace`.**
  Either key would show the staging root in the Files app mid-transfer, and
  would offer the app's own container as a destination that dies with the
  app. `appJsonNoPhotoLibrary.guard.test.js` pins their absence alongside the
  absence of every photo permission.
- **The cancel rejects, with platform-divergent codes.** iOS throws
  `FilePickingCancelledException`, Android `PickerCancelledException`. The
  binding catches every rejection, logs the code to `raw_export.folder_not_picked`
  and returns null, rather than matching a code string a version bump could
  change.
- **Verification oracle:** after a save, list the picked folder through the
  `Directory` handle and assert the file is present at the byte size the sheet
  showed; then confirm in the Files app by hand. The old
  `PHPhotoLibrary … success: YES` log count no longer exists.

## Android system navigation bar

**`AppTheme` now has TWO writers**, and both go through the shared helpers in
`plugins/androidStyleXml.js` (`setItem`, `findStyle`, `getRequiredStyle`).
That module is the single place item-mutation semantics may live — two copies
can drift and then disagree about how items land on the one style React Native
reads, which no per-plugin suite would catch. Add a third writer the same way.

`plugins/withAndroidNavigationBar.js` makes the system navigation bar render
the app's own `#1c1917` instead of the platform contrast scrim.

- **You cannot set a colour.** RN forces `navigationBarColor` to transparent at
  every React Activity creation (`WindowUtil.kt`, `enableEdgeToEdge`). The only
  lever RN reads and obeys is `android:enforceNavigationBarContrast`. Setting it
  `false` stops the platform scrim AND stops RN overwriting the icon appearance
  from the SYSTEM dark-mode setting — which is why the paired
  `android:windowLightNavigationBar=false` survives. The two ship together.
- **Both `AppTheme` and `Theme.App.SplashScreen` are written.** MainActivity's
  manifest theme is the splash one, and it does not inherit `AppTheme`.
- **This plugin MUST stay before `expo-splash-screen` in `app.json`.** That
  plugin REPLACES `Theme.App.SplashScreen` rather than merging, and Expo runs
  mods last-registered-first. Reversed, the two items are wiped with the suite
  still green. A test pins the order against the real vendor mod.
- **Measured, not argued** (`adb exec-out screencap -p` -> ffmpeg -> read bytes):
  before, the bar was `#e9e8e8` in LIGHT system appearance on a Galaxy S20
  (API 33) — a near-white bar under a near-black app. After: `#1c1917` in both
  appearances, and `#1c1917` on the splash window too. API 31-32 unmeasured.
- **The scrim was doing a job.** It guaranteed button contrast over arbitrary
  content. That guarantee is now gone app-wide, so any surface drawing light
  pixels behind the bar (a bright fullscreen video frame) can hide the buttons.
  No replacement scrim ships yet.

## Tab bar — UIKit's own bar on iOS, a flush JS bar on Android

`src/lib/tabBar.ts` owns every number. Both navigators, the Library screen, the
mini player and six scroll surfaces read it from there, so no two files can
disagree about the bar's size.

> **The native tabs migration shipped on 2026-09-14** (feat-500). iOS now runs
> UIKit's own tab bar. Read the Results section of
> `docs/roadmap/platform/feat-500-mobile-native-tabs-migration.md` for the
> device measurements and the carried-forward items. The iOS floating pill,
> `TabBarLens.tsx` and `tabIndexForSegments` are deleted. Their rules are
> history, not current guidance — with ONE exception that is live again. The
> group-marker rule survives as `isTabGroupRoute` in `src/lib/tabBar.ts`:
> `app/watch/[slug].tsx` is a root-stack sibling and emits the bare segment
> `watch`, which is also the Discover tab's name, so "am I on a tab route" must
> key off `(tabs)` and never a tab name.

- **A ROOT-mounted surface does not get the bar in its inset, and must clear it
  from the SCREEN bottom.** A tab SCREEN's `insets.bottom` contains the bar; the
  root `SafeAreaProvider` does not, because the bar belongs to the tab
  controller the root sits outside of. Do NOT derive the lift from the inset:
  the iOS 26 bar is a floating pill anchored to the bottom EDGE, so its top sits
  a constant 83pt above the screen bottom whatever the inset is. Measured
  2026-09-14 — iPhone 17 and 17 Pro Max (inset 34) and iPhone SE 3rd gen
  (inset 0) all report a bar frame 83pt tall. Use
  `TAB_BAR_SCREEN_EXTENT_IOS`, not `insets.bottom + TAB_BAR_HEIGHT_IOS`; the two
  agree only at inset 34, which is why a 34pt device cannot catch the mistake.
  The export toast sat 21pt inside the bar on a 0-inset device, and its first
  fix still sat 6pt inside, until this was measured.

- **`PlaybackHost`'s `TAB_BAR_CONTENT_HEIGHT` has the same unfixed shape.** It
  is `TAB_BAR_OCCUPIED_HEIGHT` (49), reserved by the root-mounted mini player,
  so on a 0-inset device the window reserves 49 against an 83pt bar. Not
  investigated on device; do not copy the pattern.

- **A tab screen's `insets.bottom` ALREADY contains the iOS bar.** Know this
  before you touch a scroll surface. `useTabBarClearance()` returns
  `insets.bottom + TAB_BAR_CLEARANCE_GAP` on iOS, and `0` on Android, where the
  bar displaces content instead of drawing over it. It must NOT add
  `TAB_BAR_HEIGHT_IOS` again: UIKit reports the bar as part of the safe area,
  and a tab screen measures `insets.bottom` 83 = a 34pt home indicator + the
  49pt bar, on iOS 18.6 and 26.5 alike. `tabBar.test.ts` holds that exact
  falsification, because the doubled formula is what a careless revert restores.
- **`TAB_BAR_HEIGHT_IOS` is 49 — the real UIKit bar, not a design number.** The
  mini player reserves `TAB_BAR_OCCUPIED_HEIGHT` (49 on iOS, 56 on Android)
  rather than the inset, because it lives in the ROOT provider, outside the tab
  controller, and cannot read the per-tab safe area. `TAB_BAR_OCCUPIED_HEIGHT`
  resolves the platform once at import, which no test can reach; pin the
  branches through `tabBarOccupiedHeightFor(platform)` beside it.
- **iOS renders `app/(tabs)/_layout.ios.tsx`.** It uses `NativeTabs` from
  `expo-router/unstable-native-tabs`, which is a real `UITabBarController`. It
  builds one trigger per name in `TAB_ROUTE_NAMES`, and it sets
  `disableAutomaticContentInsets` on each one. UIKit's automatic inset only
  reaches a scroll view that is first in the subview chain, and no tab screen
  has one there — on Home that position holds the horizontal hero pager — so
  the screens pad themselves through `useTabBarClearance()` instead.
- **`app/(tabs)/_layout.tsx` MUST stay on disk.** It now serves Android only.
  Do not delete it: expo-router resolves the platform sibling by specificity,
  and it throws without an extension-less fallback file.
- **The Library screen hides the iOS bar through a module store.** `NativeTabs`
  has no per-screen `tabBarStyle`, and its only hide lever is the
  navigator-level `hidden` prop. A context cannot carry the flag, because the
  layout renders the screen and is therefore an ANCESTOR, not a descendant. So
  the flag lives in `src/lib/tabBarVisibility.ts`. Call `setTabBarHidden(true)`
  to hide it, and `resetTabBarHidden()` on blur and on unmount, or a tab switch
  strands the bar hidden. Android keeps its own lever,
  `navigation.setOptions({ tabBarStyle })`.
- **The hide removes the 49pt bar from `insets.bottom`, one frame later.** Two
  places add it back by hand, and neither may trust the raw inset during that
  frame. `SelectionActionBar` clamps it — `insets.bottom >= TAB_BAR_HEIGHT_IOS`
  gives `insets.bottom - TAB_BAR_HEIGHT_IOS`, anything smaller passes through —
  so the home indicator reads 34 from both 83 and 34, and 0 from 49 on a
  home-button device. `library.tsx` pads its list by `TAB_BAR_HEIGHT_IOS + 24`
  while selection runs.
- **`TabBarBackground` survives, but `SelectionActionBar` is its only
  consumer.** The navigator dropped it: UIKit draws its own material. The action
  bar stands in the same place over the same content, so the measured tint floor
  still applies there. `TAB_BAR_MATERIAL_TINT` is `rgba(0,0,0,0.3)`. Untinted, a
  bright Home backdrop drops the idle labels to 3.35:1, under the 4.5:1 AA
  floor. **A tint on the material is not the same problem as a tint over bare
  content:** the material has already darkened the ground, so contrast rises
  monotonically with alpha and there is no bad middle value to avoid. 0.26 is
  the computed minimum; 0.30 ships. The plan's original floor of 0.78 came from
  a sweep over a bare white backdrop, which crosses the label's own luminance
  and invents both the bad middle and a 3x-too-high minimum — see
  `docs/solutions/best-practices/contrast-floor-must-be-derived-over-the-real-compositing-stack.md`.
- **iOS 18 honours the appearance props; iOS 26 ignores them.**
  `backgroundColor`, `blurEffect`, `iconColor` and `labelStyle` land exactly on
  iOS 18.6 — the bar measured the app's own three colours byte-exact — while
  iOS 26 draws Liquid Glass and keeps UIKit's near-white idle tint. Do not fight
  it. `disableTransparentOnScrollEdge` is load-bearing on 18: without it the bar
  turns transparent wherever content reaches its bottom edge.
- **iPadOS 26 puts the bar at the TOP, and `sidebarAdaptable={false}` does not
  move it.** That option maps to `tabBarControllerMode: 'tabBar'` and changed
  nothing across a cold relaunch. feat-500 accepted the top bar. A size-class
  branch that keeps the JS bar on iPad is the follow-up if the owner wants one.
- **`<NativeTabs hidden>` is verified on iOS 26 only.** The iOS 16.4-17 branch
  takes `tabBar.hidden` rather than `setTabBarHidden:animated:`, and that
  runtime is not installed on this machine.
- **Android's `tabBarStyle` is applied AFTER the bar's own `backgroundColor`**
  (`BottomTabBar.js:220` sets it, `:258` appends yours). Keep `#1c1917` in
  `TAB_BAR_FLAT_STYLE`, and change the fill there rather than anywhere else.
- **Android must not be given a `tabBarBackground` option at all.** The bar
  checks the returned ELEMENT, not what it renders, so a wrapper returning
  `<TabBarBackground />` is non-null on every platform and forces the bar's own
  fill transparent. `app/(tabs)/_layout.tsx` passes the option on no platform,
  which keeps Android's opacity on two independent mechanisms rather than on
  `TAB_BAR_FLAT_STYLE.backgroundColor` alone. `tabBarLayout.test.tsx` pins the
  absence.
- **`@react-navigation/bottom-tabs` does not resolve from this app.** Android
  runs expo-router's vendored fork. Import `useBottomTabBarHeight` from
  `expo-router/js-tabs`; the obvious import passes `tsc` and fails in Metro. No
  file needs it today.
- **The ACTIVE label still fails AA and no tint can fix it.** `#CB333B` on the
  app ground is 3.39:1, and it sits at a middling luminance, so it fails against
  dark and light grounds alike. Only a colour change fixes it, and both
  navigators share the value. Untouched deliberately.
- **`tabBarLayout.test.tsx` pins BOTH navigators.** It mocks
  `expo-router/unstable-native-tabs` as well as `expo-router`, because
  `NativeTabs` does not come from the root module. jest-expo runs the `ios`
  platform, so it loads the Android layout through a `require` with the explicit
  `.tsx` extension — an extension-less import resolves to the `.ios` sibling,
  and every Android assertion then tests the wrong navigator.
- **`tabBarLensOrder.guard.test.js` keeps its old name and still does a job.**
  It pins `TAB_ROUTE_NAMES` against the group's route FILES, because expo-router
  appends an undeclared `app/(tabs)/*` file as a fifth tab, which a scan of
  either layout cannot see. It reads the `<Tabs.Screen>` order from
  `_layout.tsx`; the iOS trigger order comes from `TAB_ROUTE_NAMES` itself and
  `tabBarLayout.test.tsx` pins that.
- **No test can see the RENDERED material.** Every render suite mocks
  `GlassView` and `PlatformBlur` to `() => null`, so only a simulator proves the
  frosting. The branch selection and props ARE covered — see
  `TabBarBackground.test.tsx` — and `tabBar.test.ts` computes the composited
  WCAG ratio from the tint's full `rgba()` -- colour AND alpha, since
  compositing a hard-coded black scored a WHITE tint 4.79:1 while it measures
  1.52:1 -- so changing `TAB_BAR_MATERIAL_TINT` either way now fails a test.
  `tabBarClearance.guard.test.js` is an ENUMERATION of six surfaces, not a
  sweep — a seventh scroller escapes it silently. Add a row whenever you add
  one. It checks the clearance is APPLIED, not merely imported, and it strips
  `scrollIndicatorInsets` first -- that prop contains `bottom: tabBarClearance`
  and satisfied the naive pattern on its own.
- **`tabBarSingleSource.guard.test.js` holds the one-source claim.** It strips
  comments before matching -- LEADING and TRAILING, because a trailing
  `// from "../../lib/tabBar"` beside a hand-copied number is a live revert --
  and it compares the assigned token rather than using a lookahead, whose
  `\s*` can match zero characters and slip past the value it was told to
  reject.
- **A fade is not available on the material.** `GlassView` renders nothing
  inside a layer whose opacity an ancestor animates, so any fade of
  `TabBarBackground` forces `PlatformBlur` on every iOS version and changes the
  look.
- **Fast Refresh does not reliably apply changes to the material.** A branch
  swap looked applied and measured identically to the previous run; a magenta
  probe proved the old code was still live. Terminate and relaunch the dev
  client, and prove the reload landed with an unmistakable colour before
  trusting any measurement.

## Component render tests

Component render tests use the in-file react re-point pattern — see
`src/components/profile/__tests__/AccountSection.test.tsx`. The app's
tsconfig maps `react` to its `.d.ts`, and jest-expo mirrors tsconfig paths
into jest's `moduleNameMapper`, so each render suite re-points `react` and
`react/jsx-runtime` at the real package via `jest.mock`. No new test
dependencies are needed; the renderer is jest-expo's own transitive
react-test-renderer.

Since SDK 57, the package.json jest config ALSO pins `^react$` and the two
jsx runtimes globally in `moduleNameMapper` (load-bearing: 104/108 suites
fail without them — jest-expo's tsconfig mirror otherwise sends `react` to
`@types/react`). The per-suite `jest.mock` re-points remain valid and take
precedence for the suites that use them.
