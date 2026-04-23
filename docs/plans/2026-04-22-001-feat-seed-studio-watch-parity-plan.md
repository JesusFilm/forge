---
title: "feat: seed-studio generator matches /watch/<slug> visual quality"
type: feat
status: active
date: 2026-04-22
---

# Seed Studio → /watch Parity Generator

## Enhancement Summary

**Deepened on:** 2026-04-22
**Sections enhanced:** architecture, pipeline shape, performance, security, unit list
**Review agents used:** architecture-strategist, code-simplicity-reviewer, performance-oracle, security-sentinel, framework-docs-researcher (OpenRouter/SSE/fan-out), repo explorer (semantic-search), learnings-researcher

### Key Improvements From Deepening

1. **Pipeline simplified:** single strict-JSON-Schema call against the fixed template replaces the proposed two-stage plan+fill. Template rigidity (not orchestration complexity) is doing the work. Fan-out is retained only as a measured fallback if the single-shot fails quality benchmarks.
2. **Shared template package:** `packages/experience-templates/` becomes the single source of truth for the Section/Archetype types, the `EASTER_SHAPED_TEMPLATE` constant, the `backgroundColor` enum, and the alias map. `apps/web`, `apps/seed-studio`, and future `apps/mobile` consume from it.
3. **No new search endpoint:** the existing `GET /api/search` (already rate-limited) is consumed directly by seed-studio's server code; a single semantic call replaces the per-keyword loop in `extractKeywords`.
4. **SSE collapsed to a single `patch` event:** `{ path, value }` tuple applied to a single `experienceSnapshot` atom — gives progressive reveal without a per-feature event-type explosion.
5. **Parity check becomes a CLI script** (`apps/seed-studio/scripts/parity-check.ts`) plus the solutions doc — dev tooling, not product UI.
6. **Performance fixes baked in:**
   - Lazy-init HLS with `<video preload="none" poster=…>` and IntersectionObserver; cap 2 concurrent players via LRU-destroy; autoplay only for VideoHero.
   - Batched `patchNestedVideoRelations` with a single `UPDATE … FROM (VALUES …)` inside a Strapi transaction (closes TOCTOU and collapses N round-trips).
   - SSE heartbeat every 15s to survive Railway gateway idle-timeouts.
   - `p-limit(4)` on any fan-out path; 6s per-fill timeout + boilerplate fallback.
7. **Security fixes baked in:**
   - `streamClaude` switched from `-p` flag to stdin (removes flag-injection surface).
   - `import "server-only"` on generator module + ESLint rule forbidding `OPENROUTER` in `components/`.
   - Central `sanitizeSlug(input)` with reserved-word deny-list, applied at every slug boundary.
   - Moderation pass on generated `heading`/`contentParagraphs`/`bibleQuote.text` before public publish (or gate behind a Draft state).
   - Constant-time `X-Seed-Studio-Token` comparison; scrub from URLs/logs.
   - Per-IP/per-day cost counter replaces the per-hour rate limiter (theatre).

### New Considerations Discovered

- HLS player memory footprint at 20 videos/page (~500MB) is the biggest single risk and would be unreleasable without the lazy-init + LRU cap above.
- `streamClaude` spawns `docker exec claude -p "$prompt"` — the plan amplifies an existing flag-injection surface. Fix gates this feature.
- Strapi v5 has a per-connection GUC pattern (`config/database.ts` afterCreate) already in place for pgvector; we don't need to wrap every query in a transaction unless we later add `SET LOCAL hnsw.ef_search` tuning.
- `/api/search` already exists with rate limiting (`/Users/up/Projects/forge/apps/cms/src/api/search/routes/search.ts:5`). No new search endpoint.

---

## Overview

Redesign `apps/seed-studio`'s AI experience generator so that its published output on `/watch/<slug>` renders with the same visual richness and layout fidelity as the hand-crafted `/watch/easter` reference. Today the generator emits a flat list of sections (`sections.video-hero`, `sections.text`, `sections.video`, `sections.bible-quotes-carousel`, etc.); `/watch/easter` instead uses a 13-block template dominated by `ComponentSectionsSection` wrappers, each containing a nested `content[]` dynamic zone (Video + Container-with-BibleQuotes + QuizButton), interspersed with `ComponentSectionsVideoCarousel` and `ComponentSectionsMediaCollection`. The seed-studio prompt, schema, parser, preview, and publish path all lack `sections.section`, `backgroundColor`, `sectionKey` enforcement, nested relation patching, and semantic video ranking. This plan closes those gaps with a **single strict-JSON-Schema call against a fixed code template** plus **semantic video pre-ranking**.

The result: a user types "forgiveness" in the studio chat, sees a skeleton within ~2s and the full preview within ~10s, clicks Save to Strapi, then Preview, and lands on `http://localhost:3000/watch/forgiveness` where the hero plays, every video section has a functioning Mux player, BibleQuotes carry the chosen scripture with backgrounds, and Container/MediaCollection/NavigationCarousel render correctly — matching the shape of `/watch/easter`.

## Problem Statement

The current seed-studio generator diverges from the production `/watch` templates in four load-bearing ways:

