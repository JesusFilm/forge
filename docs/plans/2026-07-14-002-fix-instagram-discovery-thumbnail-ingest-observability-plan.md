---
title: "fix: Preserve Instagram thumbnails and correlate review ingest"
type: fix
status: completed
created: 2026-07-14
deepened: 2026-07-14
depth: standard
roadmap: docs/roadmap/media-generation/feat-253-instagram-discovery-thumbnail-ingest-observability.md
---

# fix: Preserve Instagram Thumbnails and Correlate Review Ingest

## Problem & Context

The production workflow successfully submits qualified Instagram candidates to
the Gospel Media Lab review queue, but every submitted record currently has a
null thumbnail. The review UI then behaves as designed and renders its common
fallback poster. The loss occurs in Mastra: Firecrawl can return scraped page
metadata, `parseInstagramPost` already recognizes `metadata["og:image"]`, and
the site-ingest client already forwards `post.thumbnailUrl`, but the shared
Firecrawl response DTO and the workflow's real adapter discard `metadata`.

The same workflow logs `inserted` and `skipped` after submission, but the log
does not include the Mastra run id and the Studio report-step output contains no
ingest result. Operators cannot reliably connect a specific Studio run to the
website write. The website dedupe contract is correct—any existing shortcode is
skipped independent of whether it is pending, approved, or denied—but no route
test explicitly protects the Approved/Denied cases.

This work is deliberately split at the runtime ownership boundary:

- Forge/Mastra requests and transports thumbnail metadata, submits the mapped
  post, and reports per-run ingest counts.
- Embers owns persisted review state and adds a test-only regression lock for
  approved/denied dedupe. The review UI and ingest behavior do not change.

**Secondary target repository:** `JesusFilm/embers` (default branch `master`).
Paths under U4 are relative to that repository; all other paths are relative to
Forge.

---

## Requirements

- R1. Instagram discovery requests hydrated Firecrawl search results by default
  so result metadata is available without a Studio operator toggling a field.
- R2. `FirecrawlSearchResult` validates and preserves result `metadata`,
  including `metadata["og:image"]`, through the workflow's real search adapter.
- R3. A real-adapter test proves a Firecrawl response containing
  `metadata["og:image"]` reaches `submitPosts` as `thumbnailUrl`.
- R4. Successful review submissions log `runId`, `inserted`, and `skipped` and
  expose `{ runId, inserted, skipped }` in Studio/core workflow success output.
- R5. Missing configuration, explicit disablement, and website errors remain
  best-effort and do not turn successful discovery into failure.
- R6. Embers tests prove existing `published` (Approved) and `archived` (Denied)
  inspiration shortcodes produce `inserted: 0`, `skipped: 1` and no insert.
- R7. Existing route/output consumers remain compatible through an additive
  nullable `siteIngest` field; no existing field changes meaning.
- R8. Mastra operator documentation describes the new hydration default, its
  cost/latency opt-out, and the run-correlated `siteIngest` output.

Success means the default Studio run asks Firecrawl to scrape result metadata,
a thumbnail-bearing Firecrawl result reaches the website payload intact, and a
specific run's output/log can be matched to its insert/skip counts. Re-running
approved or denied shortcodes remains a website-owned no-op.

---

## Research & Evidence

### Repository findings

- `apps/mastra/src/services/firecrawl-client.ts` currently validates only
  `title`, `description`, `url`, and `markdown` for search results and maps only
  those fields into `FirecrawlSearchResult`.
- `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.ts`
  defaults `scrapeMetadata` to `false` and its real adapter maps no metadata.
- `apps/mastra/src/services/instagram-discovery/post-parser.ts` already accepts
  `og:image`, `ogImage`, and `image`; no parser redesign is needed.
- `apps/mastra/src/services/instagram-discovery/site-ingest-client.ts` already
  maps `InstagramPost.thumbnailUrl` into the website request.
- The Embers ingest route checks for any `(locale, type='inspiration', slug)`
  row before inserting. It does not filter by status, so Approved and Denied
  records are intentionally part of dedupe memory.
- Existing tests prove metadata-to-parser and post-to-ingest mapping separately,
  but do not exercise the real Firecrawl/workflow adapter between them.

### External implementation guidance

