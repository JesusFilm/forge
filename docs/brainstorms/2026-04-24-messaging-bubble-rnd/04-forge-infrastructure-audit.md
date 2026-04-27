# Forge Infrastructure Audit — Messaging Bubble Moment Feature

**Date:** 2026-04-24
**Author:** R&D repo audit agent
**Scope:** Evaluate what infrastructure exists today in the forge monorepo to support a "Moment" (short vertical MP4 clip) shareable from the mobile app into native messaging apps, with an optional short URL that escalates to the web Experience.

All paths below are repo-relative (e.g., `apps/mobile/src/...`).

---

## 1. Mux Video Pipeline

### Current state

Mux is used today as the **playback** layer only. Clip, trim, and segment generation are **not implemented anywhere**.

- **Content type:** `apps/cms/src/api/mux-video/content-types/mux-video/schema.json` — schema-only; no controllers/services/routes in the CMS app. The Mux Video collection stores: `coreId` (required, unique), `assetId`, `playbackId`, `duration` (integer), `readyToStream`, `downloadable`, `primaryLanguageId`, `source` ("core" or "manager"). It has a `variants` `oneToMany` relation to `api::video-variant.video-variant` via `mappedBy: "muxVideo"`.

- **Mux SDK usage lives in `apps/manager/`, not in CMS or web/mobile.** `@mux/mux-node ^9.0.0` is declared in `apps/manager/package.json:20`. Environment variables `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, and optional `MUX_SIGNING_KEY`/`MUX_PRIVATE_KEY` are validated in `apps/manager/src/config/env.ts`. The manager is the only app holding Mux API credentials today.

- **Primary Mux service:** `apps/manager/src/services/mux.ts`. Endpoints called today:
  - `getMux().video.assets.create(...)` — `createMuxAsset()` at line 309
  - `getMux().video.assets.retrieve(...)` — `getMuxAsset()` at line 327 and `listMuxSubtitleTracks()` at line 172
  - `getMux().video.assets.generateSubtitles(...)` — `ensureGeneratedSubtitlesForAsset()` at line 267
  - `getMux().jwt.signPlaybackId(...)` — signed playback for text tracks in `buildMuxTextTrackUrl()` at line 159
  - Helpers (URL builders, no API call): `getPlaybackUrl(playbackId)` → `https://stream.mux.com/{id}.m3u8` at line 341; `getThumbnailUrl(playbackId, {width, time})` → `https://image.mux.com/{id}/thumbnail.webp` at line 345; `getSceneThumbnailUrls()` at line 361.

- **No Mux clip creation code exists.** Greps for `createClip`, `Mux.Clip`, `clip_from`, `assets.create.*input_settings` returned zero hits across `apps/` and `packages/`. The `mux.ts` service does NOT call any trim/clip endpoint — `buildMuxAssetCreateParams()` at line 278 only constructs `input: [{ url, generated_subtitles }]` with no `start_time`/`end_time` fields.

- **`mux_videos.duration` is always 0 confirmed.** The `video_variants.duration` column is the authoritative duration. Verified in schema — `apps/cms/src/api/video-variant/content-types/video-variant/schema.json:23` shows `duration: integer` and `lengthInMilliseconds: biginteger`. Raw SQL references in `apps/cms/src/api/backfill-queue/services/backfill-queue.ts:58-65` and `apps/cms/src/api/scene-embedding/services/recommender.ts:95-98` all JOIN through `video_variants` to read duration. Admin `prisma/schema.prisma:438` comment explicitly says "`mux_videos.duration` field in the legacy CMS is [always 0]".

- **Asset ingest path (manager):** `buildMuxAssetCreateParams()` always sets `playback_policy: ["public"]` — manager-created assets are public-playback, which means thumbnail and stream URLs work without signed JWTs. Comment on line 301-303: "Manager-created assets need a public playback ID because the workflow fetches generated VTT files directly".

### Relevant quotes

`apps/manager/src/services/mux.ts:278-307`:

```ts
export function buildMuxAssetCreateParams(
  options: CreateAssetOptions,
): Mux.Video.AssetCreateParams {
  const subtitleLanguageCode = normalizeGeneratedSubtitleLanguage(
    options.subtitleLanguageCode,
  )
  const input: Mux.Video.AssetCreateParams.Input[] = [
    {
      url: options.inputUrl,
      ...(options.generateSubtitles && {
        generated_subtitles: [
          /* ... */
        ],
      }),
    },
  ]
  return {
    input,
    playback_policy: ["public"],
    passthrough: options.passthrough,
  }
}
```

### Gaps

- No existing code creates a Mux clip (`input[].start_time` / `input[].end_time`) or a Mux download master rendition.
- No code downloads MP4 segments or uses HLS-based clipping.
- The CMS does not know about "clip" or "moment" as an entity.
- Mux tokens are only on `apps/manager` — any new Mux-invoking service would need its own credentials configured.

---

## 2. Video Metadata

### Current state

Per-video metadata is rich and structured across five related content types.

- **`api::video.video`** (`apps/cms/src/api/video/content-types/video/schema.json`): localized `title`, `description`, `snippet`, `imageAlt`; `label` enum (collection/episode/featureFilm/segment/series/shortFilm/trailer/behindTheScenes); `videoSource` enum (internal/youTube/cloudflare/mux); `locked`, `noIndex`. Relations: `variants` (oneToMany), `subtitles` (oneToMany), `studyQuestions`, `keywords`, `images`, `bibleCitations`, `primaryLanguage`, `origin`.

