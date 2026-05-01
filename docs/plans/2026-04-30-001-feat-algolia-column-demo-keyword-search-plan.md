---
title: "feat: Add Algolia column to demo-keyword-search canary"
type: feat
status: active
date: 2026-04-30
revised: 2026-04-30
---

# feat: Add Algolia column to demo-keyword-search canary

## Overview

Extend `apps/admin/src/app/watch/demo-keyword-search/` from a 2-way (hybrid vs keyword-first) canary into a 3-way comparison that includes the **watch** site's Algolia index as a third column. This is a **throwaway operator harness** — Algolia exists in admin only while we refine hybrid/keyword-first ranking, and gets ripped out cleanly at R8 cutover.

**Hard constraints from this revision:**

- **No new API surface.** No public route handler, no `/api/algolia-search`. The Algolia call lives in a Next.js **Server Action** (`"use server"`) co-located with the demo route. The function is callable only from the demo client component within the same app — no externally addressable URL, no contract to maintain, no rate-limit infra to wire up.
- **Minimize new client-side code.** The existing client orchestrator (`demo-search-client.tsx`) gains the smallest possible diff: one extra `runAlgolia(...)` call inside the existing `Promise.allSettled` block, one extra `PaneState`, one extra column in the result grid, and the diff-tile / provenance changes for the 3-way overlap. No new client client-fetch wrapper, no new TypeScript shape that mirrors the watch project's index.
- **Easy to delete.** When Algolia is retired, the cleanup is: delete the server-action file, delete the third column in the client, revert `diff.ts` to the 2-way variant (or leave the 3-way helper as dead code if simpler), drop the three env vars from Doppler / Railway. One small PR.

## Problem Frame

The keyword-first work introduced a canary diff route to compare admin's two ranking modes. Operators can't yet validate either against the de-facto baseline — the Algolia index live behind `watch.jesusfilm.org`. The watch app uses Algolia today; admin's hybrid + keyword-first will replace it at R8 cutover. Without a side-by-side, ranking regressions are invisible until the cutover.

The watch project's public Algolia search key (`NEXT_PUBLIC_ALGOLIA_API_KEY`) is referer-allowlisted to the watch domain, so a browser-side query from `admin.jesusfilm.org` returns 403. The `ALGOLIA_SERVER_API_KEY` is unrestricted (verified via direct curl against `https://FJYYBFHBHS-dsn.algolia.net/1/indexes/video-variants-stg/query`), so a Server Action solves this cleanly while keeping the key off the browser.

## Requirements Trace

- R1. The demo route renders a third column showing top-N hits from the watch Algolia index for the current query/locale/limit, alongside the existing hybrid and keyword-first columns.
- R2. The 3-way overlap panel shows which results appear in 1, 2, or all 3 sources, using a comparison key compatible across admin (cuid + slug) and Algolia (videoId/slug).
- R3. Algolia is queried via a Next.js **Server Action** using `ALGOLIA_SEARCH_API_KEY`. The browser never sees the key, and no public REST endpoint is created.
- R4. New env vars (`ALGOLIA_APP_ID`, `ALGOLIA_SEARCH_API_KEY`, `ALGOLIA_INDEX`) flow through `src/config/env.ts` (validated, never read via `process.env` directly) and are set on the `forge-admin` Railway prod environment.
- R5. The same Railway write also lands `SEARCH_DEBUG_ALLOWED_ORIGINS=https://admin.jesusfilm.org` so the existing debug payload starts surfacing in prod.
- R6. Default behaviour of the existing 2-column diff is unchanged when the Algolia column is unavailable (env unset, transient 5xx) — pane shows an error; hybrid + keyword-first panes continue to render.
- R7. The Algolia integration is **easily removable**: the surface area touched is the demo route directory + `env.ts` + Doppler/Railway. No code outside `apps/admin/src/app/watch/demo-keyword-search/` (other than env declarations) references Algolia.

## Scope Boundaries