Firecrawl's v2 search documentation says the default response is limited to
URL/title/description and that callers must include `scrapeOptions` to receive
scraped result content; its response contract includes a `metadata` object per
web result. The existing shared client already emits `scrapeOptions` when
`includeMarkdown` is true, so the smallest repair is to make Instagram's
existing `scrapeMetadata` input default true and preserve the returned object.

Reference: https://docs.firecrawl.dev/api-reference/endpoint/search

---

## Key Technical Decisions

- KTD1. **Use the existing hydration switch.** Change only the Instagram input
  default from `scrapeMetadata: false` to `true`; retain the field so operators
  can explicitly opt out when cost or latency matters. No new Firecrawl option
  or client is introduced.
- KTD2. **Preserve metadata, then project it at the workflow boundary.** Add
  `metadata: Record<string, unknown> | null` to `FirecrawlSearchResult`, validate
  it with a permissive Zod record, and forward it from
  `requestInstagramDiscoverySearch`. Before the strict Mastra step boundary,
  retain only the parser-recognized thumbnail and publication-time keys and
  bound string values. The shared client accurately represents Firecrawl while
  the workflow avoids serializing arbitrary third-party metadata.
- KTD3. **Prove the connected path, not isolated helpers.** Mock `fetch` at the
  Firecrawl HTTP boundary, run `runInstagramDiscovery` with its default search
  adapter, and assert the injected `submitPosts` receives the `og:image` value
  as `thumbnailUrl`. Also assert the Firecrawl request contains `scrapeOptions`.
- KTD4. **Return one nullable ingest summary.** Add
  `siteIngest: { runId, inserted, skipped } | null` to successful output.
  Configured successful submissions, including zero qualified posts, return a
  summary; disabled, unconfigured, or failed best-effort submissions return
  `null`. This is additive and serializable at the Studio step boundary.
- KTD5. **Correlate every submission log.** Success logs include all three
  values. Failure logs include `runId` plus the sanitized error message. No
  candidate text, URL, or credential enters logs.
- KTD6. **Lock dedupe in Embers without changing it.** Add a route-level Vitest
  suite that mocks Prisma and covers `published` and `archived` existing rows.
  Assert the response counts and that no artifact/content insert executes.
- KTD7. **Ship coordinated PRs.** Forge and Embers have different repositories,
  CI, and deployment ownership. Create one Forge PR for the repair and roadmap
  record, and one Embers test-only PR referencing the same production symptom.

---

## Data Flow After Repair

1. Studio/core input parses with `scrapeMetadata: true` unless explicitly set
   false.
2. `searchFirecrawl` sends `scrapeOptions` and validates each web result's
   metadata.
3. `requestInstagramDiscoverySearch` forwards metadata, then the workflow
   projects bounded parser-recognized keys across the strict Mastra step
   boundary.
4. `parseInstagramPost` reads `og:image` into `InstagramPost.thumbnailUrl`.
5. `submitPostsToSite` sends `thumbnailUrl` to Embers.
6. Embers either inserts a new draft or skips an existing shortcode in any
   status, returning counts.
7. Mastra returns and logs `{ runId, inserted, skipped }` for correlation.

---

## Implementation Units

### U1. Preserve Firecrawl Search Metadata

**Goal:** Make the shared Firecrawl result DTO retain scraped metadata.

**Requirements:** R2.

**Dependencies:** none.

**Files:**

- Modify: `apps/mastra/src/services/firecrawl-client.ts`
- Modify: `apps/mastra/src/services/firecrawl-client.test.ts`

**Approach:** Extend `SearchResultSchema` with an optional nullable record and
add a required nullable `metadata` field to the normalized result. Update
existing exact-result expectations and add `og:image` to the hydrated search
fixture so the adapter behavior is explicit.

**Patterns to follow:** Mirror the existing nullable scrape-metadata
normalization and exact request/response assertions in
`firecrawl-client.test.ts`.

**Test scenarios:**

- Hydrated result retains an `og:image` string unchanged.
- Result without metadata normalizes to `metadata: null`.
- Existing limit, markdown truncation, auth, retry, and error behavior remains
  unchanged.

**Verification:** The focused Firecrawl client suite demonstrates metadata
retention without changing request, truncation, or typed-failure behavior.

### U2. Request and Propagate Thumbnail Metadata

