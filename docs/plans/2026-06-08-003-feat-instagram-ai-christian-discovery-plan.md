---
title: "feat: Instagram AI-generated Christian video discovery workflow (Firecrawl)"
type: feat
status: active
created: 2026-06-08
depth: standard
---

# feat: Instagram AI-Generated Christian Video Discovery Workflow (Firecrawl)

## Problem & Context

We want a Mastra workflow in `apps/mastra` that discovers AI-generated Christian
videos on Instagram and returns a structured list of posts with metadata,
author info, and a best-effort published date. Discovery uses **Firecrawl web
search** (`POST /v1/search`) rather than direct crawling because Instagram is
heavily gated — search returns Instagram post/reel URLs plus title/snippet, and
optional per-result scraping can enrich metadata.

Decisions confirmed with the user (origin design: an approved pre-plan design
doc):

- **Discovery**: Firecrawl web search; operator passes query terms with Studio-friendly defaults.
- **Classification**: keyword/heuristic only — no LLM. Match AI-generation and Christian keyword signals over caption/title/hashtags. Qualifies only when both match.
- **Output**: return the list in the HTTP/workflow response **and** write a timestamped JSON artifact under Mastra storage (mirrors the `offline-search-eval` artifact pattern).

This is greenfield — there is no existing Firecrawl usage in the repo. The
workflow stays self-contained in `apps/mastra`: no Admin ingest contract, no
imports from other apps (per `apps/mastra/CLAUDE.md` architecture rules).

---

## Requirements

- R1. Discover candidate Instagram posts via Firecrawl `/v1/search` from operator-supplied queries (with defaults), tolerant to per-query failures.
- R2. Parse each Firecrawl hit into a normalized Instagram post: canonical URL, shortcode, media type, author handle/name, caption, hashtags, thumbnail, best-effort `publishedAt`.
- R3. Filter posts via keyword heuristics; keep only posts that signal **both** AI-generation and Christian content. Dedupe by shortcode; cap at `maxResults`.
- R4. Return the qualified post list in the workflow/route response and (by default) persist a validated JSON artifact under Mastra storage.
- R5. Guard the HTTP route with the existing service-bearer mechanism; expose the workflow in Studio with no-JSON-needed defaults.
- R6. New env vars are optional/defaulted and never added to production-required asserts (opt-in tool, not always-on path).

Success criteria: an operator can run the workflow from Studio with defaults (given a Firecrawl key), receive a list of qualified Instagram posts in the response, and find a matching JSON artifact on disk. Missing key → typed `config_missing` failure, not a crash.

---

## Key Technical Decisions

- **Firecrawl `/v1/search` as the discovery seam.** Search returns `{ success, data: [{ url, title, description, markdown?, metadata? }] }`. Direct Instagram crawling is unreliable; search yields URLs + snippet metadata that the keyword heuristic can act on.
- **Keyword/heuristic classification, no LLM.** Cheaper, no extra provider dependency. Trade-off: noisier than an LLM classifier — explicitly documented. Word-boundary matching for short tokens (`ai`, `god`) to suppress false positives (`said`, `goddess`).
- **`publishedAt` is best-effort.** Instagram search snippets rarely carry a reliable timestamp. Populated only from scrape metadata (`article:published_time` / og) when present; otherwise `null`. Documented in code + docs + the run summary.
- **Discriminated-union result shape** (`z.discriminatedUnion("ok", [...])`) mirroring `src/mastra/workflows/scene-embedding.ts`, so Studio records typed success/failure.
- **Per-query resilience.** One failing query does not abort the run; failures are collected. Only `all_queries_failed` when every query errors.

---

## Patterns To Follow