1. **Structural mismatch.** `ComponentSectionsSection` (the wrapper with `backgroundColor`, `sectionKey`, and a nested `content` dynamic zone) is the primary visual unit on `/watch/easter` (12 of 13 blocks). Seed-studio's schema has no wrapper type at all. Generated experiences render as visually flat pages lacking the alternating background tones and chapter-like anchoring that define the easter experience. Preview SectionRenderer has no case for `sections.section` and returns `null`.

2. **Component coverage gap.** Production pages use `MediaCollection` (variant: collection/grid/hero/carousel/player), `NavigationCarousel` (chapter anchor links), `CTA`, `PromoBanner`, `InfoBlocks`, `Card`. Seed-studio's prompt doesn't mention them, the TypeScript schema doesn't define them, and the preview SectionRenderer doesn't render them. The AI is simply unable to produce them.

3. **Weak model contract.** The prompt hands the model a free-form code-block (` ```experience ... ``` `) and hopes for valid JSON. There is no JSON Schema, no retry, and no enum constraint on `video` IDs — so the LLM routinely (a) omits `sectionKey` (which breaks `patchNestedVideoRelations` on save, leaving `video: null` on `ComponentSectionsVideo` entries even after streamingUrl is set), (b) makes up videoIds not in the catalog, and (c) writes thin copy because the schema doesn't specify minimum lengths or counts.

4. **Keyword-only video search.** `searchVideos` in `apps/cms/src/api/seed-studio/services/seed-studio.ts:48` uses PostgreSQL `ILIKE` on title/description/slug. A query for "forgiveness" misses clearly relevant content like "Talk with Nicodemus" unless the word literally appears in the title. The forge codebase already runs a hybrid `semanticSearch` service (RRF-fused pgvector + FTS) at `GET /api/search` (`apps/cms/src/api/search/routes/search.ts:5`) that produces dramatically better candidate ranking — but seed-studio doesn't call it.

The compounded effect: users generate an experience, publish it, open the preview, and see a visually thin page where the videos either don't play (missing relation → `useRouteVideo: false` and `video: null` → web `Video.tsx` logs "Missing streaming URL") or are weakly-matched to the theme. The studio output is demonstrably inferior to `/watch/easter`.

## Proposed Solution

Adopt a **template-slot architecture** plus a **single strict-JSON-Schema call** plus **hybrid semantic video pre-ranking**:

1. **Fixed template skeleton in a shared package.** Introduce `packages/experience-templates/` exporting a typed `EASTER_SHAPED_TEMPLATE` constant that describes the exact layout (1 VideoHero + N×Section wrappers, each Section predeclaring its nested content recipe). The LLM never sees or generates the structural outline — it only fills `{title, heading, contentParagraphs, videoId, bibleQuote, Q&A}` into named slots. Same package exports the `SectionBlock` discriminated union, `backgroundColor` enum, alias map, and a pure `parityDiff(expected, actual)` helper. Both `apps/web` (for a future generic renderer) and `apps/seed-studio` (generator + preview + CLI parity check) consume from this package.

2. **Single LLM call, strict JSON Schema, enum-constrained videoIds.** The request body builds a full schema where every `videoId` slot is `{ type: "integer", enum: [candidateIds…] }` — mathematically eliminates hallucination. One call per generation. OpenRouter `response_format.type: "json_schema"`, `strict: true`, `provider.require_parameters: true`. One retry with Zod-error feedback (~1.3–1.8× token cost, 85–95% recovery on enum/type violations per 2026 industry data). Legacy free-form path stays for Ollama/Codex/Exo but with the same sanitization layer around generated text.

3. **Semantic video pre-ranking via existing `/api/search`.** Before the LLM call, seed-studio hits the existing `GET /api/search?q=<theme>&locale=en&type=video&limit=20` endpoint (already rate-limited, no new endpoint needed). Gets a top-20 RRF-fused candidate list with similarity scores. Partitions candidates per Section in the generator based on archetype (carousel gets top-5, each video-centric gets a bucket of 3–5). Embeds the user query once (~$0.0000004, 120–240ms total including FTS).

4. **Section wrapper + missing-component rendering parity.** The shared package's types include `SectionWrapper`, `MediaCollection`, `NavigationCarousel`, `Card`, `CTA`, `InfoBlocks`, `PromoBanner`. Preview components for each. `use-chat.ts` parser normalizes aliases (or drops them once strict mode is the only path). Server-side publisher's `collectVideoRelations` walker in `apps/cms/src/api/seed-studio/services/seed-studio.ts:199` gets unit-tested against the real `/watch/easter` GraphQL payload (it already recurses into any array-valued `__component`-bearing property; just needs proof). A batched `UPDATE … FROM (VALUES …)` replaces per-row UPDATEs.

5. **Progressive UX via a single `patch` SSE event.** One event type: `{ path: string[], value: unknown }`. The generator emits patches as it produces the tree (skeleton first, then fills). Client applies patches to a single `experienceSnapshot` atom. Heartbeat comment (`: ping\n\n`) every 15s keeps Railway's gateway happy. Avoids proliferating `plan`/`section-filled`/`done`/`chunk` events into a protocol.

6. **Dev-tooling parity check as a CLI script.** `apps/seed-studio/scripts/parity-check.ts` fetches the published experience from Strapi GraphQL, runs `parityDiff(EASTER_SHAPED_TEMPLATE, experience)` from the shared package, and prints a structural diff. Not shipped into the React app. Used during implementation to close the prompt-tuning loop.

