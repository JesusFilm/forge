# apps/mobile — Expo Watch App

## Stack

- React Native with Expo (SDK 54, managed workflow)
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
- **One expo-video lifecycle adapter**: player creation goes through `useManagedVideoPlayer` (frozen source, replaceAsync swap, AppState pause/resume) — a jest guard forbids raw `useVideoPlayer(` outside it plus a two-file allowlist (`HomeHeroPager`'s bespoke swap engine, `VideoHeroRenderer`).
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
  supported by Expo SDK 54's `withIosIcons`. Layers stay FLAT — iOS 26 applies the
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
- Search requires `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` (mobile's OWN dedicated fleet key — its own entry in admin's `FLEET_ADMIN_API_KEYS` CSV, NOT `WEB_ADMIN_API_KEYS`, and never the same value as TV's; provision in EAS Environments per profile, `.env.local` for dev). `watchSearch` is a PUBLIC resolver, so the bearer buys a per-device rate-limit bucket, not access; a missing/rotated key degrades to the shared `public:<ip>` bucket rather than an `UNAUTHENTICATED` error. The bearer rides ONLY on the `WatchSearch` operation — never attach it to public queries, or every public query also spends the fleet key's rate-limit budget. Admin buckets a fleet key per device (`consumer:<key>:v:<viewer_id>` from the `x-viewer-id` header, else `consumer:<key>:<ip>`), so the fleet doesn't collapse into one bucket. See `src/lib/authHeaders.ts`.

## Auth + watch progress (feat: mobile login & continue watching)

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
  pause/background/unmount/end. Progress is signed-in ONLY (R10): sign-out
  empties store, snapshot, and queue via `attachProgressLifecycle`.
- **Bars**: one `WatchProgressBar` (store-subscribed by videoId, <1% hidden,
  ≥90% snaps full) on every card surface EXCEPT the Library downloads row
  (deferred — the row stores only a slug). Fold progress into
  `accessibilityLabel` via `progressAccessibilityText`.
- **RUM identity**: `setDatadogRumUser` receives the opaque auth subject id
  only — never email or display name.
