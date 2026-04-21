---
title: "feat: AI-generated experience preview on /demo-search"
type: feat
status: completed
date: 2026-04-21
---

# AI-Generated Experience Preview on /demo-search

## Overview

Add a new section to the `/demo-search` page, placed **above** the existing Cost & Latency comparison panel, that demonstrates an LLM consuming the live semantic-search API and producing a structured "mini experience" from the query + top results. Non-streaming MVP — click button, ~2 s loading state, full generated experience snaps in at reduced scale, populated with real thumbnails pulled from the already-fetched search results.

This is a thin addition to the existing `feat/demo-search-showcase` branch / PR #809. It does not touch the CMS, does not persist anything, and does not change any existing behavior.

## Problem Frame

The existing demo proves the pipeline: search API + recommendations + cost comparison. The stakeholder-visible _story_ needs one more beat — "here's what an agent consuming this API can do in one shot": taking natural-language queries and composing curated content experiences. That's the entire premise of downstream features like the AI page-builder. The demo should let Vlad click a button and show that end-to-end in ~3 seconds, with no CMS edit involved.

## Requirements Trace

- **R1.** A "Generate experience with AI" button renders above the Cost & Latency panel on `/demo-search` whenever a query + results exist. It does not render on the empty state.
- **R2.** Clicking the button triggers a server-side LLM call that takes the current query + compact representation of the top 10 search results and returns a structured JSON "experience" tree.
- **R3.** The returned tree is rendered inline, visually scaled down (narrower container), as a mini-experience preview using real thumbnails resolved from the `SearchResult[]` already in the page.
- **R4.** Every video slug referenced by the LLM must exist in the search results passed in. Slugs the LLM hallucinates are filtered out silently — they never produce broken cards.
- **R5.** Failure modes (LLM unreachable, schema mismatch, empty response) surface an inline error with a retry button, not a page-level crash.
- **R6.** `OPENROUTER_API_KEY` is added to the `apps/web` env validation. When the var is absent at runtime, the button renders disabled with a "not configured" hint instead of a server error.
- **R7.** No streaming in v1. The button goes straight from "idle" → "loading spinner" → "rendered" / "error". Streaming is an explicit follow-up.
- **R8.** The demo route is already `robots: noindex`; no new SEO concerns.

## Scope Boundaries

- No changes to the CMS GraphQL schema, no new Strapi content types, no persistence of generated experiences.
- No streaming response rendering — deferred follow-up.
- No rate limiting beyond OpenRouter's own. The page is unauthenticated and noindex; cost cap is OpenRouter account-level.
- No analytics events for "generate clicked". Not in scope for a stakeholder demo.
- No editability of the generated tree. Read-only preview.
- No routing into the canonical `/[slug]/[locale]` experience page from the generated tree. The preview is self-contained; its cards deep-link to `/demo-search/[slug]/en` (videos) or `/[slug]/en` (if slug matches an experience-type result). Matches the existing demo routing convention.
- No `openai` SDK dependency added to `apps/web`. Raw `fetch` is cleaner at one call site.

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/env.ts` — the `@t3-oss/env-nextjs` + Zod pattern for server env vars. Add `OPENROUTER_API_KEY` to the `server` block + `runtimeEnv` map.
- `apps/cms/src/lib/openrouter.ts` — reference pattern for an OpenRouter client (singleton, timeout, API-key validation). The web-side client will be simpler (single raw `fetch` call) but should mirror its error-handling shape.
- `apps/web/src/lib/search.ts` — `SearchResult` shape and `searchVideos()` return type. The LLM input is built from these, and the client component receives `SearchResult[]` as props.
- `apps/web/src/components/demo-search/CostLatencyPanel.tsx` — sibling component; the new generator renders directly above it.
- `apps/web/src/components/search/VideoCard.tsx` — thumbnail + title card pattern to mirror for the carousel and spotlight renderers.
- `apps/web/src/components/sections/VideoRecommendations.tsx` — existing scaled-grid layout; similar tailwind vocabulary.
- `apps/web/src/app/demo-search/page.tsx` — where the new component is wired in, in `DemoResultsLoader`'s return value.

### Institutional Learnings

- `apps/cms/CLAUDE.md` (not directly relevant here) notes Strapi's GraphQL plugin + OpenRouter wiring — inherited pattern is "OpenRouter over OpenAI directly" for model portability. Mirror that for apps/web: base URL `https://openrouter.ai/api/v1`.
- The demo already makes prod LLM calls (query embeddings during search). Adding a second LLM call on explicit user action does not change the operational footprint meaningfully.
- The cost panel's live widget already demonstrates per-session LLM cost accounting. The "Generate" action uses ~500–2000 completion tokens per call (≈$0.0003–$0.0012 with gpt-4o-mini). Worth mentioning in demo copy; not worth adding to the live widget for v1.