- **Throwaway, demo-only.** Not a permanent admin capability. No GraphQL surface, no REST endpoint, no service-layer entry, no CLAUDE.md "feature" entry — it lives in the demo route directory and that's it.
- v1 uses Algolia's **default** query construction (`{query, hitsPerPage}`) only. Replicating watch's filter/facet/ranking parity is out of scope.
- No editor / admin-app config UI for the index name. Index is env-driven.
- No `algoliasearch` npm dependency. Direct `fetch` from the server action.
- No new public API endpoint under `/api/`. No rate-limit bucket. No structured-logging convention beyond `console.error` for failures.
- No promotion of any Algolia logic to `src/lib`, `src/services`, or anywhere reusable. Stays demo-route-local.
- No Doppler integration on admin's side — values are hand-copied from watch's Doppler stg config to forge-admin's Doppler config (and Railway env). Cross-project inheritance is out of scope.

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/app/watch/demo-keyword-search/page.tsx` — Suspense-wrapped client entry.
- `apps/admin/src/app/watch/demo-keyword-search/demo-search-client.tsx` — 2-pane client orchestrator using `Promise.allSettled` + per-pane `idle | loading | ok | error` state machines. Easy to extend to a third pane.
- `apps/admin/src/app/watch/demo-keyword-search/diff.ts` + `diff.test.ts` — pure helper for top-K overlap. Pattern to mirror for the 3-way variant.
- `apps/admin/src/app/watch/demo-keyword-search/graphql-client.ts` — same-origin fetch wrapper for the existing 2 panes. The Algolia pane does NOT mirror this — it calls a server action directly, no fetch wrapper needed.
- `apps/admin/src/config/env.ts` — schema + `runtimeEnv` extension pattern (every var declared in both blocks).

### Institutional Learnings

- `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md` — `updateServiceTool` stages patches; flush with `accept-deploy(environmentId)`. **Never use `redeploy`** — it snapshots the unchanged canonical config and the staged patch silently disappears. This is the single most important rule for Unit 5.
- `docs/solutions/security-issues/log-injection-sanitizer-user-input-structured-logs-20260429.md` — sanitize CR/LF/TAB out of any user input that lands in a log line. Server action's failure log applies the same convention.

### External References

- Algolia REST search API: `POST https://{appId}-dsn.algolia.net/1/indexes/{index}/query` with headers `X-Algolia-API-Key`, `X-Algolia-Application-Id`, `Content-Type: application/json` and body `{ query, hitsPerPage }`. Verified working with the watch-project server key against `video-variants-stg` (returned BibleProject hits for `q="the bible project"`).
- Next.js 16 Server Actions: `"use server"` directive at the top of a file (or per-function) marks an async function as a server-only callable invocable from a client component as if it were a regular async function. Compiles to a framework-internal POST to a non-public endpoint with anti-CSRF wiring. No public API contract; cannot be invoked from outside the app.

## Key Technical Decisions

- **Server Action, not a route handler.** Earlier draft proposed `POST /api/algolia-search`. Rejected because it creates a permanent-looking API surface for a throwaway demo. A server action gives the same key-on-server semantics without producing a deletable contract.
- **Direct `fetch` rather than the `algoliasearch` npm dep.** One endpoint, fixed body shape, no need for client-state caching / typeahead / insights. Eliminates a dependency and a pinning concern.
- **Comparison key for the 3-way overlap is `slug`** (Algolia's `videoId` field is the watch-side slug, e.g. `"BibleProject"`; admin's `SearchResult.slug` is the same shape). Admin's cuid IDs cannot be compared directly to Algolia, but slug is stable across both. The existing 2-way diff is by admin cuid; the 3-way variant operates on slug. Keep the 2-way diff intact for the legacy hybrid-vs-keyword tile so the existing semantic is preserved.
- **3-way diff UX = per-row provenance badges + 6 diff tiles.** The existing 3 hybrid↔keyword tiles stay. Add a parallel 3 tiles for the Algolia overlap. Each result row also gets a small "also in" badge stack (`H` / `K` / `A` chips) indicating which other panes returned the same slug in their top-K.
- **Stg index for v1** (`video-variants-stg`). Only `dev`/`stg` Doppler configs are reachable from the available token. Document in copy that the comparison is against the stg corpus.
- **No env exposure to the browser.** All three Algolia env vars are server-only (no `NEXT_PUBLIC_` prefix).
- **No rate limiting.** Server actions are framework-internal — only invocable from the demo route in the same app, by an operator visiting the page. The natural rate limit is "one operator clicking submit." Skipping the limiter is consistent with throwaway-tool posture.
- **Soft-fail when env unset.** If any of the three Algolia env vars is missing, the action throws a typed error (`AlgoliaNotConfiguredError`) the client maps to a muted "Algolia disabled" banner. Other two columns render unaffected.

## Open Questions

### Resolved During Planning