- Typed HTTP client w/ retry+timeout+typed error: `apps/mastra/src/services/offline-search-eval/judge.ts` (attempt loop, `AbortSignal.timeout`, `retry-after`, typed `code` union) and `apps/mastra/src/services/embedding-provider.ts` (`EmbeddingProviderError`, status→retryable mapping).
- Atomic JSON artifact store: `apps/mastra/src/services/offline-search-eval/artifacts.ts` (`assertSafeName`, tmp-file + `rename`, `ENOENT`→`not_found`, Zod-validate on read/write, `getMastraStorageDir()` root).
- Workflow shape + route handler + launch fn + service-bearer guard + status mapping: `apps/mastra/src/mastra/workflows/scene-embedding.ts`.
- Env config (schema + `process.env` map via `emptyToUndefined` + getter): `apps/mastra/src/config/env.ts`.
- Route registration: `apps/mastra/src/mastra/index.ts` (`registerApiRoute("/forge-*", ...)` blocks).

---

## Output Structure

```
apps/mastra/src/
├── config/env.ts                                   # (modified) Firecrawl + artifact-dir vars + getFirecrawlConfig()
├── services/
│   ├── firecrawl-search-client.ts                  # (new) typed Firecrawl /v1/search client
│   ├── firecrawl-search-client.test.ts             # (new)
│   └── instagram-discovery/
│       ├── types.ts                                # (new) InstagramPost, DiscoveryReport, MatchSignals
│       ├── post-parser.ts                          # (new) isInstagramUrl, parseInstagramPost
│       ├── post-parser.test.ts                     # (new)
│       ├── classifier.ts                           # (new) keyword lists + classifyPost
│       ├── classifier.test.ts                      # (new)
│       ├── artifacts.ts                            # (new) DiscoveryReportSchema + store
│       └── artifacts.test.ts                       # (new)
└── mastra/
    ├── index.ts                                    # (modified) register workflow + /forge-instagram-discovery
    └── workflows/
        ├── instagram-ai-christian-discovery.ts     # (new) workflow + steps + launch + route handler
        └── instagram-ai-christian-discovery.test.ts# (new)
```

---

## Implementation Units

### U1. Env config for Firecrawl + artifact dir

**Goal:** Add optional/defaulted env vars and a `getFirecrawlConfig()` getter.
**Requirements:** R1, R6.
**Dependencies:** none.
**Files:** `apps/mastra/src/config/env.ts`, `apps/mastra/src/config/env.test.ts`, `apps/mastra/.env.example`.
**Approach:** Add to `envSchema`: `FIRECRAWL_API_KEY` (`z.string().min(1).optional()`), `FIRECRAWL_API_BASE_URL` (`z.string().url().default("https://api.firecrawl.dev")`), `FIRECRAWL_SEARCH_TIMEOUT_MS` (`z.coerce.number().int().positive().max(120_000).default(60_000)`), `INSTAGRAM_DISCOVERY_ARTIFACT_DIR` (`z.string().min(1).optional()`). Wire each through the `process.env` map with `emptyToUndefined`. Add `getFirecrawlConfig()` → `{ apiKey, baseUrl, timeoutMs }`. Do **not** add any of these to `assertMastraRuntimeEnv()`.
**Patterns to follow:** existing optional vars + getters in `env.ts`.
**Test scenarios:**

- `getFirecrawlConfig()` returns defaults (base URL, 60_000 timeout) when only the key is set.
- `assertMastraRuntimeEnv()` in production with all existing required vars present but no Firecrawl vars does **not** throw (regression guard for the opt-in rule).

### U2. Firecrawl search client

**Goal:** Typed client for `POST /v1/search` with retry/timeout and a typed error class.
**Requirements:** R1.
**Dependencies:** U1.
**Files:** `apps/mastra/src/services/firecrawl-search-client.ts`, `apps/mastra/src/services/firecrawl-search-client.test.ts`.
**Approach:** Export `class FirecrawlSearchError` (`code: "config_missing" | "auth_failed" | "rate_limited" | "upstream_failed" | "invalid_response"`, `retryable`). `requestFirecrawlSearch(query, { apiKey, baseUrl, limit, timeoutMs, scrape?, fetchImpl? })`: `POST {baseUrl}/v1/search`, `Authorization: Bearer`, body `{ query, limit, ...(scrape ? { scrapeOptions: { formats: ["markdown"], onlyMainContent: true } } : {}) }`. Attempt loop with exponential backoff + `retry-after` (mirror judge.ts). Status mapping: `401/403`→`auth_failed` (non-retryable), `429`→`rate_limited` (retryable), `>=500`→`upstream_failed` (retryable), other non-ok → `upstream_failed` non-retryable. Tolerant Zod parse with `.passthrough()` on result items; normalize to `FirecrawlSearchHit[]` (`{ url, title?, description?, markdown?, metadata? }`). Throw `config_missing` if key absent.
**Patterns to follow:** `offline-search-eval/judge.ts` retry loop; `embedding-provider.ts` status→retryable.
**Test scenarios (inject `fetchImpl`):**