### External References

- **OpenRouter chat completions API:** https://openrouter.ai/docs/api-reference/chat-completions — OpenAI-compatible POST body. `response_format: { type: "json_schema", json_schema: { name, strict, schema } }` is supported for gpt-4o-mini and produces guaranteed-shape output.
- **OpenAI structured outputs reference schema format:** https://platform.openai.com/docs/guides/structured-outputs — JSON Schema subset: `type`, `properties`, `required`, `additionalProperties: false`, `enum`, `anyOf` for discriminated unions.
- **Model choice (`openai/gpt-4o-mini`):** ~$0.15 / 1M input, $0.60 / 1M output. p50 latency ~800 ms for ~1k token responses per OpenRouter community benchmarks.

## Key Technical Decisions

- **Server Action, not Route Handler.** The generator is invoked from one client component via a form-like action; no external or cross-origin caller needs a URL. Server Action (`"use server"`) keeps the call closed over the component's types and skips URL routing.
- **Raw `fetch` to OpenRouter, not the `openai` SDK.** `apps/web` has no existing `openai` dep. One call site, clearly scoped, three fields in the request body — pulling in an SDK is over-engineering. CMS uses the SDK because it already did and has multiple call sites. Decision is deliberately divergent.
- **Structured outputs via `response_format: json_schema`, not prompt engineering.** gpt-4o-mini supports strict JSON Schema mode. This eliminates the "parse broken JSON" category of failure. Validation on our side is still enforced via Zod as defense-in-depth.
- **LLM input is compact — slug + title + snippet only.** The full `SearchResult` is ~500 bytes per item with thumbnail URLs etc. We pass slug + title + snippet only (≈120 bytes / item). 10 items ≈ 1.2 KB. Keeps input tokens <400, response quality unchanged.
- **Slug safety: server-side filter after the LLM response.** The schema can't enforce "must be one of the input slugs". We take the LLM output, drop any section whose slug(s) aren't in the input set, and if that leaves a section empty, drop the section. Logs a warning so we can tune the prompt later.
- **Env-var-missing is a graceful UI state, not a crash.** If `OPENROUTER_API_KEY` is unset at runtime, the server action throws early and the client shows a muted "AI generation not configured for this environment" card instead of the "Generate" button. This matters because the deploy checklist step is genuinely easy to forget.
- **Presentational sections are not reused CMS section components.** `VideoHero`, `CarouselVideo`, `VideoRecommendations` are tied to the Strapi fragment types. The generator renders pure JSON, so we build three small presentational components — `GeneratedSpotlight`, `GeneratedCarousel`, `GeneratedBibleVerse` — that accept plain props and share tailwind vocabulary with their Strapi cousins. This avoids type contortions at no visual cost.
- **Scale-down is container-width-driven, not `transform: scale`.** `max-w-3xl mx-auto` on the preview gives a visually smaller, centered container without breaking image sharpness or text legibility. `transform: scale(0.75)` would but CSS-scaled text reads blurry and breaks hover states.

## Open Questions

### Resolved During Planning

- **Streaming vs non-streaming:** Non-streaming for v1 per user directive. Streaming is an explicit follow-up with its own ticket when/if Vlad asks.
- **Model:** `openai/gpt-4o-mini` via OpenRouter. Cheap, JSON-strict, sub-second.
- **Number of results passed to the LLM:** 10. Balances token cost vs giving the LLM enough choice to pick a good spotlight + theme groupings.
- **Sections per response:** 2–3 (schema enforces `minItems: 2`, `maxItems: 3`). Keeps generations visually coherent and limits worst-case output tokens.
- **Cost surfacing:** Not added to the live session widget in v1. The static cost table explains the architecture; the "generate" button isn't a sustained cost to amortize.
- **Accessibility of the scaled preview:** Container-width scale keeps text full-size and screen-reader-friendly. No special handling required.

### Deferred to Implementation