- **Server Action vs route handler:** server action (no permanent API surface for a throwaway tool).
- **Browser SDK vs direct fetch:** direct fetch.
- **Public vs server key:** server key (public is referer-locked to the watch domain).
- **Stg vs prod index:** stg, with a TODO when prod-config Doppler access lands.
- **Comparison key for 3-way diff:** slug (admin `SearchResult.slug` ↔ Algolia hit `videoId`).
- **Overlap visualization:** parallel diff tiles (3 + 3) plus per-row provenance badges, not a 7-bucket grid.
- **Rate limiting:** none. Server action access is framework-internal; the existing demo route is operator-only.

### Deferred to Implementation

- **Exact slug-equality assumption.** Admin's `SearchResult.slug` and Algolia's `hit.videoId` are believed to overlap byte-for-byte for the same video, but the prod admin DB is empty (per `apps/admin/CLAUDE.md` R4 notes: "admin's `video` / `video_locale` tables are 0 rows in prod"). The first time the demo runs against admin prod, expect the `In all 3` and 2-way overlap tiles to be empty until R0 backfill. Validate the slug-equality assumption locally during ce:work.
- **Locale handling on Algolia.** Algolia hits carry `titles[]` + `titlesWithLanguages[{value, languageId}]` — multiple languages flattened. v1 just renders `titles[0]` and ignores the demo's `locale` param on the Algolia side. Known visual quirk; flag it in copy.
- **TypeScript types for the Algolia hit.** Inline narrow type covering only `{ videoId: string, titles?: string[], description?: string[] }` rather than mirroring the full hit shape.

## Implementation Units

- [x] **Unit 1: env declarations**

**Goal:** Three new optional vars on the validated env singleton.

**Requirements:** R4.

**Status:** ✅ Done (committed locally on branch).

**Files modified:** `apps/admin/src/config/env.ts` — added `ALGOLIA_APP_ID`, `ALGOLIA_SEARCH_API_KEY`, `ALGOLIA_INDEX` in `server` schema + `runtimeEnv`.

---

- [x] **Unit 2: 3-way diff helper + tests**

**Goal:** Pure helpers for 3-way slug overlap and per-id provenance.

**Requirements:** R2.

**Status:** ✅ Done. 19/19 tests pass.

**Files modified:**

- `apps/admin/src/app/watch/demo-keyword-search/diff.ts` — added `computeThreeWayDiff` + `buildProvenanceMap` + `Source` type. `computeTopKDiff` untouched.
- `apps/admin/src/app/watch/demo-keyword-search/diff.test.ts` — 10 new tests for the new helpers.

---

- [ ] **Unit 3: Algolia server action**

**Goal:** Co-located, demo-route-local server action that proxies to Algolia using `ALGOLIA_SEARCH_API_KEY` and returns a normalized hit list. Throws typed errors on misconfiguration / upstream failure for the client to discriminate.

**Requirements:** R3, R6, R7.

**Dependencies:** Unit 1.

**Files:**

- Create: `apps/admin/src/app/watch/demo-keyword-search/algolia-action.ts`
- Create: `apps/admin/src/app/watch/demo-keyword-search/algolia-action.test.ts`

**Approach:**

- Top-of-file `"use server"` directive — every export is a server action.
- Single export: `searchAlgolia({ q, locale, limit }): Promise<{ hits: AlgoliaHit[] }>`. `locale` accepted for forward compatibility / log context but not forwarded to Algolia in v1 (documented in the JSDoc).
- Read `env.ALGOLIA_APP_ID`, `env.ALGOLIA_SEARCH_API_KEY`, `env.ALGOLIA_INDEX` from the validated singleton. If any is undefined, throw `new Error("algolia_not_configured")`. The client matches on the message (cheap, throwaway-shaped error discrimination — typed error class is overkill for a temporary harness).
- Direct `fetch` to `https://${appId}-dsn.algolia.net/1/indexes/${index}/query` with the headers + body documented above. 5s timeout via `AbortSignal.timeout(5000)`.
- On Algolia 4xx/5xx: log a sanitized `console.error("[demo-search][algolia] upstream error status=… msg=…")` line and throw `new Error("algolia_upstream_error")`. Sanitization = strip CR/LF/TAB and clamp to 200 chars.
- Normalize the response into `{ hits: Array<{ videoId: string; title: string | null; description: string | null }> }` — pick `titles[0]` / `description[0]` defensively, drop everything else.
- Inline narrow type for the Algolia hit; do not import or re-export anything that could be mistaken for a service-layer surface.