- Happy path: 200 with `{ success: true, data: [...] }` → normalized hits; unknown extra fields tolerated via passthrough.
- Missing `apiKey` → throws `FirecrawlSearchError` code `config_missing` before any fetch.
- 401 → `auth_failed`, non-retryable. 429 → `rate_limited`, retryable, retried up to max attempts then throws. 500 → `upstream_failed` retryable. Malformed JSON / missing `data` → `invalid_response`.
- Backoff sleep is injected (no real timers in tests).

### U3. Instagram post parser + types

**Goal:** Normalize Firecrawl hits into `InstagramPost`; identify Instagram URLs.
**Requirements:** R2.
**Dependencies:** U2 (for `FirecrawlSearchHit` type).
**Files:** `apps/mastra/src/services/instagram-discovery/types.ts`, `apps/mastra/src/services/instagram-discovery/post-parser.ts`, `apps/mastra/src/services/instagram-discovery/post-parser.test.ts`.
**Approach:** `isInstagramUrl(url)`: host in `{instagram.com, www.instagram.com}` and path matches `/(p|reel|tv)/<shortcode>` or `/{handle}/(p|reel|tv)/<shortcode>`. `parseInstagramPost(hit)` → `{ url (canonical `https://www.instagram.com/<type>/<shortcode>/`), shortcode, mediaType ("post"|"reel"|"tv"), authorHandle (URL segment or title prefix `Name (@handle)`), authorName, caption (description ?? title ?? markdown, trimmed/bounded), hashtags (`/#[\w.]+/g`), publishedAt (best-effort from `metadata["article:published_time"]`/`og:...` else null — code comment notes the limitation), thumbnailUrl (`metadata["og:image"]` else null) }`. Return `null` for non-Instagram or shortcode-less hits.
**Patterns to follow:** plain pure functions; bounded strings like artifacts.ts caps.
**Test scenarios:**

- `isInstagramUrl`: true for `/p/`, `/reel/`, `/tv/`, `/{handle}/p/`; false for non-instagram host, profile-only URL, story URL.
- `parseInstagramPost`: extracts shortcode + canonical URL; handle from URL segment; handle/name from `Name (@handle) • Instagram` title; hashtags extracted; `publishedAt` from metadata when present, else `null`; thumbnail from `og:image`; returns `null` for non-Instagram hit.

### U4. Keyword classifier

**Goal:** Decide AI-generated + Christian via keyword heuristics.
**Requirements:** R3.
**Dependencies:** U3.
**Files:** `apps/mastra/src/services/instagram-discovery/classifier.ts`, `apps/mastra/src/services/instagram-discovery/classifier.test.ts`.
**Approach:** Constant `AI_KEYWORDS` (`ai`, `ai-generated`, `aigenerated`, `midjourney`, `sora`, `runway`, `veo`, `kling`, `pika`, `generative`, `made with ai`, `#aiart`, …) and `CHRISTIAN_KEYWORDS` (`jesus`, `christ`, `christian`, `gospel`, `bible`, `scripture`, `faith`, `god`, `prayer`, `holy spirit`, `church`, `psalm`, …). `classifyPost(post)` builds a normalized lowercase haystack from caption + hashtags, matches each keyword (word-boundary regex for short/ambiguous tokens like `ai`, `god`), returns `{ isAiGenerated, isChristian, matchedAi: string[], matchedChristian: string[] }`. Qualifies when both true.
**Patterns to follow:** pure function + exported constants.
**Test scenarios:**