**Goal:** Make default Instagram discovery thumbnail-capable and prove the full
adapter path.

**Requirements:** R1-R3.

**Dependencies:** U1.

**Files:**

- Modify: `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.ts`
- Modify: `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.test.ts`
- Modify: `apps/mastra/CLAUDE.md`

**Approach:** Default `scrapeMetadata` to true and map non-null Firecrawl
metadata into `InstagramDiscoverySearchHit`. Add a test that does not inject
`searchQuery`: mock the Firecrawl HTTP response, execute the core workflow,
capture `submitPosts`, and assert the request hydration option and final
thumbnail URL. Update the operator guide's current `scrapeMetadata: false`
description to document the new default and explicit opt-out. Project only the
parser-recognized thumbnail and publication-time keys into the strict step
schema, retaining bounded string values only.

**Patterns to follow:** Reuse the workflow's bounded-text helpers, strict
`FirecrawlHitSchema`, and default-adapter tests rather than adding a second
parsing layer or Firecrawl client.

**Test scenarios:**

- Default input sends Firecrawl `scrapeOptions`.
- `metadata["og:image"]` reaches the submitted post's `thumbnailUrl`.
- Explicit `scrapeMetadata: false` remains possible and omits hydration.

**Verification:** The workflow suite proves the mocked Firecrawl HTTP response,
real adapter, parser, and injected review submission form one connected path;
the operator guide matches the schema default.

### U3. Surface Per-Run Ingest Diagnostics

**Goal:** Correlate Studio/core workflow success with website ingest effects.

**Requirements:** R4, R5, R7.

**Dependencies:** none; this can be implemented independently of U1-U2, then
verified with the same connected-path test.

**Files:**

- Modify: `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.ts`
- Modify: `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.test.ts`

**Approach:** Change `submitToReviewQueue` to accept `runId` and return a
nullable summary. Add a strict summary schema to success output. Thread the
summary through both `runInstagramDiscovery` and the Studio `report-and-persist`
step. Update success/failure logs with `runId` while retaining catch-and-continue
behavior.

**Patterns to follow:** Keep the existing `SiteIngestResult` client contract,
strict Zod output schemas, and best-effort catch/log behavior in
`submitToReviewQueue`.

**Test scenarios:**

- Successful insert returns/logs `{runId, inserted: 1, skipped: 0}`.
- A website dedupe response returns/logs `{runId, inserted: 0, skipped: N}`.
- Explicitly disabled and unconfigured submission yields `siteIngest: null`.
- Submission exception leaves discovery `ok: true`, yields `siteIngest: null`,
  and logs a run-correlated failure.

**Verification:** Core and Studio-facing result schemas accept the additive
summary, unit tests cover inserted/skipped/failure branches, and typecheck
proves callers consume the new success shape consistently.

### U4. Protect Approved and Denied Dedupe in Embers

**Goal:** Prevent future changes from re-queuing reviewed shortcodes.

**Requirements:** R6.

**Dependencies:** none; Embers remains the independent persisted-state owner.

**Files:**

- Create: `apps/aimedialab/src/app/api/inspiration-candidates/route.test.ts`

**Approach:** Mock `@prisma/client` at the route boundary. For `published` and
`archived` fixtures, make the existing-row query return one row, issue an
authenticated valid Instagram POST, and assert `{ok:true, inserted:0,
skipped:1}`. Assert no execute query runs and Prisma disconnects.

**Patterns to follow:** Match aimedialab's existing Vitest environment and
environment-variable cleanup conventions; mock the dynamically imported Prisma
client at the module boundary.

**Test scenarios:**

- Approved/published shortcode remains skipped.
- Denied/archived shortcode remains skipped.
- Test setup distinguishes the semantic status labels even though production
  deliberately uses status-independent existence SQL.

**Verification:** The focused aimedialab route suite passes both reviewed-state
fixtures and proves neither can reach media-artifact or content-item inserts.

### U5. Validate, Review, and Hand Off Coordinated Changes

**Goal:** Finish both repository changes with focused and CI-sensitive proof.

**Requirements:** R1-R8.

**Dependencies:** U1-U4.

**Files:**

- Modify:
  `docs/roadmap/media-generation/feat-253-instagram-discovery-thumbnail-ingest-observability.md`