- **Exact system prompt wording.** The plan locks the _schema_ and the _input format_, not the prose. Iterate prompt at implementation time; a good first pass: "You are a JesusFilm content curator. Given a user query and a list of candidate videos, compose a brief experience of 2–3 sections. Only reference videos by their slug, only from the list provided. Be reverent and clear."
- **Retry behavior on slug-mismatch.** MVP: silently filter hallucinated slugs. If that leaves too few sections (<1), treat as error and show the retry UI. Whether to auto-retry with a stricter follow-up prompt is deferred.
- **Model fallback.** If gpt-4o-mini is rate-limited or degraded on OpenRouter, do we fall back to `openai/gpt-4o` or `anthropic/claude-haiku-4-5`? Not in v1; show a transient error and let the user retry.
- **Whether to cache identical (query, slug-set) generations.** Probably yes for demo snappiness on Vlad's second click, but `unstable_cache` with a hash key is a small optional nicety — defer unless it feels sluggish in smoke testing.

## High-Level Technical Design

> _Directional guidance for the response schema shape — not implementation specification. The actual Zod schema in code is the source of truth once written._

**Response schema (JSON Schema, strict mode):**

```
experience:
  title: string (max ~80 chars)
  intro: string (1–2 sentences, max ~280 chars)
  sections: array, minItems: 2, maxItems: 3, items:
    oneOf:
      spotlight:
        type: "spotlight"
        videoSlug: string    # must be one of the provided slugs
        why: string           # 1 sentence — why this is the lead video
      theme-carousel:
        type: "theme-carousel"
        theme: string         # e.g. "The Resurrection", "Stories of Hope"
        videoSlugs: array, minItems: 3, maxItems: 5
        caption: string       # 1 sentence introducing the theme
      bible-verse:
        type: "bible-verse"
        reference: string     # e.g. "John 3:16"
        text: string          # the verse body, 1–3 lines
        reflection: string    # 1–2 sentence reflection tying to the query
```

**Request flow (sequence):**

```
Browser (AiExperienceGenerator)
    │ click "Generate"
    ▼
Server Action: generateExperienceAction(query, compactResults)
    │ validate env.OPENROUTER_API_KEY present
    │ build request: system prompt + user prompt + response_format schema
    ▼
POST https://openrouter.ai/api/v1/chat/completions
    │ timeout 15s, 1 retry on 5xx
    ▼
Parse response.choices[0].message.content (guaranteed JSON by strict mode)
    │ Zod parse → reject if shape wrong
    │ Slug filter → drop hallucinated slugs and empty sections
    ▼
Return { ok: true, experience } or { ok: false, reason }
    ▼
Browser renders <GeneratedExperiencePreview experience={...} resultsBySlug={...} />
```

## Implementation Units

- [ ] **Unit 1: Add `OPENROUTER_API_KEY` to env validation**

**Goal:** Make `process.env.OPENROUTER_API_KEY` type-safe and validated at startup on the server side, with a clean absent-key fallback story.

**Requirements:** R6

**Dependencies:** None.

**Files:**

- Modify: `apps/web/src/env.ts`
- Modify: `apps/web/.env.example`

**Approach:**

- Add `OPENROUTER_API_KEY` to the `server` block as `z.string().optional()` — optional so dev / preview environments without the key don't fail `next build`.
- Wire into `runtimeEnv`.
- Document in `.env.example` with a one-line comment noting it's required for the `/demo-search` AI generator only.

**Patterns to follow:**

- Keep the ordering consistent with the existing `server` block.
- No `NEXT_PUBLIC_` prefix — this is strictly server-side.

**Test scenarios:**

- `next build` succeeds with the var unset (dev-preview compatibility).
- `env.OPENROUTER_API_KEY` is typed as `string | undefined` at call sites.

**Verification:**

- Typecheck passes.
- `.env.example` shows the new var with a descriptive comment.

- [ ] **Unit 2: OpenRouter experience-generation client helper**

**Goal:** A pure-ish logic module that takes `(query, results)` and returns a validated experience or a typed error. Encapsulates the fetch, the response_format schema, and the slug-filter step.

**Requirements:** R2, R4, R5

**Dependencies:** Unit 1.

**Files:**

- Create: `apps/web/src/lib/experience-generator.ts`
- Test: `apps/web/src/lib/experience-generator.test.ts`

**Approach:**