- Caption "AI-generated film of Jesus walking #aiart #faith" → both true, matched lists populated.
- Only-AI caption → `isChristian` false (not qualified). Only-Christian caption → `isAiGenerated` false.
- Word-boundary guards: "he said goddess prayed" does **not** match `ai` or `god`. "GOD is good, made with Midjourney" → both true (case-insensitive).
- Empty caption + no hashtags → both false.

### U5. Discovery artifact store

**Goal:** Validate + atomically persist/read `DiscoveryReport` JSON.
**Requirements:** R4.
**Dependencies:** U3.
**Files:** `apps/mastra/src/services/instagram-discovery/artifacts.ts`, `apps/mastra/src/services/instagram-discovery/artifacts.test.ts` (and `DiscoveryReport`/`InstagramPost` schemas/types finalized in `types.ts`).
**Approach:** Copy the shape of `offline-search-eval/artifacts.ts`: `DiscoveryReportSchema` (`.strict()`, bounded `.max()` on every array/string), `InstagramPostSchema`, `assertSafeName`, atomic `writeJson` (tmp + `rename`), `createInstagramDiscoveryArtifactStore(rootDir)` exposing `writeReport`/`readReport`; `instagramDiscoveryArtifactRoot()` = `INSTAGRAM_DISCOVERY_ARTIFACT_DIR ?? path.join(getMastraStorageDir(), "instagram-discovery")`. Typed `InstagramDiscoveryArtifactError` with `code` union mirroring the search-eval one.
**Patterns to follow:** `offline-search-eval/artifacts.ts` verbatim shape.
**Test scenarios:**

- write → read round-trip returns an equal validated report.
- Invalid artifact name (path traversal / unsafe chars) → `invalid_name`.
- Read missing report → `not_found`. Read malformed JSON → `invalid_artifact`. Write a report violating schema bounds → `invalid_artifact`.

### U6. Discovery workflow + launch + route handler

**Goal:** Orchestrate search → parse/filter → report/persist; expose launch + route handler.
**Requirements:** R1–R5.
**Dependencies:** U2, U3, U4, U5.
**Files:** `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.ts`, `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.test.ts`.
**Approach:** Input schema (strict, defaults): `queries` (`.min(1).max(20).default([...two default IG-targeted queries...])`), `limitPerQuery` (`.max(50).default(10)`), `scrapeMetadata` (`.default(false)`), `maxResults` (`.max(200).default(50)`), `persistArtifact` (`.default(true)`). Three `createStep`s: (1) `search-instagram-candidates` — run each query through `requestFirecrawlSearch`, collect hits, collect per-query failures, return `config_missing` failure if key absent; (2) `parse-and-filter` — `parseInstagramPost` over Instagram hits, drop non-IG, dedupe by shortcode, `classifyPost`, keep qualifying, cap at `maxResults`; (3) `report-and-persist` — build `DiscoveryReport` (runId, startedAt/finishedAt, queries, totals {candidates, instagram, deduped, qualified}, queryFailures, posts), write via store when `persistArtifact`, return success. Output `z.discriminatedUnion("ok", [Success, Failure])`: Success `{ ok:true, mastraRunId, totals, posts, artifactPath? }`; Failure `{ ok:false, reason: "invalid_input"|"config_missing"|"all_queries_failed", retryable, mastraRunId, details? }`. Export `instagramAiChristianDiscoveryWorkflow`, `launchInstagramDiscoveryWorkflow`, `handleInstagramDiscoveryRouteRequest` (service-bearer guard via `isValidServiceBearer`, status mapping: 200 / 400 invalid_input / 401 bearer / 502 all_queries_failed / 503 config_missing), input/output schemas, `_internals`.
**Patterns to follow:** `scene-embedding.ts` (steps, launch, route handler, status mapping, bearer guard).
**Execution note:** Inject `fetchImpl`/client + artifact store via options so tests run without network or real FS root.
**Test scenarios:**

