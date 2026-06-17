---
title: "feat: YouTube AI-Christian video discovery workflow"
type: feat
status: active
created: 2026-06-17
origin: docs/brainstorms/2026-06-17-youtube-pinterest-discovery-requirements.md
target_repo: forge (apps/mastra)
---

# feat: YouTube AI-Christian video discovery workflow

## Problem & Scope

The Instagram discovery bot is live and feeds AI-generated Christian videos into
a human-approved review queue on gospelmedialab.com. The next planned platform is
**YouTube** (most of the team's curated creators are there, and it has a clean
official API). This plan builds a YouTube discovery workflow in `apps/mastra`
that mirrors the proven `instagram-ai-christian-discovery` workflow, reusing the
shared AI+Christian classifier, commentary filter, dedupe, and site-submission
building blocks (see origin: docs/brainstorms/2026-06-17-youtube-pinterest-discovery-requirements.md).

**In scope (this plan):**

- A new Mastra workflow `youtube-ai-christian-discovery` with **two modes**:
  trusted-channel pull + keyword search discovery.
- A YouTube Data API client (channels, uploads playlist, search) with typed
  errors, retry, and timeout — mirroring `firecrawl-search-client`.
- Generalizing the existing keyword classifier + commentary filter into a shared
  module used by both Instagram and YouTube.
- Extending the website ingest payload the bot sends to carry a **platform label**
  and a **clickable author/source link** (backward-compatible; Instagram keeps
  working).

**Out of scope / deferred (tracked below):** Pinterest; the website-side "Sources"
management section and the Instagram attribution-link rendering fix (both are
Vlad's website work); reading the trusted-channel list from the website (fast-follow
once that endpoint exists — until then channels are passed as workflow input).

---

## Requirements Traceability

| Requirement (origin)                                              | Where addressed                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| YouTube discovery, both modes (trusted accounts + keyword search) | U6 (workflow)                                                                   |
| Filter every video for AI + Christian, even from trusted accounts | U2 (shared classifier), U6                                                      |
| Drop commentary/reaction/tutorial posts                           | U2 (shared commentary filter)                                                   |
| Memory — no repeats across runs                                   | Dedupe by videoId in U6; site dedup by `(platform, externalId)` — see Decisions |
| Feed the same review queue                                        | U5 (platform-aware site submit)                                                 |
| Attribution: platform + clickable author/source link              | U3 (normalized video carries author URL), U5 (payload), website dependency      |
| Build YouTube first, Pinterest later                              | Whole plan is YouTube-only                                                      |
| Human approves everything                                         | Unchanged — bot only submits drafts                                             |

---

## Key Technical Decisions

**D1 — One workflow per platform, shared building blocks (not one generic workflow).**
Mirror `instagram-ai-christian-discovery` as a sibling `youtube-ai-christian-discovery`.
The very different access models (YouTube official API vs Instagram web search)
and the easy/hard split make per-platform workflows cleaner and independently
shippable. Shared logic (classifier, commentary filter, site submit) is factored
into a shared module so there is no real duplication (see origin decision).

**D2 — Generalize the classifier in place into a shared discovery module.** The
current `classifyPost` only reads `caption` + `hashtags`, so it is already
platform-agnostic in substance. Move the keyword lists, classifier, and commentary
filter to a shared `services/discovery/` module that takes a structural
`{ caption, hashtags }` input. Instagram is updated to import from the shared
module (mechanical; existing tests cover it). For YouTube, `caption` = title +
description and `hashtags` = hashtags extracted from the description.

**D3 — Normalized `DiscoveredVideo` candidate + platform-aware site submission.**
Introduce a platform-agnostic candidate shape carrying `platform`, `externalId`
(YouTube videoId / IG shortcode), `sourceUrl`, `authorHandle`, `authorName`,
`authorUrl`, `thumbnailUrl`, `caption`, `matchedAi`, `matchedChristian`. The
site-submission step sends this shape. The website ingest endpoint is extended to
accept `platform` (default `instagram`) and the author/source links,
**backward-compatible** so existing Instagram submissions are unaffected. YouTube
uses the shared submit now; migrating Instagram's own submit onto the shared shape
is a low-risk follow-up, not required for this plan.

**D4 — Dedup key is `(platform, externalId)`.** Within a run, dedupe by videoId.
Across runs/platforms, the website dedups by `(platform, externalId)` so the same
YouTube video is never queued twice and a YouTube id can never collide with an
Instagram shortcode. This is the cross-run "memory."