- Export two things: a Zod schema for the experience response (derived from the High-Level Technical Design shape), and an async `generateExperience(query, compactResults)` function.
- Inside the function:
  1. Read `env.OPENROUTER_API_KEY`; if missing, throw a typed `ExperienceGeneratorError` with a `code: "NOT_CONFIGURED"` that the action layer turns into a specific UI state.
  2. Build request body: model `openai/gpt-4o-mini`, a system prompt + user prompt (see Deferred for prose), `response_format` with the JSON Schema, `max_tokens: 800`, `temperature: 0.4`.
  3. `fetch` with 15s `AbortSignal.timeout(15000)`. On 5xx, retry once with a 500 ms delay. On non-2xx after retry, throw `{ code: "UPSTREAM_ERROR" }`.
  4. Parse `choices[0].message.content` as JSON → Zod parse → throw `{ code: "SCHEMA_MISMATCH" }` if it fails.
  5. Slug filter: build a `Set<string>` from input slugs; for each section drop any video slug not in the set; drop whole sections that end up with no usable videos; drop the response entirely if fewer than 1 valid section remains → `{ code: "NO_VALID_SECTIONS" }`.
  6. Return the validated + filtered experience.
- Keep the function dependency-free (no React, no Next.js imports) so it unit-tests cleanly.

**Patterns to follow:**

- Error shape mirrors `SearchError` in `apps/web/src/lib/search.ts`: a discriminated object rather than subclassing `Error`.
- Singleton-style lazy init not needed — stateless helper.

**Test scenarios:**

- Happy path: mocked `fetch` returns a valid JSON response, function returns parsed + filtered experience.
- Missing env var → throws `{ code: "NOT_CONFIGURED" }` without attempting fetch.
- 500 from OpenRouter → retries once, then throws `{ code: "UPSTREAM_ERROR" }`.
- Malformed JSON response → throws `{ code: "SCHEMA_MISMATCH" }`.
- Response references 3 slugs, only 1 is in the input set → two carousel slugs are filtered out; section survives.
- Response references 0 valid slugs → section dropped; remaining sections < 1 → throws `{ code: "NO_VALID_SECTIONS" }`.
- Timeout → throws a typed error (reuse `UPSTREAM_ERROR` for MVP).

**Verification:**

- All unit tests green.
- Function is importable from server code only (no client bundle leakage — enforced by the "use server" action file, not by this module itself).

- [ ] **Unit 3: Server action wrapping the helper**

**Goal:** Expose `generateExperience` as a callable from the client component via Next.js Server Actions.

**Requirements:** R2, R5, R6

**Dependencies:** Unit 2.

**Files:**

- Create: `apps/web/src/app/demo-search/actions.ts`

**Approach:**

- File starts with `"use server"`.
- Export `generateExperienceAction({ query, results }: { query: string; results: CompactResult[] }): Promise<ActionResult>` where `ActionResult` is `{ ok: true, experience } | { ok: false, code, message }`.
- Wrap the helper call in try/catch. Map typed errors to user-facing `code` + `message` pairs. `NOT_CONFIGURED` → friendly "AI generation isn't configured for this deployment"; `UPSTREAM_ERROR` → "Generation service is unavailable right now"; `SCHEMA_MISMATCH` / `NO_VALID_SECTIONS` → "Couldn't produce a coherent experience — try again".
- Server action must not return non-plain objects or `Error` instances — return plain JSON only (Server Action serialization limitation).
- No auth check — the demo page is public; OpenRouter cost cap is at the account level.

**Patterns to follow:**

- No existing Server Actions in `apps/web` today; this is the first. Keep the file minimal and conventional.
- Match the `SearchError` shape philosophy for the error object.

**Test scenarios:**

- Covered indirectly by Unit 2's tests + the browser smoke.

**Verification:**

- Typecheck passes — the action's return type is a plain serializable object.
- Manual smoke: invoking the action from the client produces a well-formed response on success and a well-formed error on each error path.

- [ ] **Unit 4: `AiExperienceGenerator` client component + section renderers**

**Goal:** The user-facing button, state machine, and rendered preview.

**Requirements:** R1, R3, R4, R5, R7

**Dependencies:** Unit 3.

**Files:**

- Create: `apps/web/src/components/demo-search/AiExperienceGenerator.tsx`
- Create: `apps/web/src/components/demo-search/GeneratedSections.tsx` (holds the three small section renderers + the slug-lookup helper)

**Approach:**

