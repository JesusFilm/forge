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
- Composite React keys: `key={\`${item.__typename}-${index}\`}` or content-derived keys.
- Admin's `name: JSON` fields are locale maps — use `pickLocalizedName()` from `src/lib/pickLocalizedName.ts`.

## Running on a simulator (env setup)

**Before launching apps/mobile on a simulator, ALWAYS run
`bash scripts/setup-sim-env.sh mobile` first.** Fresh git worktrees don't
inherit `.env.local` (gitignored), so `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` (the
`WatchSearch`-scoped consumer bearer) is absent and search silently falls back
to the shared anonymous rate-limit bucket until it's seeded.

The script is idempotent: it seeds `apps/mobile/.env.local` from the main
checkout with the search token. It's a shortcut — the canonical way to populate
the full env (and the fallback on a fresh solo clone with no other checkout) is
`pnpm --filter @forge/mobile fetch-secrets` (Doppler `forge-mobile`). Run either
BEFORE `expo start` — Expo inlines `EXPO_PUBLIC_*` at bundler startup, so a
change made after boot needs a Metro restart to take effect.

## Common Pitfalls

- Android VideoView z-order: renders on top of all RN Views. Place video BEHIND scroll content.
- ScrollView gesture preemption: interactive hero elements need `pointerEvents="box-none"` pass-through.
- Lazy Apollo Client init: never module-scope. Use `getApolloClient()` getter.
- `contentParagraphs` is `string[]` (JSON field) — validate with `Array.isArray()`.
- `Math.round()` all scaled font sizes on Android (sub-pixel = blurry).
- Admin blocks use flat `videoId` — no nested `video { slug, images }` join. Use block-level `imageUrl`/`mediaUrl` for thumbnails, `deriveMuxThumbnailUrl()` for VideoHero poster.
- Search requires `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` (mobile's OWN dedicated fleet key — its own entry in admin's `FLEET_ADMIN_API_KEYS` CSV, NOT `WEB_ADMIN_API_KEYS`, and never the same value as TV's; provision in EAS Environments per profile, `.env.local` for dev). `watchSearch` is a PUBLIC resolver, so the bearer buys a per-device rate-limit bucket, not access; a missing/rotated key degrades to the shared `public:<ip>` bucket rather than an `UNAUTHENTICATED` error. The bearer rides ONLY on the `WatchSearch` operation — never attach it to public queries, or every public query also spends the fleet key's rate-limit budget. Admin buckets a fleet key per device (`consumer:<key>:v:<viewer_id>` from the `x-viewer-id` header, else `consumer:<key>:<ip>`), so the fleet doesn't collapse into one bucket. See `src/lib/authHeaders.ts`.