## Technical Approach

### Architecture

```
User chat query
      ▼
/api/chat  (apps/seed-studio server route)
      │
      ├─► GET /api/search?q=<theme>&locale=en&type=video  (cms, already exists)
      │     └─► pgvector HNSW + FTS RRF fusion → top-20 candidates with scores
      │
      ├─► Build strict JSON Schema from EASTER_SHAPED_TEMPLATE
      │     where every videoId slot is enum([ids from top-20 partitioned per section])
      │
      ├─► POST https://openrouter.ai/api/v1/chat/completions
      │     response_format: { type: "json_schema", strict: true, ... }
      │     provider: { require_parameters: true }
      │     signal: AbortSignal.any([req.signal, timeout(25000)])
      │     (1 retry with Zod error feedback on 5xx / schema failure)
      │
      └─► SSE stream
            {patch: ["skeleton"], value: templateSkeleton}    after search
            {patch: ["experience"], value: filledExperience}  after LLM returns
            heartbeats every 15s (`: ping\n\n` comments)

Preview renders via shared SectionRenderer (progressive merge via JSON Patch)

Save → Strapi /api/seed-studio/publish-experience (unchanged external contract)
   └─► DB TRANSACTION:
         create Experience via Document Service
         collectVideoRelations (recursive walker; proven by unit tests)
         single batched SQL: UPDATE components_sections_videos
           SET video_id = v.video_id
           FROM (VALUES (id1, vid1), (id2, vid2), ...) AS v(comp_id, video_id)
           WHERE id = v.comp_id
   └─► moderate generated text (OpenAI mod endpoint) → on flag, publish as Draft
```

### Template Shape (derived from `/watch/easter`)

The easter reference is 1 VideoHero + 12 Sections, where Sections follow three archetypes:

- **Introduction** (1×): content = `[NavigationCarousel, Container, Video, Container, BibleQuotesCarousel, QuizButton]`
- **Video-centric** (8× recurring): content = `[Video, Container (with BibleQuotes inside a slot), QuizButton]`
- **Carousel / Collection** (3× interspersed): content = `[VideoCarousel]` or `[MediaCollection]`

Our V1 template generalizes to: 1 VideoHero + 1 Introduction Section + 2–3 Carousel/Collection Sections + 4–6 Video-centric Sections. Count flexes based on how many distinct video candidates `/api/search` returns (floor 4 video-centrics, ceil 6). `platformOrdering` is computed deterministically from the generated order. **Editors can override `platformOrdering` in Strapi admin** and republish preserves overrides unless the user explicitly regenerates (tracked via a `generatedAt` field on the Experience).

### Implementation Phases

#### Phase 1: Shared package + schema + preview coverage

- Create `packages/experience-templates/` with: `types.ts` (SectionBlock union, SectionWrapper, MediaCollection, NavigationCarousel, Card, CTA, InfoBlocks, PromoBanner, AdventCountdown, EasterDates, backgroundColor enum), `template.ts` (EASTER_SHAPED_TEMPLATE + ARCHETYPES constants), `aliases.ts` (COMPONENT_ALIASES), `parity.ts` (pure structural diff helper).
- Update `apps/seed-studio/package.json` to depend on the new package.
- Migrate seed-studio's `experience-schema.ts` to re-export from the package.
- Extend `SectionRenderer.tsx` in preview to render `sections.section` (recursive into `content`), `sections.media-collection`, `sections.navigation-carousel`, `sections.cta`, and the other missing types. Mirror styling tokens from `apps/web/src/components/sections/*.tsx` so preview matches web.
- Update `use-chat.ts` to: normalize `section` / `wrapper` aliases to `sections.section`; backfill `sectionKey` deterministically from position (`<theme>-<archetype>-<i>`); Zod-validate the final experience; emit inline error on failure.

**Success criteria:** The `/watch/easter` GraphQL payload, pasted into the studio preview as-is, renders identically in shape (block count, nesting, sectionKeys preserved) to what `/watch/easter` produces on the web.

#### Phase 2: Batched + transactional publish + walker proof