- `AiExperienceGenerator` props: `query: string`, `results: SearchResult[]`.
- Uses `useTransition` so the action invocation doesn't need a manual `loading` state duplicated across renders.
- Local state: `{ status: "idle" | "success" | "error", payload }`.
- Idle state: a single centered button "Generate experience with AI". Beneath it, a muted hint: "Takes ~2 s · uses OpenRouter gpt-4o-mini".
- Loading: button becomes disabled with an inline spinner + text "Composing…".
- Success: render `<GeneratedExperiencePreview>` inside a `max-w-3xl mx-auto` container with its own subtle border/background to visually frame the preview as "this came from an AI". Include a "Regenerate" button below to re-run with the same inputs.
- Error: inline error card with the `message` + a "Try again" button that re-invokes the action.
- When building the request payload, map `results.slice(0, 10)` to `{ slug, title, snippet }`.
- `GeneratedExperiencePreview` receives `experience` + a `resultsBySlug: Map<string, SearchResult>` lookup. It maps sections to renderers: `GeneratedSpotlight`, `GeneratedThemeCarousel`, `GeneratedBibleVerse`. Each renderer accepts its discriminated-union node + the lookup and is purely presentational.
- `GeneratedSpotlight`: one large card left, text block right (stacks on mobile). Thumbnail from the resolved `SearchResult.imageUrl`. Clicking opens `/demo-search/[slug]/en` (videos) or `/[slug]/en` (experiences) following the existing `DemoSearchResults` href logic — extract that into a shared helper to avoid duplication.
- `GeneratedThemeCarousel`: theme heading + 3–5 small thumbnail cards in a row, scrollable on mobile. Caption text below the heading.
- `GeneratedBibleVerse`: simple typographic block — reference (small uppercase), verse text (large italic), reflection (smaller muted).

**Patterns to follow:**

- Tailwind vocabulary matches `CostLatencyPanel.tsx` and `VideoCard.tsx` (stone-800 borders, amber accent for AI content, stone-950/60 card bg, tight text hierarchy).
- Link-builder: extract the experience-vs-video href logic from `DemoSearchResults.tsx` into a shared helper (for example `apps/web/src/lib/demo-href.ts`) and call it from both consumers. Avoids drift between how search results and generated-experience cards route.
- `useTransition` is the preferred React 19 / Next 16 pattern for Server Actions — no imperative `setLoading(true)` boilerplate.

**Test scenarios (manual browser smoke — no JSDOM in apps/web):**

- Search runs, button appears.
- Click → spinner → renders preview with 2–3 sections.
- Each video thumbnail in the preview matches a card visible in the search grid above.
- Regenerate produces a new composition.
- Manually blank `OPENROUTER_API_KEY` in local env → button area shows "not configured" muted card, not an error.
- Simulate upstream failure (block `openrouter.ai` with `/etc/hosts` or kill network) → error card + retry button, no page crash.

**Verification:**

- Lint + typecheck clean.
- Dev-server smoke (against prod CMS + real OPENROUTER_API_KEY): each happy-path scenario above actually happens.

- [ ] **Unit 5: Wire `AiExperienceGenerator` into `/demo-search` page**

**Goal:** Mount the generator above the Cost & Latency panel and only when results exist.

**Requirements:** R1

**Dependencies:** Unit 4.

**Files:**

- Modify: `apps/web/src/app/demo-search/page.tsx`
- (Possibly) Modify: `apps/web/src/components/demo-search/DemoSearchResults.tsx` — if the results list needs to be lifted to the page level so the generator and the results component share the same array.

**Approach:**

- Today, `DemoResultsLoader` (server async) calls `searchVideos()` and passes results into `DemoSearchResults`. The generator needs the same `results` + `query`. Easiest path: `DemoResultsLoader` renders a fragment containing `<SearchModeBanner>`, `<DemoSearchResults>`, and `<AiExperienceGenerator query={query} results={data.results}>`.
- Render `<AiExperienceGenerator>` only when `data.results.length > 0`. The empty-state and error paths don't render it.
- `<CostLatencyPanel />` stays where it is at the page root level (outside `Suspense`) — the generator lives _inside_ the Suspense boundary because it depends on results, but renders above the panel in document order. Verify this by reading `page.tsx` at implementation time; if the panel is currently inside the Suspense payload, no change needed.

**Patterns to follow:**

- Mirror the way `SearchModeBanner` is conditionally included inside the loader fragment.