**Test scenarios:**

- Returns shaped hits when fetch resolves with a populated `hits` array (mock global `fetch`).
- Throws `algolia_not_configured` when any env var is undefined.
- Throws `algolia_upstream_error` on Algolia 5xx.
- Throws `algolia_upstream_error` on fetch network failure.
- Clamps `limit` to ≤ 50 (defensive — matches `/api/search` upper bound, keeps Algolia from billing for over-fetched pages).
- Handles a hit missing `titles[]` / `description[]` without crashing (yields nulls).

**Verification:**

- `pnpm --filter @forge/admin test` passes the new test file.
- Manual: with env set on local admin dev, click the demo page submit and confirm the third column populates from the action call.

---

- [ ] **Unit 4: Demo client wires the third pane**

**Goal:** Smallest possible client diff: one extra await alongside the existing two `runSearch(...)` calls, one extra `PaneState`, one extra column in the result grid, 3 extra diff tiles, per-row "also in" provenance badges.

**Requirements:** R1, R2, R6, R7.

**Dependencies:** Unit 2, Unit 3.

**Files:**

- Modify: `apps/admin/src/app/watch/demo-keyword-search/demo-search-client.tsx`

**Approach:**

- Import the server action directly (`import { searchAlgolia } from "./algolia-action"`). The client component invokes it as a regular async function — Next.js handles the server bridge.
- Extend the `Promise.allSettled` block to fire three calls instead of two. Each call gets its own pane state.
- Map the action's typed-error messages (`"algolia_not_configured"`, `"algolia_upstream_error"`) to specific `PaneState` shapes — `not_configured` renders the muted banner; `upstream_error` falls through the existing `error` pane.
- Grid moves from `1fr 1fr` to `1fr 1fr 1fr` for the result panes.
- DiffPanel grows from 3 tiles to 6: existing `In both` / `Hybrid only` / `Keyword-first only` row stays (semantic: hybrid↔keyword overlap by admin cuid). Add a parallel row: `Algolia ∩ Hybrid (slug)` / `Algolia ∩ Keyword-first (slug)` / `Algolia only (slug)`. Label both rows so operators see the mixed comparison axes (cuid vs slug).
- Per-row provenance: each pane's result table renders an `H` / `K` / `A` chip stack on each row indicating which OTHER panes also returned the same slug in their top-K. Source the data from `buildProvenanceMap(hybrid, keyword, algolia, k)`.
- Empty state for the Algolia pane when `algolia_not_configured` is thrown: muted banner reading "Algolia not configured for this environment. Set `ALGOLIA_APP_ID`, `ALGOLIA_SEARCH_API_KEY`, `ALGOLIA_INDEX` on the admin Railway service." This is the only branch in the client that distinguishes Algolia-specific failure modes from generic errors.

**Patterns to follow:**

- Existing pane-state state machine — extend, don't replace.
- `Banner` component for muted / warn / error degradation messaging.

**Test scenarios:**

- Manual: open `/watch/demo-keyword-search?q=the+bible+project&locale=en` against local admin with env set; all three columns populate; tiles + provenance badges render; idle / loading / error states behave per existing pattern.
- Manual: with one of the three Algolia env vars unset, the third column shows the muted "not configured" banner and the other two columns are unaffected.
- No new automated rendering tests — UI is operator-only and visually verifiable.

**Verification:**

- `pnpm --filter @forge/admin lint` clean.
- `pnpm --filter @forge/admin typecheck` clean.
- Manual browser check at `http://localhost:3003/watch/demo-keyword-search?q=jesus&locale=en` exercising both env-set and env-unset behaviours.

---

- [ ] **Unit 5: Railway prod env push (Algolia + SEARCH_DEBUG_ALLOWED_ORIGINS)**

**Goal:** Land all four env vars on the `forge-admin` Railway prod environment in a single coordinated MCP write so prod's demo route shows three columns and surfaces debug payloads.

**Requirements:** R4, R5.

**Dependencies:** Unit 3 (the prod env vars only matter once the server action is deployed; this unit can land before or after, the env vars are no-op for older builds).

**Files:**

- No code changes. Doppler `forge-admin` (prd config) + Railway dashboard via MCP.

**Approach:**

- Doppler push to `forge-admin` `prd` config:
  - `ALGOLIA_APP_ID=FJYYBFHBHS`
  - `ALGOLIA_SEARCH_API_KEY=<server key from watch stg>`
  - `ALGOLIA_INDEX=video-variants-stg`
  - `SEARCH_DEBUG_ALLOWED_ORIGINS=https://admin.jesusfilm.org`