- Modify:
  `docs/plans/2026-07-14-002-fix-instagram-discovery-thumbnail-ingest-observability-plan.md`
- Forge and Embers pull-request descriptions/checks

**Approach:** Run focused tests first, then package typecheck/lint. Run the
LFG review pass and address findings before browser verification. Use browser
inspection only for non-mutating output/UI confirmation; do not execute the
production workflow or modify the production queue. Commit and push separate
branches, open coordinated PRs, and monitor required checks.

**Patterns to follow:** Forge roadmap completion rules, package-local validation,
and each repository's normal pull-request/CI workflow.

**Test scenarios:** Test expectation: none—this unit records and hands off the
behavior already verified by U1-U4.

**Verification:** Roadmap status reflects completed local work, both PRs contain
the scoped diffs, and required checks are green or any unrelated failures are
clearly identified with evidence.

---

## System-Wide Impact

- **API/contracts:** Forge workflow success output gains additive nullable
  `siteIngest`; Firecrawl's internal normalized search DTO gains metadata.
- **Data/storage:** No schema or migration. Newly discovered records may contain
  the upstream Instagram thumbnail URL already supported by Embers.
- **Runtime/cost:** Default Instagram discovery now hydrates Firecrawl search
  results, increasing latency/credits relative to search-only mode. Operators
  retain `scrapeMetadata: false` as an explicit opt-out.
- **Observability:** Review submission logs become run-correlated. No secrets or
  raw content are added.
- **Deployment:** Normal Forge and Embers PR-to-main deploy paths. No direct
  Railway or production mutations.

---

## Risks & Mitigations

| Risk                                                              | Likelihood | Impact     | Mitigation                                                                                                                             |
| ----------------------------------------------------------------- | ---------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Instagram blocks Firecrawl hydration and metadata is still absent | Medium     | Medium     | Keep nullable handling and fallback UI; prove transport independently with a response fixture.                                         |
| Hydration increases workflow cost/latency                         | High       | Low-Medium | Retain explicit `scrapeMetadata: false`; document the default change.                                                                  |
| Arbitrary metadata breaks or bloats a strict Studio boundary      | Low        | Medium     | Preserve the vendor object only in the shared DTO; project parser-recognized keys with bounded string values before the workflow step. |
| Additive output breaks an exact downstream decoder                | Low        | Medium     | Route schema remains internally generated and the new field is additive; run workflow/route tests and typecheck.                       |
| Dedupe test falsely implies status-specific SQL                   | Low        | Low        | Name fixtures Approved/Denied but assert the intentional status-independent existence query outcome.                                   |

---

## Scope Boundaries

### In scope

- Mastra Firecrawl metadata hydration and transport.
- Existing parser and ingest payload integration.
- Studio/core ingest result and log correlation.
- Embers route regression tests for reviewed-state dedupe.

### Out of scope

- Scraping Instagram directly or adding authenticated Instagram access.
- Downloading/rehosting thumbnails.
- Changing the review UI fallback poster.
- Re-ingesting existing production rows with null thumbnails.
- Deploying, triggering a production workflow, or mutating the live queue.

---

## Verification

### Forge/Mastra

- Focused Vitest coverage for the Firecrawl client, post parser, site-ingest
  client, and Instagram discovery workflow passes.
- The Mastra package typecheck and lint checks pass.
- Review the mocked real-adapter assertion that Firecrawl `og:image` equals the
  submitted post `thumbnailUrl`.
- Verify `apps/mastra/CLAUDE.md` documents default hydration, the opt-out, and
  the run-correlated ingest summary.
- Browser/API smoke of the local Studio result schema if the Mastra Studio can
  be started without touching production state.

### Embers

- The aimedialab focused Vitest suite for
  `src/app/api/inspiration-candidates/route.test.ts` passes.
- The aimedialab typecheck/lint checks required by Embers pass.
- Assert both `published` and `archived` cases return zero inserted and one
  skipped with no execute call.

### Delivery

- Complete code-review and residual-risk passes for both diffs.
- Open one Forge PR and one Embers PR with cross-links.
- Monitor required checks and fix failures attributable to these changes.
- Mark `feat-253` complete only after implementation and local validation are
  complete; record any production-only verification as follow-up, not as done.