- **`api::video-variant.video-variant`** (`apps/cms/src/api/video-variant/content-types/video-variant/schema.json`): per-language variant carrying `duration` (int), `lengthInMilliseconds` (biginteger), `hls` URL, `dash` URL, `share` URL (free-text, NOT a messaging-share URL), `downloadable` boolean, relations to `language`, `muxVideo`, `asset` (cloudflare-r2), `video`, `downloads`, `videoEdition`.

- **`api::video-subtitle.video-subtitle`** (`apps/cms/src/api/video-subtitle/content-types/video-subtitle/schema.json`): `primary`, `vttSrc`, `srtSrc`, `vttVersion`, `srtVersion`, `value`, `edition`, relations to `language`, `videoEdition`, `vttAsset`, `srtAsset`, `video`.

- **`api::video-image.video-image`** (`apps/cms/src/api/video-image/content-types/video-image/schema.json`): multi-format thumbnails: `url`, `mobileCinematicHigh`, `mobileCinematicLow`, `mobileCinematicVeryLow`, `thumbnail`, `videoStill`, `blurhash`.

- **`api::language.language`** (`apps/cms/src/api/language/content-types/language/schema.json`): carries BCP-47 (`bcp47` field). Note from root `CLAUDE.md`: DB column is `bcp_47` (snake-cased by Strapi v5).

- **Mobile already fetches thumbnails via GraphQL** at `apps/mobile/src/lib/queries.ts:22-32` (VideoHeroFragment), 182-189 (MediaCollection items), 208-216 (VideoCarousel items).

### Subtitle fetchability for burn-in

- `vttSrc` and `srtSrc` are public URLs when set.
- Mux-generated subtitles at `https://stream.mux.com/{playbackId}/text/{trackId}.vtt` (public policy) or signed. `listMuxSubtitleTracks()` in `apps/manager/src/services/mux.ts:169` resolves these.

### Gaps

- No scene-level timecode metadata is exposed to the mobile client in its current query (`GET_WATCH_EXPERIENCE`). Scene embeddings (`scene_embeddings` table) have `start_seconds`/`end_seconds`/`playback_id` per `apps/cms/src/bootstrap/ensure-pgvector.ts:52-60` but the video block only gives `streamingUrl`, not a scene range.
- No "keyframes" / "poster offsets" metadata in any schema.

---

## 3. Experience SDUI

### Current state

Dynamic-zone `blocks` on Experience declare all section types, with **five** that carry shareable video content.

From `apps/cms/src/api/experience/content-types/experience/schema.json:104-123`, the `blocks` dynamicZone lists:

```
sections.media-collection, sections.promo-banner, sections.info-blocks,
sections.cta, sections.video-hero, sections.container, sections.text,
sections.section, sections.related-questions, sections.bible-quotes-carousel,
sections.card, sections.easter-dates, sections.advent-countdown,
sections.video, sections.video-carousel, sections.navigation-carousel
```

### Block types with shareable video (where a Moment could be generated)

| Block                          | File                                                                      | Video field shape                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `sections.video-hero`          | `apps/cms/src/components/sections/video-hero.json`                        | `useRouteVideo: bool`, `video: relation(video)`, `streamingUrl: string` (Mux HLS URL), `heading`, `subheading`, `ctaLink`, `ctaLabel` |
| `sections.video`               | `apps/cms/src/components/sections/video.json`                             | `useRouteVideo`, `video: relation(video)`, `streamingUrl`, `media: image`, `title`, `subtitle`                                        |
| `sections.video-carousel`      | `apps/cms/src/components/sections/video-carousel.json` (carousel wrapper) | `items: repeatable sections.video-carousel-item`                                                                                      |
| `sections.video-carousel-item` | `apps/cms/src/components/sections/video-carousel-item.json`               | `video: relation(video)`, `streamingUrl: required string`, `imageUrl`, `titleOverride`, `backgroundColor`                             |
| `sections.media-collection`    | `apps/cms/src/components/sections/media-collection.json`                  | `items: repeatable sections.media-collection-item` with `video: relation(video)`, `imageUrl`, `imageOverride`, overrides              |

Non-video blocks: `text`, `cta`, `promo-banner`, `info-blocks`, `bible-quotes-carousel` (contains quote images, not video), `related-questions`, `navigation-carousel` (nav tiles), `easter-dates`, `advent-countdown`, `quiz-button`, `card`, `container`, `section`.

### Experience → Video relationship in GraphQL

Defined in `apps/mobile/src/lib/queries.ts`:

- `VideoHeroFragment` (line 13) projects `video { documentId, title, slug, images { url, mobileCinematicHigh, videoStill } }` + top-level `streamingUrl`.
- `VideoSectionFragment` (line 117) same shape + `media`, `videoRef` alias.
- `VideoCarouselFragment` (line 193) and `MediaCollectionFragment` (line 157) project `items[]` with the same `video { documentId, title, slug, images {...} }` projection + per-item `streamingUrl` or `imageUrl`.
- `SEMANTIC_SEARCH` query (line 448) already returns `playbackId` and `startSeconds` per result — the existing path from search service back to a renderable Mux ID.
- **`playbackId` is NOT currently projected on Experience blocks** — the mobile client reads `streamingUrl` (HLS) only, not the raw playback ID needed for Mux image/thumbnail endpoints.

### Relevant quote

`apps/mobile/src/lib/queries.ts:448-476` (SEMANTIC_SEARCH):

```ts
semanticSearch(query, locale, limit, offset) {
  query
  hasMore
  results {
    type
    id
    slug
    title
    imageUrl
    snippet
    startSeconds
    playbackId    // <-- only surface where playbackId flows to mobile
    score
  }
}
```

### Gaps