**D5 — Trusted channels via workflow input now; site-fetched list is a follow-up.**
The workflow accepts a `channels` array (handles, URLs, or channel IDs) plus
`queries`. Reading the list from the review page's "Sources" section is wired once
Vlad ships that endpoint (deferred). This keeps the bot shippable and runnable
today.

**D6 — `YOUTUBE_API_KEY` is optional (opt-in scaffolding rule).** Like
`FIRECRAWL_API_KEY`, the new env var is `.optional()` and never added to
`assertMastraRuntimeEnv()`. Absent key → workflow returns `config_missing`, never
bricks a deploy.

---

## High-Level Technical Design

```
Trusted channels ──► channels.list (uploads playlist) ──► playlistItems.list ─┐
                                                                              ├─► raw video items
Keyword queries  ──► search.list (type=video) ───────────────────────────────┘
        │
        ▼
parse → normalize to DiscoveredVideo (videoId, sourceUrl, author, authorUrl, thumb)
        │
        ▼
dedupe by videoId → classify (AI + Christian, drop commentary) → cap at maxResults
        │
        ├─► write JSON artifact (report)
        └─► submit to website review queue  { platform: "youtube", ... }  (best-effort)
```

_This illustrates the intended approach and is directional guidance for review,
not implementation specification. The implementing agent should treat it as
context, not code to reproduce._

---

## Output Structure

```
apps/mastra/src/
├── config/env.ts                         (modified: YOUTUBE_* vars + getter)
├── services/
│   ├── youtube-search-client.ts          (new: YouTube Data API client)
│   ├── youtube-search-client.test.ts     (new)
│   ├── discovery/                         (new shared module)
│   │   ├── classifier.ts                  (moved from instagram-discovery)
│   │   ├── classifier.test.ts             (moved)
│   │   ├── candidate.ts                   (new: DiscoveredVideo + platform types)
│   │   ├── site-ingest-client.ts          (new shared, platform-aware submit)
│   │   └── site-ingest-client.test.ts     (new)
│   └── youtube-discovery/
│       ├── types.ts                       (new: YouTubeVideo, report types)
│       ├── post-parser.ts                 (new: API item → normalized video)
│       ├── post-parser.test.ts            (new)
│       ├── artifacts.ts                   (new: youtube report store)
│       └── artifacts.test.ts              (new)
└── mastra/
    ├── index.ts                           (modified: register workflow + route)
    └── workflows/
        ├── youtube-ai-christian-discovery.ts       (new)
        └── youtube-ai-christian-discovery.test.ts  (new)
```

The per-unit `**Files:**` sections are authoritative; the implementer may adjust
layout if a cleaner split emerges.

---

## Implementation Units

### U1. Env config for YouTube Data API

**Goal:** Add the YouTube API settings and a typed getter, mirroring the Firecrawl
config.

**Requirements:** D6.

**Dependencies:** none.

**Files:**

- `apps/mastra/src/config/env.ts` (modify)
- `apps/mastra/src/config/env.test.ts` (modify)
- `apps/mastra/.env.example` (modify)

**Approach:** Add `YOUTUBE_API_KEY` (`z.string().min(1).optional()`),
`YOUTUBE_API_BASE_URL` (`z.string().url().default("https://www.googleapis.com/youtube/v3")`),
and `YOUTUBE_SEARCH_TIMEOUT_MS` (`z.coerce.number().int().positive().max(120_000).default(30_000)`).
Add `getYouTubeConfig()` returning `{ apiKey, baseUrl, timeoutMs }`. Do **not**
add to `assertMastraRuntimeEnv()`. The site-ingest URL/token env vars already
exist and are reused as-is.

**Patterns to follow:** the existing `getFirecrawlConfig()` block in the same file.

**Test scenarios:**

- `getYouTubeConfig()` returns defaults when only the key is set.
- Returns `apiKey: undefined` when the env var is absent (drives `config_missing`).
- Invalid `YOUTUBE_API_BASE_URL` (non-URL) fails schema parse.

---

### U2. Shared discovery classifier module

**Goal:** Move the keyword classifier + commentary filter into a shared module
that both Instagram and YouTube use, taking a structural `{ caption, hashtags }`.

**Requirements:** filter every video for AI + Christian; drop commentary.

**Dependencies:** none.

**Files:**

- `apps/mastra/src/services/discovery/classifier.ts` (new — moved content)
- `apps/mastra/src/services/discovery/classifier.test.ts` (new — moved tests)
- `apps/mastra/src/services/instagram-discovery/classifier.ts` (modify → re-export or import from shared)
- `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.ts` (modify import)