- Happy path (injected fetch returning IG + non-IG hits, one AI+Christian, one only-AI): success, `posts` contains only the qualified post, non-IG dropped, artifact written (assert `artifactPath`).
- Missing Firecrawl key → `config_missing`, route status 503.
- Every query errors (injected fetch throws/4xx) → `all_queries_failed`, route status 502.
- Dedupe: same shortcode from two queries → one post.
- `persistArtifact:false` → success with no `artifactPath`, store not called.
- Invalid input (e.g. `limitPerQuery: 0`) → `invalid_input`, route 400.
- Route handler: missing/invalid bearer → 401 before any work.

### U7. Register workflow + route; docs

**Goal:** Wire the workflow into the Mastra instance and document it.
**Requirements:** R4, R5.
**Dependencies:** U6.
**Files:** `apps/mastra/src/mastra/index.ts`, `apps/mastra/CLAUDE.md`.
**Approach:** Import + add `instagramAiChristianDiscoveryWorkflow` to `workflows`. Add `registerApiRoute("/forge-instagram-discovery", { method: "POST", handler })` calling `handleInstagramDiscoveryRouteRequest({ authHeader, serviceKeys, readJson })`, same `new Response(JSON.stringify(...))` block as sibling routes. In `apps/mastra/CLAUDE.md`: add the four env vars to the env table + an "Instagram AI/Christian discovery" section (route, defaults, keyword-heuristic limitation, best-effort `publishedAt`).
**Patterns to follow:** existing `/forge-*` route blocks in `index.ts`.
**Test scenarios:** Test expectation: none — wiring/docs only; behavior is covered by U6's route-handler tests. Verified by typecheck/lint/build and the local Studio smoke.

---

## System-Wide Impact

- New optional env vars only; no change to existing required-env asserts → no Railway deploy risk for envs without a Firecrawl key.
- New `/forge-instagram-discovery` route behind the existing service-bearer allowlist; no new auth surface.
- New writable artifact subdir under Mastra storage (`instagram-discovery/`), same volume already used by search-eval.
- No Admin/manager/auth coupling; no schema/codegen changes.

---

## Scope Boundaries

### In scope

- Firecrawl-search-based discovery, keyword classification, response + artifact output, Studio-runnable workflow, service-bearer route.

### Deferred to Follow-Up Work

- Optional LLM confirmation step (behind a flag, reusing the judge.ts OpenRouter pattern) to cut keyword false positives.
- Pushing discovered posts into Admin (no contract exists today).
- Optional roadmap ticket under `docs/roadmap/platform/`.

### Non-goals

- Direct Instagram crawling/login/scraping of gated pages.
- Reliable per-post published-date extraction (Instagram does not expose it via search; `publishedAt` is best-effort).
- Storing/deduping results across runs (each run is independent).

---

## Verification

- `pnpm --filter @forge/mastra test` — all new colocated vitest suites green (client status branches, parser IG/non-IG + extraction, classifier qualify/false-positive guards, artifacts round-trip + error branches, workflow happy/failure/dedupe/bearer paths).
- `pnpm --filter @forge/mastra typecheck` and `pnpm --filter @forge/mastra lint` clean.
- Local Studio smoke (real key):
  ```
  MASTRA_STORAGE_BACKEND=memory MASTRA_SERVICE_API_KEYS=local-key \
  FIRECRAWL_API_KEY=fc-... INSTAGRAM_DISCOVERY_ARTIFACT_DIR=.mastra/storage/instagram-discovery \
  pnpm --filter @forge/mastra dev
  ```
  Open `http://localhost:4111/studio/workflows/instagram-ai-christian-discovery`, run defaults, confirm posts returned + artifact written.
- Route smoke: `curl -X POST localhost:4111/forge-instagram-discovery -H 'authorization: Bearer local-key' -H 'content-type: application/json' -d '{}'` → 200 `{ result: { ok: true, posts: [...] } }`; no/invalid bearer → 401.