- No GraphQL field exposing `variant.muxVideo.playbackId` on an Experience video block today. A mobile-side "cut a Moment from this block" needs either:
  1. A new query to fetch `video.variants[].muxVideo.playbackId` filtered by user's locale, OR
  2. A new GraphQL fragment on `ComponentSectionsVideoHero` / `ComponentSectionsVideo` that joins to the active variant's `muxVideo`.
- The `streamingUrl` on section blocks is a fully-formed HLS URL (`https://stream.mux.com/{id}.m3u8`). The playback ID can be parsed from it (see `apps/tv/src/lib/resolveImageUrl.ts:8-13` which already does this), but that's brittle.

---

## 4. Mobile Share Plumbing (Current State)

### Current state — partial / not wired for Moment use case

- **`expo-sharing` is NOT installed.** Confirmed by reading `apps/mobile/package.json`. Only `expo-linking`, `expo-blur`, `expo-image`, `expo-linear-gradient`, `expo-router`, `expo-video`, etc.
- **`react-native-share` is NOT installed.** Confirmed.
- **React Native built-in `Share.share(...)` IS used in exactly one place:** `apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx:205-214`:

```ts
const handleShare = useCallback(async () => {
  try {
    await Share.share({
      message: "Check out the JesusFilm app!\nhttps://www.jesusfilm.org/watch",
    })
  } catch {
    // User dismissed or share unavailable
  }
}, [])
```

This hardcoded-message share is the only existing share UI in the mobile app. It shares text only — no image, no attached video file. Android `Share.share` can carry a URL and text in `message`, iOS carries them as separate `url`/`message` fields.

- **`Linking.openURL(...)` is used in two places for outbound CTA links only:**
  - `apps/mobile/src/components/sections/RelatedQuestionsRenderer.tsx:89`
  - `apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx:113`

