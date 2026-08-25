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
config resolves via `resolveWatchHomeModel` (fallback emits one structured
`[WatchHome] fallback reason=…` log — never silent, incl. `topup-error`); the v3
snapshot persists config + `hydrationVideos` separately for instant cold launch. `buildWatchHomeModelFromVideos` → `HomeScreen`
(three-layer hero pager / shelves / overlay); hero streams resolve lazily per
slide via `useHeroStream`. Experiences still render via the SDUI pipeline below,
hosted at `/experience/[slug]`.

### SDUI Pipeline

```
Admin GraphQL → gql.tada typed query → dispatcher → renderers
```

- **Query**: Defined in `src/lib/queries.ts` using `adminGraphql()` from `@forge/admin-graphql`
- **Fragments**: Shared `AdminWatchExperienceFragment` from `@forge/admin-graphql/fragments` composes all block fragments
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
- ScrollView gesture preemption: interactive hero elements need `pointerEvents="box-none"` pass-through.
- Lazy Apollo Client init: never module-scope. Use `getApolloClient()` getter.
- `contentParagraphs` is `string[]` (JSON field) — validate with `Array.isArray()`.
- `Math.round()` all scaled font sizes on Android (sub-pixel = blurry).
- Admin blocks use flat `videoId` — no nested `video { slug, images }` join. Use block-level `imageUrl`/`mediaUrl` for thumbnails, `deriveMuxThumbnailUrl()` for VideoHero poster.
- **`replaceAsync` settles when the source is SET, not LOADED** (on Android it is aliased to `replace`), so anything written in its `.then()` runs while the player still holds the OUTGOING item. A `currentTime` write there is silently discarded; a `play()` is the mild form. Resume and seek on `sourceLoad`, and scope the listener to the source that requested it — the app shares ONE player, so another surface's load will otherwise take your seek. Codified in `src/hooks/useAutostartPlayback.ts` and `src/lib/recoverPlayback.ts`; the tvOS route to the same premise is `docs/solutions/integration-issues/expo-video-replaceasync-seek-silently-dropped-tvos.md`. The shared jest double reproduces the real settle-before-load order, so this is testable.
- Gating chrome — or any recovery affordance — behind a load: enumerate every path that fails to release the gate. "Playback started OR the player errored" misses "neither": backgrounding mid-load, and a source that wedges without ever erroring. Both leave the viewer with no controls and no way out, and neither logs anything. Always pair such a gate with an unconditional time-based release, and gate the tap target with the same predicate as the chrome it hides. See `docs/solutions/logic-errors/mobile-watch-autostart-veil-gate-missing-release-path.md`.
- iOS 26 makes the stack back-swipe FULL-WIDTH by default (react-native-screens turns it on when `fullScreenSwipeEnabled` is unset), and a JS PanResponder can never outrace it: the native recognizer claims the touch at delivery, before JS runs. So a rightward scrub on the seek bar IS the pop gesture. **Split the screen instead of racing it.** The watch/series routes confine the pop to a 24pt left strip via `gestureResponseDistance`, and the Scrubber DECLINES touches that start inside that strip (`mayStartScrub` in `src/lib/scrubber.ts`, on BOTH responder gates). One constant feeds both halves (`src/lib/backSwipe.ts`) so they cannot disagree. `fullScreenGestureEnabled: false` is the wrong tool — it kills ALL back-swipe on iOS 26, because no legacy edge recognizer fires.
- **Do not gate the back-swipe on chrome visibility.** An earlier fix held `gestureEnabled` false while the player chrome was mounted. `shouldArmHideTimer` never arms while paused or ended, so the chrome never auto-hides in those states and the hold never released: pausing a video killed the edge back-swipe for the screen's whole life. Only fullscreen may disable the gesture. Every `gestureEnabled` write must still land on BOTH the screen and its parent stack — the pop that dismisses a nested route belongs to the ROOT stack, which consults only its own top screen. `app/__tests__/backSwipeGesture.guard.test.js` pins the layout options AND the edge width; `useFullscreenPresentation.test.tsx` pins that the gesture stays enabled outside fullscreen.
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
`app/series/_layout.tsx`) and two sheets that are component state, counted by
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
- **Every `react-native-google-cast` import stays under `src/lib/cast/`** —
  `castImports.guard.test.js` fails the suite otherwise. That is why the hidden
  button below is a wrapper in that directory rather than a component folder.
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