**Approach:** Relocate `AI_KEYWORDS`, `CHRISTIAN_KEYWORDS`, `COMMENTARY_KEYWORDS`,
`classifyPost` (renamed `classifyContent`), and `qualifies` to
`services/discovery/classifier.ts`. Change the input type from `InstagramPost` to
a structural `{ caption: string; hashtags: string[] }` so both platforms satisfy
it. Keep Instagram working by re-exporting from the old path (or updating its
imports). No keyword changes — same lists, same behavior.

**Patterns to follow:** existing `classifier.ts`; keep the conservative
commentary-list comment block verbatim.

**Execution note:** This is a refactor of tested code — keep the existing
classifier tests green throughout (move them, do not rewrite assertions).

**Test scenarios:**

- All existing classifier tests pass unchanged after the move (AI+Christian
  qualifies; commentary excluded; word-boundary guards for "ai"/"god").
- `classifyContent` accepts a plain `{ caption, hashtags }` object (not an
  InstagramPost) and returns the same signals.
- Instagram workflow still imports and qualifies posts correctly (existing
  Instagram workflow tests stay green).

---

### U3. YouTube types + video parser

**Goal:** Define the normalized YouTube video shape and parse YouTube Data API
items into it, capturing reliable attribution fields.

**Requirements:** attribution (platform + author URL + source URL); memory
(videoId as dedupe key).

**Dependencies:** none (parser consumes raw API item shapes defined here).

**Files:**

- `apps/mastra/src/services/youtube-discovery/types.ts` (new)
- `apps/mastra/src/services/youtube-discovery/post-parser.ts` (new)
- `apps/mastra/src/services/youtube-discovery/post-parser.test.ts` (new)

**Approach:** `YouTubeVideo` = `{ videoId, url (https://www.youtube.com/watch?v=<id>),
title, description, channelId, channelTitle, authorUrl (https://www.youtube.com/channel/<channelId>),
publishedAt (ISO, reliably present from the API), thumbnailUrl, hashtags (extracted
from description), matchedAi, matchedChristian }`. The parser handles BOTH item
shapes: `search.list` (`id.videoId`, `snippet.*`) and `playlistItems.list`
(`contentDetails.videoId` or `snippet.resourceId.videoId`, `snippet.*`). Build the
classifier haystack as `title + " " + description`. Extract `#hashtags` from the
description. Drop items with no resolvable videoId.

**Patterns to follow:** `instagram-discovery/post-parser.ts` (URL canonicalization,
hashtag extraction, null-safe fields) and `types.ts` field-cap conventions.

**Test scenarios:**

- Parses a `search.list` item → correct videoId, watch URL, channel author URL.
- Parses a `playlistItems.list` item (resourceId.videoId shape) → same normalized
  result.
- Extracts hashtags from the description; empty when none.
- `publishedAt` populated from `snippet.publishedAt` (unlike Instagram, reliably
  present).
- Item with no resolvable videoId returns null and is dropped.
- Over-long title/description are capped per the schema bounds.

---

### U4. YouTube Data API client

**Goal:** A typed client for the three YouTube Data API calls, with retry, timeout,
and a typed error union — mirroring `firecrawl-search-client`.

**Requirements:** both modes (trusted channels + keyword search).

**Dependencies:** U1 (config).

**Files:**

- `apps/mastra/src/services/youtube-search-client.ts` (new)
- `apps/mastra/src/services/youtube-search-client.test.ts` (new)

**Approach:** Export `YouTubeSearchError` with a code union
(`config_missing | auth_failed | rate_limited | not_found | upstream_failed | invalid_response`)
and a `retryable` flag. Three functions (or one with a mode):
`searchVideos(query, opts)` → `GET /search?part=snippet&type=video&q=&maxResults=&key=`;
`resolveUploadsPlaylist(channelRef, opts)` → `GET /channels?part=contentDetails`
by `id=` or `forHandle=@handle` → `contentDetails.relatedPlaylists.uploads`;
`listPlaylistVideos(playlistId, opts)` → `GET /playlistItems?part=snippet,contentDetails&playlistId=&maxResults=`.
Map HTTP `401/403` → `auth_failed`; `403 quotaExceeded` / `429` → `rate_limited`
(retryable); `404` → `not_found`; `>=500` → `upstream_failed` (retryable). Use
`AbortSignal.timeout`, an attempt loop with backoff, and tolerant Zod parse with
`.passthrough()` on item shapes. Accept an injectable `fetchImpl` for tests.

**Patterns to follow:** `firecrawl-search-client.ts` — error class, attempt loop,
status→retryable mapping, tolerant parse.