**Test scenarios:**

- No `?q=` → empty state, no generator, no panel changes.
- `?q=` with zero results → no generator, existing "no results" copy still shows.
- `?q=` with results → generator button renders between results grid and cost panel.
- Rate-limited search (`SearchError`) → no generator, existing error copy shows.

**Verification:**

- Visual order on the page: input → banner (optional) → results grid → AI generator → cost panel.
- Refreshing the URL re-runs SSR and the generator button is idle by default; no state leaks across navigations.

## System-Wide Impact

- **Interaction graph:** The new Server Action is the only new execution path. It lives entirely in `apps/web` and calls out to OpenRouter over HTTPS. No CMS, no Postgres, no auth middleware, no `lib/client.ts`.
- **Error propagation:** All failures collapse to a single inline error UI with a retry action. `SearchError` handling on the same page is untouched.
- **State lifecycle risks:** Component-local state only. No server-side state, no shared cache beyond the existing Next.js render-time cache (which this feature doesn't opt into). No clean-up concerns.
- **API surface parity:** Not applicable — this is a new action with no existing counterpart elsewhere.
- **Integration coverage:** Unit 2's tests mock `fetch`; the full path (action → network → render) is exercised only by the manual browser smoke. Given MVP scope and low blast radius, this is appropriate; no integration test harness gets added for one action.

## Risks & Dependencies

- **Risk: forgetting to set `OPENROUTER_API_KEY` on the prod `@forge/web` Railway service before merge.** Mitigation: Unit 1 makes the key optional in validation (no `next build` failure). Unit 3 turns the absent-key case into a friendly UI state. Explicit deploy checklist added below. Without the checklist, production is still _safe_ — just missing the feature — but demo is dead until the key lands.
- **Risk: prompt injection via the `query` parameter.** Queries are ≤200 chars (enforced upstream by `searchVideos`), the input to the LLM is structured and doesn't use Markdown parsing on the way back, and the rendered output is text-in-text-nodes only (no `dangerouslySetInnerHTML`). Low risk, but documented for completeness.
- **Risk: cost if the button is mass-clicked.** OpenRouter account spend limit is the only backstop. Demo page is noindex. Worst case: a few dollars. Acceptable.
- **Dependency: user has an OpenRouter API key with credits.** Already true — the CMS uses OpenRouter in prod. No new account setup.
- **Dependency: gpt-4o-mini continues to exist on OpenRouter.** Stable model, low risk.

## Documentation / Operational Notes

- **Pre-merge deploy checklist (for reviewer):**
  1. Add `OPENROUTER_API_KEY` to the `@forge/web` Railway service env vars. Same value as `@forge/cms`'s `OPENROUTER_API_KEY` (per `docs/roadmap/…/feat-105…` and memory note on shared-OPENROUTER-key behavior).
  2. Confirm the Railway service restarts cleanly after adding the var.
  3. Smoke the generated-experience button on the deployed URL.
- **Post-merge validation:**
  - Check Railway logs for `ExperienceGeneratorError` occurrences — if non-zero baseline, something's wrong upstream or the prompt needs hardening.
  - OpenRouter dashboard: confirm `@forge/web` traffic appears under the shared key.
- **Follow-up ticket to file if the demo lands well:**
  - _Streaming variant_ — visibly stream tokens / sections for more "alive" feel. Separate branch.
  - _Model fallback chain_ — graceful degradation when gpt-4o-mini is rate-limited.
  - _Cache identical `(query, slug-set)` generations_ — snappier re-demos.

## Sources & References

- Related branch / PR: `feat/demo-search-showcase` / PR #809.
- Related plan: `docs/plans/2026-04-20-001-feat-demo-search-showcase-plan.md` (the base demo).
- Related code:
  - `apps/web/src/env.ts`
  - `apps/web/src/lib/search.ts`
  - `apps/web/src/app/demo-search/page.tsx`
  - `apps/web/src/components/demo-search/CostLatencyPanel.tsx`
  - `apps/web/src/components/search/VideoCard.tsx`
  - `apps/cms/src/lib/openrouter.ts` (reference pattern)
- External docs:
  - OpenRouter chat completions: https://openrouter.ai/docs/api-reference/chat-completions
  - OpenAI structured outputs: https://platform.openai.com/docs/guides/structured-outputs
  - Next.js Server Actions: https://nextjs.org/docs/app/getting-started/updating-data