- Unit-test `collectVideoRelations` against the real `/watch/easter` GraphQL fixture; assert every `sections.video` is reachable. Add a warning branch when any is missing `sectionKey`.
- Rewrite `publishExperience` to run create + patch in a Strapi DB transaction; replace per-row UPDATEs with one `UPDATE … FROM (VALUES …)` against `components_sections_videos_video_lnk` (or the direct FK column — verify via `\d` against the dev DB).
- Add central `sanitizeSlug(input)` util that applies `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, clamps to 2–80 chars, enforces a reserved-word deny-list (`admin`, `api`, `watch`, `_next`, `.well-known`). Apply at: studio client, `publishExperience` controller, any future endpoint that accepts slug.
- Audit `apps/web/src/lib/fragments/*.ts` for nested-relation pagination (Strapi v5 truncates to 10 silently); add explicit `pagination: { pageSize: 100 }` on every nested zone.

**Success criteria:** A manually-crafted 10-Section experience with 1 video-relation per Section publishes cleanly; GraphQL confirms every `ComponentSectionsVideo.video` is populated; EXPLAIN ANALYZE shows one UPDATE statement.

#### Phase 3: Single-shot strict-schema generator

- Add capability flag in `apps/seed-studio/src/lib/ai/providers.ts`: `supportsStrictJsonSchema: boolean`.
- Create `apps/seed-studio/src/lib/ai/generator.server.ts` exporting `generateExperience({ query, candidates, provider, model, signal })`. Top of file: `import "server-only"`.
- Build JSON Schema dynamically from the template constant + per-section `videoId` enums from partitioned candidates.
- Request: OpenRouter `response_format: { type: "json_schema", json_schema: { name: "experience", strict: true, schema } }`, `provider.require_parameters: true`, `AbortSignal.any([req.signal, AbortSignal.timeout(25000)])`.
- One Zod-feedback retry on schema failure or 5xx.
- Rewrite `/api/chat/route.ts` to:
  1. `extractKeywords` → combine top-3 into a single query string (simple whitespace join is fine).
  2. Call `GET http://localhost:1337/api/search?q=<combined>&locale=en&type=video&limit=20` with `X-Seed-Studio-Token` header (or confirm `/api/search` allows anon from localhost).
  3. Emit SSE `patch: ["skeleton"]` with the empty template.
  4. Call `generateExperience` with candidates.
  5. Emit SSE `patch: ["experience"]` with the filled tree.
  6. Heartbeat comment every 15s between the search and the LLM response.
- Switch the `streamClaude` fallback from `-p <prompt>` to `--input-format text` + `proc.stdin.write(prompt)` + `proc.stdin.end()` (removes flag-injection surface).
- ESLint rule: forbid `process.env.OPENROUTER` in any file under `apps/seed-studio/src/components/`.

**Success criteria:** For 3 canonical themes (forgiveness, prayer, easter-new), the generator returns schema-valid output with 100% of `videoId` fields resolved to catalog IDs. p50 < 10s, p95 < 20s, $ p50 < $0.025.

#### Phase 4: Moderation + progressive SSE + CLI parity check

- Add a moderation pass in `publishExperience`: flatten generated text fields (`heading`, `contentParagraphs`, `bibleQuote.text`, `questions`), run OpenAI Moderation endpoint (or OpenRouter equivalent), on flag: publish as Draft (`publishedAt = null`) and surface a warning in the save dialog.
- Single SSE event `patch` carrying `{ path, value }` tuple; client applies via a small patch util (20 lines).
- `apps/seed-studio/scripts/parity-check.ts`: CLI that takes a slug, fetches the published experience via GraphQL, runs `parityDiff` from the shared package, prints the block-count / nesting / missing-video diff. Exits non-zero on structural mismatch.
- Write `docs/solutions/best-practices/seed-studio-watch-parity-generator-20260422.md` with template shape, prompt patterns, and pitfalls discovered.

**Success criteria:** Three green parity-check runs for the canonical themes, captured as terminal output in the PR.

#### Phase 5 (optional, contingent on measurement): Fan-out fill

If Phase 3 measurement shows single-shot quality is inadequate (e.g., >20% of sections have thin copy or `contentParagraphs.length < 2`), add a plan + fill fan-out as a fallback path. Guardrails:

- Bounded `p-limit(4)` over Fills; 6s per-Fill timeout with boilerplate fallback.
- Shared `AbortSignal` from the outer request.
- Only enabled for providers with `supportsStrictJsonSchema`.

Fan-out is tested but not on the critical path unless measurement says so.

## System-Wide Impact

### Interaction Graph

```
Studio UI (Next.js client)
  └─► useChat hook → POST /api/chat
       └─► apps/seed-studio route.ts
             ├─► GET /api/search?q=…&locale=en&type=video (cms, existing)
             │     └─► OpenRouter embed (text-embedding-3-small, $0.0000004/call)
             │     └─► pgvector HNSW (partial index per locale) + FTS
             │     └─► RRF fusion + 3-layer dedup (core_id prefix + title + sim >0.95)
             ├─► POST openrouter.ai/v1/chat/completions (strict json_schema)
             │     └─► 1 Zod-feedback retry on schema failure
             └─► SSE stream: patch events + 15s heartbeat

Publish (unchanged external contract):
  └─► POST /api/seed-studio/publish-experience (X-Seed-Studio-Token)
       ├─► sanitizeSlug + reserved-word deny-list
       ├─► moderation pass on flattened text fields
       ├─► DB TRANSACTION:
       │     delete existing published Experience with same slug
       │     create via Document Service
       │     collectVideoRelations walker (proven recursive)
       │     single batched UPDATE … FROM (VALUES …)
       └─► on moderation flag: publishedAt = null + "draft" warning in response
```

### Error Propagation

- `/api/search` returns 0 candidates → fail-fast with SSE `patch: ["error"]` ({code: "NO_CANDIDATES", message: "No matching videos"}). Studio shows inline retry.
- OpenRouter fails (timeout, 5xx, schema mismatch after 1 retry) → SSE error; studio shows retry card.
- Moderation flag → publish succeeds as Draft; save dialog shows "Saved as draft (content flagged for review)" with a link to Strapi admin.
- Publish fails (Strapi validation) → detailed field-path messages (already implemented earlier in this session).
- Slug collision → Save returns 409 with `{ error, suggestions: ["forgiveness-2", "forgiveness-3"] }`; save dialog renders suggestions inline. No separate pre-check endpoint.
- Aborted request (user clicks "New chat") → upstream `AbortController` propagates via `AbortSignal.any`; all in-flight fetches cancel; spawned docker subprocesses receive `SIGTERM`.

### State Lifecycle Risks

- **Stream interruption:** `AbortController` shared with the single OpenRouter fetch + the `/api/search` fetch. No fan-out in V1 → no per-Fill leaks.
- **Partial assembly:** never possible with single-shot. Save button only appears after the LLM response is fully parsed.
- **Cost overrun:** per-IP daily counter (server-side) caps at $1/day/IP; global OpenRouter account cap at $10/day. Guardrails replace the per-hour rate-limit theatre.
- **TOCTOU create+patch:** closed by wrapping both in a Strapi DB transaction in Phase 2.
- **Per-connection pgvector GUCs:** already set in `apps/cms/config/database.ts` afterCreate. Don't introduce `SET LOCAL hnsw.ef_search` without a transaction wrapper.

### API Surface Parity

- **No new endpoints.** `/api/search` already exists with the right shape and rate limiting.
- **Internal-only:** the SSE event shape changes inside `/api/chat`, consumed only by `use-chat.ts`.
- **Unchanged:** `/api/seed-studio/publish-experience`, `/api/seed-studio/search-videos` (kept for back-compat; may remove after migration).

### Integration Test Scenarios

1. **Zero-candidate theme:** Query "xyzzy123"; `/api/search` returns 0; SSE `patch: ["error"]`; UI shows retry.
2. **Slug collision:** Type "easter" as slug; publish endpoint returns 409 with suggestions; dialog shows "Slug taken. Try: easter-2, easter-3" inline; user accepts.
3. **Stale video candidate:** LLM picks videoId=55; by moderation pass video #55 is unpublished. Save delete+create runs in a transaction; on failure, full rollback; user sees transactional error.
4. **Nested videoId:** Template places a `sections.video` inside a Container inside a Section; after publish, GraphQL confirms the video relation is populated (not null) — proves walker + batched UPDATE work together.
5. **Moderation flag:** Adversarial theme returns content that Moderation flags; publish succeeds as Draft; save dialog shows warning; Strapi admin shows the experience with `publishedAt = null`.
6. **Heartbeat survival:** Simulate 20s of network idle between SSE events; Railway gateway doesn't close the connection (proven by `: ping\n\n` comment every 15s).
7. **Abort propagation:** User clicks "New chat" while LLM call is in flight; all fetches receive `AbortError`; no stale state in the studio UI.

## Acceptance Criteria

### Functional Requirements

- [ ] Generated experiences include `ComponentSectionsSection` wrappers with `backgroundColor` and `sectionKey`.
- [ ] Nested dynamic zones (Section → content) render correctly in both the studio preview and `/watch/<slug>`.
- [ ] Video sections, carousels, and MediaCollections render with functional Mux HLS playback **lazy-inited** (click-to-play for non-hero; VideoHero autoplays muted on viewport).
- [ ] At most 2 concurrent HLS players instantiated at any time (LRU-destroy on off-viewport).
- [ ] BibleQuotes render with `reference`, `text`, `imageUrl`, `backgroundColor`; RelatedQuestions render with Q&A pairs.
- [ ] NavigationCarousel anchor-links scroll to the corresponding `sections.section` by `sectionKey`.
- [ ] Single LLM call latency p50 < 10s, p95 < 20s on OpenRouter gpt-4o-mini; cost p50 < $0.025.
- [ ] Every `videoId` in the generated experience is present in the CMS catalog (strict JSON Schema enum).
- [ ] Every `ComponentSectionsVideo` after publish has its `video` relation populated (recursive walker + batched UPDATE proven).
- [ ] Save returns 409 with suggestions on slug collision; dialog renders suggestions inline.
- [ ] Content flagged by Moderation is published as Draft, never public.
- [ ] Preview uses a single `patch` SSE event type.
- [ ] Legacy Ollama/Codex/Exo path still works via the free-form fallback with the same sanitization.

### Non-Functional Requirements

- [ ] **Memory:** ≤120MB per preview/watch page at steady state with ≤3 active HLS instances.
- [ ] **Cost:** p50 < $0.025/generation; global hard cap $10/day via OpenRouter; per-IP cap $1/day via server-side counter.
- [ ] **Accessibility:** Every video element has `aria-label` including title; BibleQuote background images have derived alt text.
- [ ] **Security:**
  - Slug sanitized (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, 2–80 chars, reserved-word deny-list) at every boundary.
  - `streamClaude` prompt passed via stdin, not `-p` flag.
  - `OPENROUTER_API_KEY` access gated by `import "server-only"` + ESLint rule against `components/` references.
  - `X-Seed-Studio-Token` compared with `crypto.timingSafeEqual`.
  - Moderation pass before public publish; flag → Draft.
  - Zod error messages never echo user-entered query (per `docs/solutions/security-issues/zod-validation-errors-must-not-echo-user-controlled-input-20260420.md`).
- [ ] **Observability:** Per-IP daily $ counter; LLM latency + cost logged per generation; moderation flag rate tracked.

### Quality Gates

- [ ] Unit tests: parityDiff helper, recursive walker against easter fixture, sanitizeSlug, Zod schemas, dynamic-enum schema builder.
- [ ] Integration smoke: three canonical themes (forgiveness, prayer, easter-new) publish cleanly and the CLI parity check reports zero structural mismatches.
- [ ] Typecheck + lint clean across `apps/seed-studio`, `apps/cms`, `apps/web`, `packages/experience-templates`.
- [ ] `docs/solutions/best-practices/seed-studio-watch-parity-generator-20260422.md` committed.

## Implementation Units (collapsed to 4 from 8)

### Unit 1 — Shared package + schema + preview coverage

**Goal:** Single source of truth for types/template; studio can render anything `/watch/easter` renders.

**Files:**

- Create: `packages/experience-templates/package.json` + `tsconfig.json`
- Create: `packages/experience-templates/src/types.ts` — `SectionBlock`, `SectionWrapper`, `MediaCollection`, `NavigationCarousel`, `Card`, `CTA`, `InfoBlocks`, `PromoBanner`, `AdventCountdown`, `EasterDates`, `backgroundColor` enum
- Create: `packages/experience-templates/src/template.ts` — `EASTER_SHAPED_TEMPLATE`, `ARCHETYPES`
- Create: `packages/experience-templates/src/aliases.ts` — `COMPONENT_ALIASES`
- Create: `packages/experience-templates/src/parity.ts` — `parityDiff(expected, actual): DiffReport`
- Modify: `apps/seed-studio/package.json` — add `"@forge/experience-templates": "workspace:*"`
- Modify: `apps/seed-studio/src/lib/ai/experience-schema.ts` — re-export from package
- Modify: `apps/seed-studio/src/components/preview/SectionRenderer.tsx` — dispatcher for new types
- Create: preview components: `SectionWrapperPreview.tsx`, `MediaCollectionPreview.tsx`, `NavigationCarouselPreview.tsx`, `CtaPreview.tsx`
- Modify: `apps/seed-studio/src/lib/chat/use-chat.ts` — import aliases from package, Zod validate, backfill `sectionKey`

**Tests:**

- Package tests: `parityDiff` with identical trees = empty diff; with missing block = reported; with wrong archetype = reported.
- Snapshot: `/watch/easter` GraphQL payload through `SectionRenderer` produces no "unknown \_\_component" warnings.
- `use-chat.ts` test: output missing `sectionKey` on video block → deterministic backfill.

### Unit 2 — Batched + transactional publish + sanitizeSlug + walker proof

**Goal:** Bulletproof the CMS save path.

**Files:**

- Modify: `apps/cms/src/api/seed-studio/services/seed-studio.ts` — wrap create+patch in a transaction, replace N UPDATEs with one `UPDATE … FROM (VALUES …)`, add unit test for recursive walker.
- Create: `apps/cms/src/api/seed-studio/services/seed-studio.test.ts` — walker tests against easter fixture.
- Create: `apps/cms/src/lib/sanitize-slug.ts` — central slug sanitizer with deny-list.
- Modify: `apps/cms/src/api/seed-studio/controllers/seed-studio.ts` — apply `sanitizeSlug`, return 409 with suggestions on collision.
- Modify: `apps/seed-studio/src/lib/strapi-client.ts` — handle 409 + suggestions.
- Modify: `apps/seed-studio/src/components/publish/PublishDialog.tsx` — render suggestions inline.
- Modify: `apps/web/src/lib/fragments/*.ts` — audit + add `pagination: { pageSize: 100 }` on nested zones.

**Tests:**

- Walker: every `sections.video` in the easter fixture is caught; missing-`sectionKey` yields a warning entry.
- sanitizeSlug: reserved words rejected; unicode stripped; length clamped.
- Publish: batched UPDATE verified via `EXPLAIN ANALYZE` note in PR.

### Unit 3 — Single-shot strict-schema generator + semantic search

**Goal:** One LLM call, schema-enforced, catalog-constrained.

**Files:**

- Modify: `apps/seed-studio/src/lib/ai/providers.ts` — add `supportsStrictJsonSchema` capability flag.
- Create: `apps/seed-studio/src/lib/ai/generator.server.ts` — `import "server-only"`; exports `generateExperience`.
- Create: `apps/seed-studio/src/lib/ai/schemas.ts` — JSON Schema builder from `EASTER_SHAPED_TEMPLATE` + per-request video enums.
- Modify: `apps/seed-studio/src/app/api/chat/route.ts` — swap `extractKeywords` → single `/api/search` call; dispatch to `generateExperience`; emit `patch` SSE events; heartbeat every 15s; switch `streamClaude` to stdin input.
- Modify: `apps/seed-studio/src/lib/chat/use-chat.ts` — consume `patch` events (apply to `experienceSnapshot` atom).
- Create: `apps/seed-studio/src/lib/rate-limit.ts` — per-IP daily $ counter (in-memory, reset at UTC midnight).
- Add: ESLint rule in `apps/seed-studio/.eslintrc` forbidding `OPENROUTER` string in `components/**`.

**Tests:**

- Schema builder: enum of `[1,2,3]` → correct JSON Schema + Zod.
- Mocked OpenRouter returns valid response → assembler yields typed experience.
- Mocked OpenRouter returns malformed JSON → 1 retry with Zod error in feedback → success → typed output.
- Mocked OpenRouter 5xx twice → `{ code: "UPSTREAM_ERROR" }`.
- Rate limit: 20 requests at $0.025 each from same IP → 21st blocked with $-limit message.

### Unit 4 — Moderation + CLI parity check + solutions doc

**Goal:** Close the safety and feedback loops.

**Files:**

- Modify: `apps/cms/src/api/seed-studio/services/seed-studio.ts` — moderation pass before public publish; on flag, set `publishedAt = null` and return warning in response.
- Modify: `apps/seed-studio/src/components/publish/PublishDialog.tsx` — render "Saved as Draft" warning with Strapi admin link.
- Create: `apps/seed-studio/scripts/parity-check.ts` — CLI consuming `packages/experience-templates/parity`.
- Create: `docs/solutions/best-practices/seed-studio-watch-parity-generator-20260422.md`.

**Tests:**

- Moderation mocked flag → publish returns 200 with warning; `publishedAt` confirmed null.
- CLI parity: against known-good experience → exits 0; against experience with missing Section → exits non-zero with diff.

## Alternative Approaches Considered (rereviewed during deepening)

1. **Two-stage plan + fill fan-out.** Rejected as V1 default on simplicity grounds — the template is doing the rigidity work, and one-shot with strict schema is the standard industry pattern for slot-filling (Vercel v0, Replit Agent). Kept as an optional Phase 5 fallback if single-shot quality benchmarks below 80%.

2. **Keep one-shot generation, tighten prompt only (no schema, no template).** Still rejected: the structural gap (`ComponentSectionsSection` wrapper missing) can't be closed by prompting alone.

3. **Shared renderer between seed-studio and apps/web.** Rejected: web components are tied to `FragmentOf<gqlSchema>` and assume resolved relations. Seed-studio renders unsaved state. A minimal mirror in the shared package is simpler than contorting web's components.

4. **Expose pgvector semantic search directly from seed-studio Node.** Rejected: crosses app boundaries. Use `/api/search`.

5. **EventSource instead of fetch body streaming.** Rejected (per framework research): `EventSource` can't set Authorization headers or send POST bodies. `fetch + Response.body.getReader()` is the Next.js 16 standard for streamed POST responses.

## Risks & Mitigations

- **Risk: single-shot quality below threshold.** Baseline assumption: one strict-schema call fills a 10-Section template at ≥90% quality. **Mitigation:** measurement in Phase 3. If below threshold, Phase 5 fan-out is pre-designed and can be enabled without protocol changes.

- **Risk: strict-JSON-Schema support varies across providers.** OpenRouter gpt-4o-mini works (production-ready); Anthropic Sonnet 4.5/Opus 4.1+ via `anthropic-beta: structured-outputs-2025-11-13` (beta, Sonnet 4.6 included); Gemini via `responseJsonSchema` (Nov 2025); Ollama/Codex/Exo unreliable. **Mitigation:** `supportsStrictJsonSchema` capability flag routes only strict-capable providers through the new path; legacy free-form kept for the rest with the same sanitization.

- **Risk: HLS player memory on 20-video pages.** Without mitigation, ~500MB per page. **Mitigation:** lazy-init with `<video preload="none" poster=…>` placeholder + IntersectionObserver; LRU-destroy idle players; click-to-play for non-hero. Target ≤120MB, ≤3 active players.

- **Risk: `patchNestedVideoRelations` regression.** **Mitigation:** Unit 2 tests against the real easter GraphQL fixture; CI guard.

- **Risk: cost overrun from runaway generations.** **Mitigation:** per-IP daily $ counter (not ceremonial per-hour), OpenRouter account-level daily cap, alerts at $5/day global.

- **Risk: parity illusion — studio preview looks right but `/watch/<slug>` doesn't.** **Mitigation:** CLI parity check runs shared-package `parityDiff` against the GraphQL shape; enforced in implementation feedback loop.

- **Risk: `streamClaude` flag-injection.** **Mitigation:** Phase 3 switches to stdin input.

- **Risk: generated offensive content on public `/watch/<slug>`.** **Mitigation:** moderation pass + Draft state. Reviewer must manually promote to Published.

- **Risk: Strapi v5 nested relation truncation.** **Mitigation:** explicit `pagination: { pageSize: 100 }` on every nested zone in apps/web fragments (audited in Unit 2).

## Documentation / Operational Notes

- **Pre-merge checklist:**
  1. Verify `OPENROUTER_API_KEY` set in `apps/seed-studio/.env.local` (server-only).
  2. Run `pnpm --filter @forge/cms codegen` if any CMS component JSON changed.
  3. Run CLI parity check against forgiveness / prayer / easter-new themes; attach output to PR.
  4. Confirm `apps/web`'s `STRAPI_API_TOKEN` matches `apps/cms`'s `STRAPI_INTERNAL_API_TOKEN`.
  5. Confirm no component under `apps/seed-studio/src/components/` references `process.env.OPENROUTER` (ESLint guards this).
- **Post-merge validation:**
  - Railway logs: error rates for `generateExperience`, moderation flag frequency, p50/p95 latency.
  - OpenRouter dashboard: daily spend trending.
- **Follow-ups:**
  - If single-shot quality <90%, enable Phase 5 fan-out.
  - Move the shared template package into its own GitHub-published npm package if `apps/mobile` needs it too.
  - Per-section regenerate (natural fit once shared `parityDiff` exists).

## Sources & References

### Internal References

- `apps/seed-studio/src/lib/ai/experience-schema.ts` — current schema (re-exports in Phase 1).
- `apps/seed-studio/src/app/api/chat/route.ts` — current single-shot generator (to rewrite in Phase 3).
- `apps/seed-studio/src/lib/chat/use-chat.ts:20` — COMPONENT_ALIASES (moves to shared package).
- `apps/seed-studio/src/components/preview/SectionRenderer.tsx` — preview dispatcher (to extend).
- `apps/seed-studio/src/lib/strapi-client.ts` — Strapi/search client helpers.
- `apps/cms/src/api/seed-studio/services/seed-studio.ts:48` — keyword `searchVideos` (legacy, superseded by `/api/search`).
- `apps/cms/src/api/seed-studio/services/seed-studio.ts:199` — `collectVideoRelations` walker (just add tests).
- `apps/cms/src/api/search/routes/search.ts:5` — existing `GET /api/search` endpoint.
- `apps/cms/src/api/search/services/semantic-search.ts` — hybrid RRF fused search with partial HNSW indexes per locale.
- `apps/cms/src/components/sections/section.json` — Section wrapper CMS schema.
- `apps/web/src/lib/fragments/section.ts` — authoritative Section GraphQL shape.
- `apps/web/src/components/sections/Section.tsx` — web's wrapper implementation (styling tokens to mirror).
- `apps/web/src/app/[slug]/page.tsx` — `/watch/<slug>` page route (basePath `/watch`).
- `apps/cms/config/database.ts` — per-connection pgvector GUCs (afterCreate).

### Institutional Learnings (docs/solutions/)

- `integration-issues/strapi-v5-nested-component-relation-ids-2026-03-31.md` — nested relations require numeric IDs + post-create patch.
- `performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md` — Strapi v5 silently truncates nested relations to 10.
- `best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md` — closed-union error codes, slug allowlist, retry policy.
- `best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md` — RRF-fused pgvector + FTS is the proven picker.
- `performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md` — `WHERE` on indexed table bypasses HNSW; partial indexes or subquery.
- `database-issues/set-local-requires-transaction-for-pgvector-search.md` — `SET LOCAL hnsw.ef_search` no-ops outside a transaction.
- `security-issues/zod-validation-errors-must-not-echo-user-controlled-input-20260420.md` — strip user input from Zod error messages.
- `ui-bugs/tv-video-hero-blank-autoplay-20260413.md` — thumbnail array vs object pitfall; stable source ref for video player.

### External References (Q1 2026)

- OpenAI Structured Outputs (strict `json_schema`, 1000-enum cap): https://developers.openai.com/api/docs/guides/structured-outputs
- Anthropic Structured Outputs (beta, Sonnet 4.5/Opus 4.1+): https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Gemini `responseJsonSchema` (supersedes `responseSchema`): https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-structured-outputs/
- OpenRouter Structured Outputs (`provider.require_parameters: true`): https://openrouter.ai/docs/guides/features/structured-outputs
- Instructor (validation + retry-with-feedback): https://js.useinstructor.com/why/
- Template-slot composition pattern (v0): https://vercel.com/blog/how-we-made-v0-an-effective-coding-agent
- MDN AbortSignal + `AbortSignal.any` (Node 20+): https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
- Next.js 16 streaming guide: https://nextjs.org/docs/app/guides/streaming

### Related Plans

- `docs/plans/2026-04-21-001-feat-demo-search-ai-experience-generator-plan.md` — preceding demo-search generator (flat blocks, single-shot, OpenRouter gpt-4o-mini). This plan generalizes its strict-schema pattern to the full `/watch` shape.

## Open Questions

### Resolved During Planning / Deepening

- **Pipeline shape: one-shot or two-stage?** One-shot strict JSON Schema as V1. Fan-out fall-back behind a measurement gate.
- **Template location:** shared `packages/experience-templates/` package.
- **Semantic search endpoint:** reuse existing `/api/search`; no new endpoint.
- **SSE event proliferation:** single `patch` event with `{ path, value }`.
- **Parity check UI:** CLI script under `apps/seed-studio/scripts/`, not product React component.
- **Slug pre-check endpoint:** not needed; Save returns 409 with suggestions.
- **Rate limit posture:** per-IP daily $ counter, not per-hour req count. OpenRouter account cap as backstop.
- **Plan model:** gpt-4o (cheaper, sufficient for slot-fill) — Sonnet 4.6 only if measurement needs reasoning.
- **`streamClaude` hardening:** stdin (not `-p` flag).
- **Moderation:** required, gates Draft vs Published state.
- **Low-candidate fallback:** if `/api/search` returns < 4 candidates, drop to 2 video-centric + 1 carousel; if < 2, surface "not enough content" error.
- **Recursive walker rewrite:** unneeded; just test. Behaviour is already correct.
- **Parity measurement:** structural JSON diff via shared `parityDiff` + optional screenshot in CLI.

### Deferred to Implementation

- **Exact prompt wording.** The schema + template lock the shape; prose iterates during Phase 3 using the CLI parity check.
- **Whether to cache search results per theme.** Cold pgvector is already <240ms; cache only if telemetry shows repeat themes dominating.
- **Real-time cost meter in the studio UI.** Nice-to-have; not blocking.
- **Per-section regenerate.** Natural follow-up once `parityDiff` exists.
- **Whether the shared package becomes an npm-published package for apps/mobile.** Depends on mobile renderer adoption timing.