**Test scenarios:**

- `searchVideos` returns normalized hits from a mocked search response.
- `resolveUploadsPlaylist` returns the uploads playlist id from a mocked channels
  response; `not_found` when the channel list is empty.
- `listPlaylistVideos` returns items from a mocked playlistItems response.
- 401 → `auth_failed` (not retryable); 429 / quotaExceeded → `rate_limited`
  (retryable); 500 → `upstream_failed` (retryable); malformed JSON →
  `invalid_response`.
- Times out via `AbortSignal.timeout` → retryable upstream failure.

---

### U5. Shared platform-aware site-ingest client

**Goal:** A shared submission client that sends a normalized candidate with a
platform label and author/source links to the website review queue.

**Requirements:** feed the same review queue; attribution (platform + author link).

**Dependencies:** U3 (candidate shape).

**Files:**

- `apps/mastra/src/services/discovery/candidate.ts` (new — `DiscoveredVideo`/platform types)
- `apps/mastra/src/services/discovery/site-ingest-client.ts` (new)
- `apps/mastra/src/services/discovery/site-ingest-client.test.ts` (new)

**Approach:** Define `Platform = "instagram" | "youtube" | "pinterest"` and the
`DiscoveredVideo` candidate. `submitCandidatesToSite(candidates, config)` POSTs
`{ posts: [{ platform, externalId, url, caption, author, authorUrl, thumbnailUrl,
matchedAi, matchedChristian }] }` with `Authorization: Bearer`. Mirror the existing
`instagram-discovery/site-ingest-client.ts` error handling exactly (config_missing,
auth_failed on 401/403, upstream_failed with retryable on >=500, invalid_response,
empty → no fetch). Returns `{ ok, inserted, skipped }`.

**Patterns to follow:** `instagram-discovery/site-ingest-client.ts` (near-identical;
adds `platform` + `externalId` + `authorUrl` to the payload).

**Test scenarios:**

- Posts the mapped payload including `platform: "youtube"` and `authorUrl`; returns
  counts.
- `config_missing` thrown before fetch when URL or token absent.
- Empty candidate list → no fetch, zero counts.
- 401 → `auth_failed`; 500 → retryable `upstream_failed`.
- Payload `externalId` carries the videoId (the website's dedup key).

**Note (website dependency, not this unit):** the gospelmedialab.com ingest
endpoint must accept `platform` (default `instagram`) and the author/source links,
and dedup by `(platform, externalId)`. Tracked under Deferred / Dependencies.

---

### U6. YouTube discovery workflow + launch + route handler

**Goal:** The Mastra workflow tying it together: two modes → parse → dedupe →
classify → report → submit, with a discriminated-union result, launch function,
and route handler.

**Requirements:** both modes; filter every video; memory (dedupe); feed review
queue.

**Dependencies:** U1, U2, U3, U4, U5.

**Files:**

- `apps/mastra/src/mastra/workflows/youtube-ai-christian-discovery.ts` (new)
- `apps/mastra/src/mastra/workflows/youtube-ai-christian-discovery.test.ts` (new)

**Approach:** Mirror `instagram-ai-christian-discovery.ts` structure: injectable
`runYouTubeDiscovery(rawInput, options)` returning a discriminated union; Mastra
steps (`collect-candidates` → `parse-and-filter` → `report-and-persist`); a
`launchYouTubeDiscoveryWorkflow`; a `handleYouTubeDiscoveryRouteRequest` with the
`isValidServiceBearer` guard and the same status mapping (200 / 400 invalid_input /
503 config_missing / 502 all_sources_failed). Input schema:
`{ channels: string[] (default []), queries: string[] (default DEFAULT_QUERIES),
limitPerChannel: int (default 10), limitPerQuery: int (default 10),
maxResults: int (default 50), persistArtifact: bool (default true) }`. The collect
step runs each channel (resolve uploads → list videos) and each query (search),
collecting per-source failures; fails the run only when **every** source errored
(`all_sources_failed`) and `config_missing` when `YOUTUBE_API_KEY` is absent.
Dedupe by videoId; classify via the shared `classifyContent`/`qualifies`; cap at
`maxResults`; count `excludedCommentary`. Submit via U5 best-effort (a site outage
never fails the run); log `[youtube-discovery] event=site_ingest inserted=N skipped=M`.

**Patterns to follow:** `instagram-ai-christian-discovery.ts` end-to-end — the
failure-error-prefix mechanism, `selectQualifying*`, best-effort `submitToReviewQueue`,
the three `createStep` definitions, and the route handler.

**Test scenarios:**

- Trusted-channel mode: mocked channel resolve + playlist list → qualifying videos
  returned, artifact written. _Covers AE: trusted channel yields candidates._
- Keyword mode: mocked search → qualifying videos; non-qualifying (AI-only or
  Christian-only) dropped.
- Commentary video excluded and counted in `excludedCommentary`.
- Dedupe: same videoId from a channel and a query appears once; `deduped` total
  reflects it.
- Submits only qualified videos to the site (injected `submitPosts` asserts the
  platform + payload); does not submit when site ingest is not configured.
- `config_missing` when `YOUTUBE_API_KEY` absent (no API calls made).
- `all_sources_failed` (retryable) when every channel and query errors; partial
  failure still succeeds with a populated failure list.
- `maxResults` cap respected while commentary counting continues past the cap.
- Route handler: rejects invalid bearer (401); launches on valid bearer (200);
  JSON parse failure → 400; config_missing → 503; all_sources_failed → 502.

---

### U7. Register workflow + route; documentation

**Goal:** Wire the workflow and route into the Mastra app and document the new
env vars and endpoint.

**Requirements:** operability.

**Dependencies:** U6.

**Files:**

- `apps/mastra/src/mastra/index.ts` (modify)
- `apps/mastra/CLAUDE.md` (modify)
- `apps/mastra/.env.example` (modify — confirm YouTube vars present from U1)

**Approach:** Import and add `youtubeAiChristianDiscoveryWorkflow` to `workflows`,
and register `POST /forge-youtube-discovery` using the same
`handle…RouteRequest → new Response(JSON.stringify(...))` block as
`/forge-instagram-discovery`. Add the three YouTube env vars to the CLAUDE.md env
table and a short "YouTube AI/Christian discovery" section (endpoint, two modes,
keyword-heuristic limitation, that it submits to the site review queue with a
platform label).

**Patterns to follow:** the `/forge-instagram-discovery` registration block in
`index.ts` and the Instagram section in `CLAUDE.md`.

**Test scenarios:** `Test expectation: none` — registration + docs wiring; behavior
is covered by U6's route-handler tests. (A reviewer confirms the route appears and
the workflow is listed.)