- **URL scheme:** `apps/mobile/app.json:8` sets `"scheme": "forgemobile"`. No `associatedDomains` (iOS universal links) and no `intentFilters` (Android App Links) declared. `infoPlist` has only `ITSAppUsesNonExemptEncryption: false` and `NSAppTransportSecurity.NSAllowsLocalNetworking: true`.
- **Universal links are NOT configured.** No `.well-known` directory in `apps/web/public/` (confirmed by directory list). No `apple-app-site-association`, no `assetlinks.json`.
- **No inbound deep-link parser** (`expo-linking`'s `createURL`/`parseURL`/`useURL` — none used). `expo-linking` is imported only as a dependency; unused at runtime.

### Verdict

Nothing exists for the Moment share flow. The mobile app has one hardcoded text-share button and no video/image share capability. Universal links and App Links are completely un-configured. To ship any Moment prototype, these must be added from scratch.

---

## 5. Web App Routing + Metadata

### Current state

- **Experience route exists:** `apps/web/src/app/[slug]/[locale]/page.tsx` uses `generateMetadata` that calls `getWatchPageMetadata(locale, { slug, pathLocale, pathPrefix: "watch" })`. Also has a fallback route `apps/web/src/app/[slug]/page.tsx`.
- **`basePath: "/watch"`** is set in `apps/web/next.config.mjs:11`. So URLs are `https://www.jesusfilm.org/watch/{slug}/{locale}`.
- **No `/share/*`, `/m/*`, `/clip/*`, `/watch-moment/*` routes exist.** Confirmed by file listing of `apps/web/src/app/`. Only: `[slug]`, `api`, `demo-recommendations`, `demo-search`, `search`, `globals.css`, `layout.tsx`, `loading.tsx`, `page.tsx`.

### `experience-metadata.ts` — exact OG output

File: `apps/web/src/lib/experience-metadata.ts`. Full implementation visible; a typical Experience page returns:

```ts
return {
  title,
  description: description || undefined,
  openGraph: {
    title: ogTitle,
    description: ogDescription || undefined,
    url,
    siteName: "Jesus Film Project",
    locale: getOgLocale(locale),
    type: "website" as const,
    images: [ogImage],
  },
  twitter: {
    card: "summary_large_image" as const,
    site: "@JesusFilm",
    creator: "@JesusFilm",
  },
  ...(fbAppId && { other: { "fb:app_id": fbAppId } }),
  alternates: {
    canonical: url,
  },
}
```

### Gaps — what's missing for rich messaging previews

- **No `og:video` / `og:video:url` / `og:video:secure_url` / `og:video:type` / `og:video:width` / `og:video:height`.** Greps for `og:video` and `OpenGraph.*video` returned zero hits.
- **No `twitter:player` card** (would let some messengers embed the video inline instead of falling back to the image). Only `summary_large_image` is emitted.
- **No `<meta name="apple-itunes-app" content="app-id=..., app-argument=...">`** smart app banner. Greps for `apple-itunes-app` returned zero hits.
- **No `al:ios:*` / `al:android:*` App Links meta tags.**
- **No `type: "video.other"` OG type** — currently hard-coded `type: "website"`.
- OG image defaults to a generic Unsplash image if experience has no `ogImage` (line 23-29). Video thumbnails from `videos.images[].videoStill` are used only when the page is a single-video template (line 56-67), not when it's an experience with embedded video blocks.

---

## 6. Short URL / Redirect Infrastructure

### Current state — does not exist

- **No Cloudflare Workers.** No `workers/` directory, no `wrangler.toml`, no `cloudflare/` directory at repo root or under any `apps/*`.
- **No URL shortener domain or rewrite infrastructure.** No redirect rules in `next.config.mjs`. No middleware for short-URL resolution (`middleware.ts` does not exist in `apps/web/src/` — confirmed).
- **Cloudflare is positioned as DNS/WAF only** per root `CLAUDE.md`: "Cloudflare sits in front for DNS, WAF, and Authenticated Origin Pulls." No Workers-for-Platforms, no Pages deployment.
- **Railway deployment only** — `railway.toml` files in `apps/cms/`, `apps/manager/`, `apps/admin/`, `apps/roadmap/`. No `apps/web/railway.toml` found.

### Gaps

- A short URL service (e.g., `jfp.link/m/:code` → `https://www.jesusfilm.org/watch/{slug}/{locale}?moment={id}`) does not exist and must be built. Could be implemented as:
  - A new Next.js route in `apps/web/src/app/m/[code]/route.ts` (simplest, reuses existing Railway deployment).
  - A small Cloudflare Worker (added infrastructure, faster TTFB, attribution-friendly).
  - A new Railway service.

---

## 7. Analytics Pipeline

### Current state — nothing exists

- **No PostHog, Mixpanel, Amplitude, Segment, Rudderstack, or GA dependency** in `apps/mobile/package.json`, `apps/web/package.json`, or `apps/cms/package.json`. Grep for `posthog|mixpanel|amplitude` across core packages returned zero matches.
- **No `trackEvent(` or `track("` calls** in `apps/mobile/src` or `apps/web/src`. Grep returned zero.
- **No analytics initialization code** anywhere in mobile or web.

### `feat-090-watch-event-collection` summary

File: `docs/roadmap/content-discovery/feat-090-watch-event-collection.md`. Status: **not-started**. Owner: `nisal`. Priority: P1. Start: 2026-04-21, duration 10 days. Blocks `feat-091` and `feat-092`.

Scope:

- Create a `watch_events` table in CMS PostgreSQL tracking `session_id`, `video_id`, `watch_duration`, `video_duration`, `completion` (generated), `is_bounce` (generated), geo/device/browser_lang/referrer metadata, indexed by session_id, video_id, created_at.
- First-party UUID session cookie `jfp_session` (1-year expiry) on web.
- Emit watch events from video player on pause, end, and unload (`sendBeacon`).
- `POST /api/watch-events` endpoint on CMS (public, rate-limited 60/min per session).
- **Web-first; mobile instrumentation is explicitly called out as a follow-up.**

### Gaps

- Moment-share prototype needs custom events (MomentCreated, MomentShared, MomentOpened, MomentDeepLinkHit). Zero infrastructure exists. Options:
  1. Wait for `feat-090` (watch-events) and extend its table.
  2. Build a custom event sink (another Strapi content type or a new Railway service).
  3. Ship a 3rd-party analytics SDK (PostHog is free tier for low volume; native iOS/Android + JS SDK). Would require consent banner strategy.

---

## 8. CMS Content Type Inventory

### Full list (from `apps/cms/src/api/`)

```
backfill-queue           embedding                   video
bible-book               enrichment-automation       video-coverage
bible-citation           enrichment-automation-run   video-edition
blurhash-backfill        enrichment-job              video-image
cloudflare-r2            experience                  video-origin
continent                keyword                     video-study-question
core-sync                language                    video-subtitle
country                  language-audio-preview      video-variant
country-language         language-geo                video-variant-download
coverage-snapshot        mux-video                   watch-setting
data-snapshot            scene-embedding
                         search, seed-easter
```

### Existing "moment/clip/share/short/shareable" types?

**None.** Greps for `type -d -name "*share*" -o -type d -name "*moment*" -o -type d -name "*clip*"` in `apps/cms/src` returned zero. Greps for `/m/`, `/share`, `/s/`, `short.url`, `moment`, `shareable` in `apps/` returned only unrelated usage (the phrase "at the right moment" in marketing copy, and Facebook fb:app_id logic in `apps/web/src/lib/social-config.ts`).

Note: `api::video-variant.video-variant` has a field `share: string` (line 36 of its schema) — this is a **free-text share URL authored in the CMS**, not a generated messaging-share URL. No lifecycle populates it and nothing in the mobile app reads it.

### Relationship graph — types that reference "experience" and "video"

- **Experience** dynamic-zone `blocks` → `sections.media-collection`, `sections.video-hero`, `sections.video`, `sections.video-carousel`, etc. Each video-bearing component has a `video: manyToOne → api::video.video` relation.
- **Video** → `variants oneToMany → video-variant`, `subtitles oneToMany → video-subtitle`, `studyQuestions`, `keywords manyToMany`, `images oneToMany → video-image`, `bibleCitations oneToMany → bible-citation`, `origin manyToOne → video-origin`, `primaryLanguage manyToOne → language`, self-referential `children/parents manyToMany`.
- **VideoVariant** → `language manyToOne`, `videoEdition manyToOne`, `muxVideo manyToOne → mux-video`, `asset manyToOne → cloudflare-r2`, `video manyToOne`, `downloads oneToMany → video-variant-download`.
- **MuxVideo** → `variants oneToMany → video-variant` (mappedBy `muxVideo`).
- **VideoSubtitle** → `language`, `videoEdition`, `vttAsset/srtAsset → cloudflare-r2`, `video`.

The key path from Experience → playable Mux asset for a user's language:

```
Experience.blocks[].video → Video.variants[] (filter by Language.bcp47)
  → VideoVariant.muxVideo → MuxVideo.playbackId
```

---

## 9. Render / Background-Worker Infrastructure

### Current state

- **`apps/manager/` service exists.** `apps/manager/package.json` name: `@forge/manager`. Purpose (from `apps/manager/CLAUDE.md`): "AI video enrichment pipeline dashboard. Ingests video assets via Mux, runs enrichment workflows (transcription, translation, chapters, metadata, embeddings) using OpenRouter-routed AI models, stores artifacts in Railway S3-compatible Object Storage, and optionally syncs results back to Strapi CMS via `@forge/graphql`."
- **`apps/admin/` service exists.** `apps/admin/package.json` name: `@forge/admin`. Purpose (from `apps/admin/CLAUDE.md`): strategic replacement for Strapi, Next.js + Yoga + Pothos + Prisma + pgvector + useworkflow. Currently at Units 1-13 plus R1-R5 of an admin-migration playbook, but does not own the consumer-facing watch surface yet.
- **Background-job patterns in manager:**
  - `useworkflow` (npm package `workflow`) for durable jobs — `apps/manager/src/workflows/` holds workflow definitions (videoEnrichment, launchVideoEnrichment, sceneAnalysisPipeline).
  - Next.js `after()` pattern — `apps/manager/src/app/api/backfill/start/route.ts` uses `claimBackfill()` synchronously then `after(() => startBackfill())`.
- **Artifact storage:** `apps/manager/src/services/storage.ts` — Railway S3-compatible (`@aws-sdk/client-s3 ^3.0.0`) at keys `{assetId}/{artifact-type}.{ext}`. Local tmp fallback at `.tmp/artifacts/` when `RAILWAY_S3_BUCKET` is not set (service falls back gracefully per `apps/manager/src/services/storage.ts:9`). Used by audio-cleanup, transcription, scene-analysis artifacts.
- **ffmpeg is already available in manager Railway runtime.** Root `nixpacks.toml` adds `ffmpeg` to the NIXPACKS setup phase. Used today in `apps/manager/src/services/audioCleanup.ts:186` via `spawn("ffmpeg", ...)` for audio extraction from video URLs (e.g., `-i sourceUrl -vn -acodec libmp3lame -f mp3 pipe:1`).

### Backfill-worker pattern summary

Documented in `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md` (feat-042). Key learnings:

- Start/cancel/status routes on manager; `after()` for background execution; claim-then-start pattern prevents TOCTOU; output CMS table acts as progress tracker.
- Not a scheduled job — triggered via `POST /api/backfill/start` then runs to completion in-process.

### Gaps

- Nothing today spawns ffmpeg specifically to produce a clipped/cropped/subtitled MP4. Only audio-extraction args are wired.
- No per-user / per-share job queue. The existing backfill pattern is for one-off batch jobs, not concurrent user-initiated renders.

---

## 10. Authentication State

### Current state

- **Mobile app: no login, no user accounts.** `apps/mobile/src` has zero references to auth/login/session code (grep returned nothing). Mobile reads CMS GraphQL as an anonymous client.
- **Web app: no login required, anonymous browsing OK.** No middleware, no auth routes in `apps/web/src/app/`.
- **CMS: HMAC-SHA512 API tokens.** Confirmed by `apps/cms/src/bootstrap/internal-api-token.ts:9-156` — bootstraps two named tokens `forge-internal-api-token` and `forge-embedding-override-api-token` via `strapi.db.query("admin::api-token")`. Tokens are pre-hashed HMAC-SHA512 per root `CLAUDE.md`.
- **Manager: login required.** Dashboard gated by "Manager" role (Strapi user + role); middleware enforces cookie `strapi-jwt`. API routes also accept `MANAGER_API_KEY` bearer.
- **Admin: Better Auth + Firebase email/password fallback, Firebase Admin SDK.** SSO via Facebook/Google/Apple/Okta. Cookie scoped to `AUTH_COOKIE_DOMAIN` (`.jesusfilm.org` in prod).

### Gaps — for the Moment feature

- No user identity in mobile. A Moment generated "by" a user can't be attributed without adding a session cookie/device ID or anonymous user concept. For the prototype, the simplest approach: anonymous sessions with a stable client-generated UUID (same pattern feat-090 proposes for web).

---

## 11. Related Roadmap Features

Found via grep for `share|clip|moment|distribution|deep.link|universal.link|referral` across `docs/roadmap/`.

| ID       | Title                                     | Owner              | Status      | Lane              | Relevance                                                                                                                                                                                                                                                                                                                           |
| -------- | ----------------------------------------- | ------------------ | ----------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| feat-062 | Shareable Custom Video Generation         | vlad               | not-started | media-generation  | **Highly relevant.** Proposes turning custom-generation output into a durable shareable artifact with a stable link. Depends on feat-056 and feat-057 (both not-started). Start 2026-09-01. Addresses shareable custom-generated videos, not native-share bubbles of an existing Experience clip — overlapping but different scope. |
| feat-056 | AI Video Template System                  | (media-generation) | —           | media-generation  | Blocks feat-062; generation input/template schema. Says "contest entries, inspiration pieces, personalized videos, and shareable outputs" should share a template system. Not started.                                                                                                                                              |
| feat-057 | Automated Video Rendering Engine          | (media-generation) | —           | media-generation  | Blocks feat-062; render execution layer for generation pipeline. Not started.                                                                                                                                                                                                                                                       |
| feat-060 | On-Demand Personalized Video Generation   | —                  | —           | media-generation  | Related to per-user generation but does not cover messaging-share flow.                                                                                                                                                                                                                                                             |
| feat-090 | Watch Event Collection & Session Tracking | nisal              | not-started | content-discovery | Key dependency for any share analytics. Web-first, mobile follow-up.                                                                                                                                                                                                                                                                |
| feat-091 | FPMC Video Page Recommendations           | —                  | —           | content-discovery | Depends on feat-090.                                                                                                                                                                                                                                                                                                                |
| feat-092 | Two-Tower Neural Recommendations          | —                  | —           | content-discovery | Depends on feat-090.                                                                                                                                                                                                                                                                                                                |

Other `share`-keyword matches are non-relevant: AGENTS.md references `sharedStyles` (styling code), `sharedStyles` in mobile, and `share: string` field on `video-variant` (authored copy URL, not messaging share).

### Gaps

- **No roadmap feature for "Moment-style" clip generation + native share + short-URL attribution.** feat-062 is the nearest match but targets fully-generated videos, not cut-from-existing-Experience clips.

---

## 12. Feature Flags / Experimentation

### Current state — nothing exists

- Greps for `growthbook|LaunchDarkly|featureFlag|feature_flag` across `apps/` and `packages/` returned zero matches.
- No feature flag SDK in any `package.json`.
- No env-driven boolean gates that resemble per-user flag logic. (The `ENRICHMENT_AUTOMATIONS_ENABLED` env in CMS is a binary ops gate, not per-user.)

### Gaps

- A Moment prototype will likely want to gate by user group, app version, or traffic percent. Zero infrastructure exists. Simplest prototype: env-var gate in app.json (`extra.momentFeature: true/false`) read at runtime.

---

## 13. Deployment / Services

### Services deployed via Railway today

Per `railway.toml` files:

- `apps/cms/railway.toml` — dockerfilePath `apps/cms/Dockerfile`, releaseCommand `pnpm data-import-check`. Strapi v5.
- `apps/manager/railway.toml` — NIXPACKS, standalone Next.js output, health at `/api/health`, restart-on-failure, ffmpeg from root `nixpacks.toml`.
- `apps/admin/railway.toml` — NIXPACKS, Prisma migrate + standalone Next.js, health at `/api/health`.
- `apps/roadmap/railway.toml` — Next.js roadmap dashboard.
- **`apps/web/` has NO `railway.toml`.** Likely deployed via Railway dashboard directly (not uncommon). Deployment exists in prod at `https://www.jesusfilm.org/watch`.

### Cloudflare

- Per root `CLAUDE.md`: DNS, WAF, Authenticated Origin Pulls in front of Railway. No Workers / Pages.

### Environment-variable management

- Doppler for mobile (`forge-mobile`), manager (`forge-manager`), admin (`forge-admin`), web (`forge-web`), CMS (via Railway dashboard).
- Local dev: `.env.local` (gitignored) via `pnpm fetch-secrets` per app.

---

## Gaps to Close for a Prototype

Ranked by severity / blocking distance from "zero" to "ships":

### Hard blockers — nothing exists

1. **Clip generation path.** No Mux clip API call, no ffmpeg clip encoder, no CMS content type for a generated artifact. Must pick one of two approaches:
   - **Server-side render in manager app** (ffmpeg trim + scale to vertical + burn subtitle), store resulting MP4 in Railway S3, return signed URL. Leverage existing ffmpeg + S3 + `after()` pattern. 15-20MB per 15s vertical clip is realistic.
   - **Pre-render a library** (offline pipeline generates Moments for a curated set of Experiences; CMS stores URL on a new content type). Avoids per-user render but limits coverage.

2. **Mobile share with attached media file.** `React Native Share.share({url: fileURI})` on iOS does not attach a local file to the share sheet the way most users expect — the URL becomes a hyperlink, not an attached video. The correct API is `expo-sharing`'s `shareAsync(fileUri)` (not installed) OR `react-native-share` (not installed). **`expo-sharing` must be added.**

3. **Download-then-share flow in mobile.** Need to download the generated MP4 to the device (FileSystem.downloadAsync from `expo-file-system` — NOT installed) and pass the local file URI to `shareAsync`. `expo-file-system` must be added.

4. **Short URL service.** No `/m/:code` route exists on `apps/web`. A Next.js App Router route or a new Railway service is required. Simplest: `apps/web/src/app/m/[code]/route.ts` with a DB table for code → (experienceSlug, momentId, createdAt).

5. **Deep-link back into mobile.** Neither Universal Links (iOS) nor App Links (Android) are configured. Minimum work:
   - Add `associatedDomains: ["applinks:www.jesusfilm.org"]` to `apps/mobile/app.json` ios section.
   - Add `intentFilters` with `android.intent.category.BROWSABLE` for `www.jesusfilm.org/watch/*` to `apps/mobile/app.json` android section.
   - Publish `apple-app-site-association` at `apps/web/public/.well-known/apple-app-site-association` (new file) and `assetlinks.json` at same directory.
   - Wire `expo-linking`'s `useURL()` in mobile root layout to parse and route.

6. **Rich messaging preview metadata.** The web `[slug]/[locale]` page does not emit `og:video`, `twitter:player`, `apple-itunes-app`, or `al:ios/al:android`. Needed for iMessage/WhatsApp/Messenger link previews to show the Moment video (or at least a branded smart banner).

### Soft blockers — partial infrastructure exists

7. **Analytics.** Zero events tracked today. Any prototype KPI (shares/send, opens-from-bubble, app-install-from-link, Experience-landing-from-bubble) needs an event sink. Either deferred (collect via server logs on the short URL redirect) or a PostHog-style SDK added.

8. **Per-user session identity.** Mobile has no session ID. Needed for dedup, attribution, or analytics scoping. Fix: generate UUID in AsyncStorage on first launch (same pattern feat-090 proposes for web).

9. **Subtitle burn-in data.** VTT/SRT URLs exist per `video-subtitle`; Mux has generated subtitles too. But nothing fetches and overlays them onto a render. ffmpeg `subtitles` filter is the standard approach.

10. **Playback ID on Experience blocks.** Current GraphQL fragments give `streamingUrl` but not `muxVideo.playbackId` directly. A Moment render needs the playback ID (or parse from URL). Add to `VideoHeroFragment` + `VideoSectionFragment`.

### Already ready — usable as-is

- **Mux playback IDs** are stored on `MuxVideo.playbackId` and reachable from the Experience → Video → VideoVariant → MuxVideo join.
- **Manager ffmpeg runtime** is working in Railway production for audio cleanup — reuse for clip encoding.
- **Railway S3 artifact storage** at `{assetId}/{artifact}.{ext}` is proven, with local tmp fallback.
- **Mux stream URLs** (`https://stream.mux.com/{id}.m3u8`) and **Mux thumbnail URLs** (`https://image.mux.com/{id}/thumbnail.webp?time=X&width=Y`) are public and cached — thumbnail generation is free/cheap.
- **Experience slug + locale already deep-linkable** on web at `https://www.jesusfilm.org/watch/{slug}/{locale}`. The escalation target for a Moment URL exists.
- **Anonymous CMS access** — no auth wall for reading published Experience / Video content.
- **Video subtitles (VTT)** public URLs are already resolvable per video via `listMuxSubtitleTracks()` in manager.
- **`@forge/graphql` typed client** already projects the required video fields; extending with one more fragment is routine.
- **`BibleQuotesCarouselRenderer` share handler** (`apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx:205-214`) is a working example of RN's `Share.share` from a section renderer — extend this pattern.

---

## Critical Path to Working Prototype

The 5-6 concrete infra items that must be built, in order:

### Phase 1: Server-side clip render (manager)

1. **Add Mux clip or ffmpeg clip endpoint to manager.** New route: `apps/manager/src/app/api/moment/render/route.ts`. Input: `{ videoId, playbackId, startSec, endSec, languageBcp47 }`. Use `spawn("ffmpeg", ["-ss", startSec, "-i", `https://stream.mux.com/${playbackId}.m3u8`, "-t", "15", "-vf", "crop=...,scale=1080:1920,subtitles=<vttUrl>", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", outPath])`. Burn subtitles via the `subtitles`filter with the VTT URL from`listMuxSubtitleTracks()`. Write output MP4 to Railway S3 via `apps/manager/src/services/storage.ts`. Return signed URL + duration + dimensions.
2. **Moment record persistence** (lightweight): either (a) new Strapi `moment` content type with `code`, `experienceSlug`, `locale`, `startSec`, `endSec`, `storageKey`, `createdAt`, OR (b) Cloudflare R2 object key = short code and no DB record (ok for prototype). Recommend (a) for attribution.

### Phase 2: Web short URL + rich metadata

3. **Web `/m/[code]` route.** New file `apps/web/src/app/m/[code]/route.ts` (Next.js Route Handler) OR `apps/web/src/app/m/[code]/page.tsx` with `generateMetadata` that:
   - Resolves `code` → moment record → `{experienceSlug, locale, videoUrl, posterUrl, duration}`.
   - Emits OG: `og:type = "video.other"`, `og:video = videoUrl`, `og:video:type = "video/mp4"`, `og:image = posterUrl`, `twitter:card = "player"`, `twitter:player = videoUrl`, `twitter:player:width/height`, `apple-itunes-app = "app-id=XXX, app-argument=forgemobile://m/{code}"`.
   - Page body does a client-side UA sniff + redirect to mobile app via Universal Link / fallback to `https://www.jesusfilm.org/watch/{slug}/{locale}`.

### Phase 3: Mobile share UX

4. **Install `expo-sharing` + `expo-file-system` in mobile.** Wire a "Share Moment" button into `VideoHeroRenderer` (primary surface) and `VideoSectionFragment` renderers:
   - On press, call manager's render endpoint (above) for the current video + user's locale + a chosen 10-15s window (default: 0→15s or a CMS-authored highlight range).
   - Poll until MP4 is ready (or use a websocket / Server-Sent Events for v2).
   - `FileSystem.downloadAsync(signedMp4Url, FileSystem.cacheDirectory + "moment.mp4")`.
   - `Sharing.shareAsync(localUri, { mimeType: "video/mp4", dialogTitle: "Share this Moment", UTI: "public.mpeg-4" })`.
   - Append the caption `"Watch: https://jfp.link/m/{code}"` out-of-band (iOS requires separate share metadata; Android concatenates — both sheets handle it).

### Phase 4: Deep-link wiring

5. **Universal Links + App Links config.**
   - Add `associatedDomains: ["applinks:www.jesusfilm.org"]` to `apps/mobile/app.json` ios.
   - Add Android `intentFilters` for `https://www.jesusfilm.org/watch/*` and `/m/*`.
   - Publish `apple-app-site-association` at `apps/web/public/.well-known/apple-app-site-association` with app ID `TEAMID.org.jesusfilm.forgewatch`.
   - Publish `assetlinks.json` at same directory with package `org.jesusfilm.forgewatch` and SHA-256 cert hash (from EAS).
   - Wire `expo-linking` `useURL()` + `Linking.getInitialURL()` in `apps/mobile/app/_layout.tsx` → parse `/m/{code}` and `/watch/{slug}/{locale}` → navigate via Expo Router.

### Phase 5: Analytics (minimum)

6. **Log events via manager/web API.** Simplest prototype: the `GET /m/:code` route handler logs `{ code, referrer, userAgent, ts }` to a CMS content type or structured log (Railway → log drain). Native share event can be tracked by the mobile app via `POST /api/m/track` from manager (no SDK). Defer PostHog/Mixpanel integration unless/until the prototype validates the feature.

### Optional Phase 6

7. **Pre-render N popular Experiences** via a backfill job (reuse pattern from `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md`) to avoid per-user render latency. Moments become effectively static.

---

## Unexpected Findings That Change Scope

1. **Mobile's only existing Share button shares a hard-coded static URL — it has never shared media content before.** This means the Moment feature is not building _on top of_ an existing share pattern; it's establishing the first real media-share capability. Expect pitfalls on iOS (share UTIs, file URI handling) and Android (FileProvider permissions for shared files) that aren't documented anywhere in the codebase.

2. **`apps/manager` is the only app with Mux credentials.** The CMS — which owns the `mux-video` content type — has no Mux SDK. If CMS (or web) ever needs to drive clipping, credentials will have to be added. The architecture pressure is to keep Mux calls in manager and have the clip endpoint there.

3. **feat-062 ("Shareable Custom Video Generation") is the closest roadmap cousin but targets a different primitive.** It's about making fully-generated videos shareable via a stable watch URL — not cutting a clip from an existing Experience and attaching it to a text message. Teams might assume this covers the Moment use case; it does not. A new feat-NNN is needed for Moment share.

4. **Web `basePath: "/watch"` is set on all routes.** A short URL at the bare `https://jesusfilm.org/m/{code}` cannot live on the same Railway service without a basePath change or a second route namespace outside `/watch`. Either (a) ship short URLs at `https://www.jesusfilm.org/watch/m/{code}` (ugly but cheap), (b) add a second Next.js route group that bypasses basePath (not clean in App Router), or (c) stand up a tiny new "shortener" service (Cloudflare Worker or Railway Next.js app). Option (c) is the cleanest.

5. **`mux_videos.duration` is structurally always 0** — don't try to read it for clip-boundary math. Always join through `video_variants.duration` or compute from Mux API asset.duration at render time.

6. **ffmpeg is already on the manager Railway image** (for audio cleanup) — zero ops lift to reuse it for clip encoding. This is a quiet but huge win.

7. **Public-playback Mux policy on manager-created assets** (`apps/manager/src/services/mux.ts:304`) means rendered Moment MP4s can be hosted directly under the Mux public CDN if uploaded as assets — avoiding the Railway-S3 egress question for bubble delivery entirely. Trade-off: Mux storage + egress cost vs. R2 cost.

8. **Existing SEMANTIC_SEARCH GraphQL already returns `playbackId` + `startSeconds` per scene result** (`apps/mobile/src/lib/queries.ts:463-473`). A "Share this scene" button on search results could ship faster than the general Experience-block Moment feature because the timing + playback ID are already in-hand.

9. **No feature-flag system exists anywhere** in the monorepo. Any rollout strategy (5% of users, iOS-only, etc.) needs to be built from scratch or reduced to an env var.

10. **No Cloudflare Workers / edge compute capacity** available today. Root `CLAUDE.md` positions Cloudflare as pure DNS/WAF. If the short-URL service needs edge redirects, Cloudflare must be lifted from DNS-only mode, or Railway serves the redirect (adds ~100-300ms TTFB).

---

## Summary — What's Actually Ready Today

| Capability                                                          | Status  | File path                                                                                                                 |
| ------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| Mux playback IDs reachable                                          | Ready   | `apps/cms/src/api/mux-video/content-types/mux-video/schema.json`, `apps/mobile/src/lib/queries.ts:471`                    |
| Mux stream URL construction                                         | Ready   | `apps/manager/src/services/mux.ts:341-343`                                                                                |
| Mux thumbnail URL construction                                      | Ready   | `apps/manager/src/services/mux.ts:345-353`                                                                                |
| ffmpeg in manager runtime                                           | Ready   | `nixpacks.toml`, `apps/manager/src/services/audioCleanup.ts:186`                                                          |
| Railway S3 artifact storage                                         | Ready   | `apps/manager/src/services/storage.ts`                                                                                    |
| Subtitle tracks (VTT/SRT + Mux-generated) resolvable                | Ready   | `apps/cms/src/api/video-subtitle/content-types/video-subtitle/schema.json`, `apps/manager/src/services/mux.ts:169-211`    |
| GraphQL typed client + Experience → Video → Variant → MuxVideo path | Ready   | `packages/graphql/`, `apps/mobile/src/lib/queries.ts`                                                                     |
| Experience → web URL exists                                         | Ready   | `apps/web/src/app/[slug]/[locale]/page.tsx`                                                                               |
| Mobile one-tap share (text-only, working)                           | Ready   | `apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx:205-214`                                             |
| Background job pattern (after + claim)                              | Ready   | `apps/manager/src/app/api/backfill/start/route.ts`, `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md` |
| Clip / trim / segment generation                                    | Missing | —                                                                                                                         |
| Mobile media share (`expo-sharing`)                                 | Missing | —                                                                                                                         |
| Mobile file download (`expo-file-system`)                           | Missing | —                                                                                                                         |
| Short URL `/m/:code` route                                          | Missing | —                                                                                                                         |
| Universal Links (iOS)                                               | Missing | `apps/mobile/app.json` + `apps/web/public/.well-known/apple-app-site-association` both absent                             |
| App Links (Android)                                                 | Missing | `apps/mobile/app.json` + `apps/web/public/.well-known/assetlinks.json` both absent                                        |
| `og:video` / `twitter:player` metadata                              | Missing | `apps/web/src/lib/experience-metadata.ts`                                                                                 |
| `apple-itunes-app` smart banner                                     | Missing | —                                                                                                                         |
| Analytics pipeline                                                  | Missing | —                                                                                                                         |
| Feature flags                                                       | Missing | —                                                                                                                         |
| CMS moment/clip/share content type                                  | Missing | —                                                                                                                         |