- Railway MCP dashboard write on the `forge-admin` service, environment id `5f41e037-90e4-4674-a3ea-66bbd05fb3b4`, project `98952497-a4d9-4714-8fe8-0cdbff3147c9`. Resolve the admin service id at execution time via `mcp__railway__list-services` filtered by project.
- **Tool sequence (per `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md`):**
  1. `mcp__railway__updateServiceTool` — apply all four env vars in one staged patch.
  2. `mcp__railway__accept-deploy(environmentId)` — flush. **Never call `redeploy`** — it snapshots the unchanged canonical config and the staged patch silently disappears.
- Verify post-flush by reading the service environment config back via `mcp__railway__list-services` and confirming the four keys are present.

**Patterns to follow:**

- Search `docs/solutions/platform/railway-*` BEFORE issuing any MCP write (per saved feedback memory).

**Test scenarios:**

- Post-deploy, `https://admin.jesusfilm.org/watch/demo-keyword-search?q=the+bible+project&locale=en` shows three populated columns (with admin columns possibly empty until R0 backfill — Algolia column populates regardless).
- Per-row debug payloads now render in the hybrid + keyword-first panes (no more "Debug payload withheld" muted banner).

**Verification:**

- Browser check on prod URL above.
- Confirm absence of the "Debug payload withheld" banner.
- Railway MCP `list-services` shows the four env vars set.

## System-Wide Impact

- **Interaction graph:** Server action is local to the demo route. No shared service or data-access path; no `/api/*` route added; no GraphQL schema change.
- **Error propagation:** Per-pane error isolation in the demo client. An Algolia upstream failure surfaces in the third column without affecting the other two.
- **State lifecycle risks:** None — the action is a synchronous proxy with no DB writes, no workflow dispatch, no cache.
- **API surface parity:** None added. The whole point of using a server action is that there is no addressable URL contract.
- **Integration coverage:** Unit-test coverage on the server action + diff helper is sufficient. Browser-level rendering is operator-verified.
- **Removability:** When Algolia is retired, deleting `algolia-action.ts`, the third pane in `demo-search-client.tsx`, and the three env vars cleans up the entire integration. No service-layer or schema entanglement.

## Risks & Dependencies

- **Slug-equality assumption is unverified at scale.** v1 ships and the first prod run will reveal whether admin `SearchResult.slug` matches Algolia `hit.videoId` byte-for-byte. If it diverges, overlap will under-report. Verify locally during ce:work using the sample data already in the local DB.
- **Stg vs prd Algolia index drift.** Watch Doppler `prd` config invisible to the available token. Comparison is against stg, not prd. Document in copy.
- **Server key in transit.** Standard env-var protection (Doppler-managed, never logged, never browser-exposed). No new threat surface beyond existing OPENROUTER / OPENAI keys.
- **Railway MCP staging trap (Unit 5).** Documented; mitigation is following the playbook exactly.
- **Server-action invocation in a Suspense / client-rendered subtree.** The demo route is already wrapped in `<Suspense fallback={null}>`. Server actions invoked from a client component during render are fine; we invoke from a `useEffect` (the existing pattern), which is the safest path. No special wiring needed.

## Documentation / Operational Notes

- Update `apps/admin/CLAUDE.md` with a small line in the existing "Hybrid search keyword-first mode (R4 extension)" section noting the demo route's third Algolia column and the `ALGOLIA_*` env triple — explicitly tagged as "throwaway operator harness, removed at R8 cutover."
- No solutions doc — the architectural shape (server action + direct fetch) is conventional Next.js.

## Sources & References

- `apps/admin/src/app/watch/demo-keyword-search/` — existing 2-way demo
- `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md` — Unit 5's required playbook
- `docs/solutions/security-issues/log-injection-sanitizer-user-input-structured-logs-20260429.md` — log sanitization for Unit 3
- Watch project Doppler `stg` config (read during planning): `ALGOLIA_APP_ID=FJYYBFHBHS`, `ALGOLIA_INDEX=video-variants-stg`, `ALGOLIA_SERVER_API_KEY=<redacted>` — verified working against `https://FJYYBFHBHS-dsn.algolia.net/1/indexes/video-variants-stg/query`
- Algolia REST API: `POST /1/indexes/{index}/query`
- Next.js Server Actions: `"use server"` directive