**Verification:** `pnpm --filter @forge/mastra typecheck`, `lint`, and `test` pass;
`POST /forge-youtube-discovery` with a valid service bearer returns
`{ result: { ok: true, posts: [...] } }` against a real key in Studio; no/invalid
bearer → 401.

---

## Scope Boundaries

### Deferred to Follow-Up Work

- **Read the trusted-channel list from the website "Sources" section** (D5). The
  workflow takes `channels` as input now; wiring a fetch from the site endpoint is
  a fast-follow once that endpoint exists.
- **Migrate Instagram's own site submission onto the shared `submitCandidatesToSite`**
  (D3). Low-risk consolidation; not required for YouTube to ship.
- **Pinterest discovery workflow** — the next platform after YouTube.

### Outside this product's identity

- Auto-publishing to the public site without human approval.

---

## Dependencies (website / Vlad — not in this plan's code)

- Extend the gospelmedialab.com ingest endpoint to accept `platform` (default
  `instagram`) and author/source links, and dedup by `(platform, externalId)`
  — backward-compatible with current Instagram submissions.
- Add the "Sources" management section to the review page (manage channels).
- Render the author name as a clickable link (the Instagram attribution-link fix),
  which this plan enables by sending the link.

---

## System-Wide Impact

- **apps/mastra:** one new workflow + route, one new external API client, a shared
  discovery module (classifier relocation touches the Instagram workflow's import
  only). Instagram behavior unchanged.
- **gospelmedialab.com (separate repo, Vlad):** backward-compatible ingest payload
  extension + review-page "Sources" + attribution rendering.
- **Operators:** a new `YOUTUBE_API_KEY` to provision; a new `/forge-youtube-discovery`
  endpoint to run/schedule.

---

## Risks & Mitigations

- **YouTube API quota** (default 10k units/day; `search.list` costs 100 units each).
  Mitigation: prefer trusted-channel mode (cheap `playlistItems`/`channels` calls);
  keep keyword `queries` small by default; `rate_limited` is retryable.
- **Classifier relocation regressions.** Mitigation: move tests with the code; keep
  Instagram workflow tests green (U2 execution note).
- **Website contract drift** (platform/dedup). Mitigation: backward-compatible
  default `platform: "instagram"`; document the `(platform, externalId)` dedup key
  in both the client and the endpoint.
