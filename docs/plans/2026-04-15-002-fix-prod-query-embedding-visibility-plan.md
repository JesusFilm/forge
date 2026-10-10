---
title: "fix: Surface production semantic-search embedding failures"
type: fix
status: active
date: 2026-04-15
origin: docs/roadmap/content-discovery/feat-097-investigate-prod-query-embedding.md
---

# fix: Surface production semantic-search embedding failures

## Overview

Production semantic search is silently degraded — OpenRouter query embedding fails, the `try/catch` in the search orchestrator swallows the failure with a `warn`-level log, and the API still returns 200s with keyword-only results. The operational fix (rotate/restore `OPENROUTER_API_KEY` in Railway) is a one-line env-var change done outside code. **This plan covers the code-side work that prevents this failure mode from ever being invisible again**: raise the log level, expose process-local counters, add a non-breaking response signal so UI can render a degradation banner, and expose a health endpoint external monitors can poll.

## Problem Frame

`apps/cms/src/api/search/services/search.ts:164-176` wraps the OpenRouter call in a try/catch that logs at `warn` level and continues with `queryEmbedding = null`. That's correct product behavior (graceful degradation beats a 503) but disastrous operational behavior: no alert fires, consumers have no way to know they're getting a degraded result, and the only way to notice is by inspecting RRF scores (which all land at exactly `0.500` — the arithmetic fingerprint of rank-1 keyword + empty semantic across 2 lists).

The six production queries tested on 2026-04-15 confirm environment-specific failure: local DB returns rich scene-level semantic data; production returns keyword-only for every thematic query. Hypothesis (from the origin ticket): `OPENROUTER_API_KEY` is missing or invalid in the Railway `forge-cms` service. That's an operational fix. This plan is about the **second-order bug** — that we couldn't see the failure at all.

## Requirements Trace

- **R1.** The embedding failure must surface at `error` log level, not `warn`, so Railway's default log retention captures it and log-based alerts can fire.
- **R2.** Operational state (attempts, failures, last error) must be queryable without tailing logs — a lightweight probe endpoint external monitors can poll.
- **R3.** Consumers (apps/web, apps/mobile) must be able to detect degraded mode and render an appropriate UI signal, without any existing consumer breaking if it ignores the new field.
- **R4.** Graceful degradation must be preserved — no 503, no behavior change on the happy path, no boot-time dependency on OpenRouter.
- **R5.** The `search()` service contract must continue to work identically for both REST and GraphQL entry points.

## Scope Boundaries

- **In scope:** log-level hardening, process-local counters, response-contract signal, on-demand health endpoint.
- **Out of scope:**
  - The Railway env-var fix itself (operational, not code).
  - New metrics infrastructure (InfluxDB, Prometheus, Datadog). No sink exists today; introducing one is a separate project.
  - Changes to the RRF algorithm, deduplication, or retrieval path. The math is correct; the input was the problem.
  - Model swap, provider replacement, or multi-provider failover.
  - Any change to the per-list retrieval `unwrapOutcome` path (which already logs at `error`).
  - Consumer UI changes. apps/web and apps/mobile can opt into the new `searchMode` field in a follow-up once the contract ships.

## Context & Research

### Relevant Code and Patterns

- **The failure site:** `apps/cms/src/api/search/services/search.ts:164-176` — the try/catch that currently logs at `warn`.
- **The embedding client:** `apps/cms/src/lib/openrouter.ts` — `embedQuery()` throws on missing key, API errors, or invalid response shape.
- **The RRF math confirming diagnosis:** `apps/cms/src/api/search/services/fusion.ts:48-100` — normalization by `lists.length / (k+1)` produces the observed `0.500`.
- **REST entry point:** `apps/cms/src/api/search/controllers/search.ts` — Koa-style controller; returns `SearchResponse` as JSON.
- **GraphQL entry point:** `apps/cms/src/graphql/search.ts` — Strapi v5 GraphQL extension; typeDefs define `SearchResponse`; established pattern for error codes via `GraphQLError.extensions.code`.
- **Existing degraded-path test:** `apps/cms/src/api/search/services/search.test.ts:330-387` — mocks `embedQuery` rejection; must be updated for log-level and contract changes.
- **Strapi cron wiring:** `apps/cms/config/server.ts` + `apps/cms/config/cron-tasks.ts` — Strapi's built-in cron, gated by `CORE_SYNC_ENABLED`/`ENRICHMENT_AUTOMATIONS_ENABLED`; not suitable for a continuous health probe.
- **Bootstrap pattern:** `apps/cms/src/index.ts` plus `apps/cms/src/bootstrap/*.ts` — sequential async calls; any function added here gates startup. Not suitable for a third-party network probe.
- **Route/controller convention:** existing search routes in `apps/cms/src/api/search/routes/` follow Strapi's standard file-based routing — a new `GET /search/health` slots in cleanly.
- **Rate-limit bucket:** `apps/cms/src/lib/rate-limit-bucket.ts` — shared between REST and GraphQL search paths; can reuse for the health endpoint.

### Institutional Learnings

- `docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md` — documents the intentional graceful-degradation strategy. The `searchMode` field added here fits the existing "machine-readable error codes" philosophy, just extended to non-error operational states.
- `docs/solutions/best-practices/rrf-fusion-heterogeneous-content-types-20260415.md` — confirms the RRF normalization math used in the diagnosis.

### External References

External research skipped. The decisions are scoped to CMS conventions already present in the repo (Strapi logging, Strapi routes, Strapi cron, Strapi GraphQL extensions). No framework-docs lookup needed.

## Key Technical Decisions

### D1. Log level: `warn` → `error`

**Decision:** change `strapi.log.warn(...)` at `search.ts:171` to `strapi.log.error(...)` and include the error class name plus message.

**Rationale:** violating the hybrid-search contract on every query is an error, not a warning — even when the HTTP response is still 200. `error`-level lines survive default Railway log filters and are easier to target with log-based alerts. Volume risk is negligible: the log line is naturally rate-limited by search traffic.

### D2. Metric emission: process-local counters + structured log lines, no new infra

**Decision:** maintain two in-memory counters in a new `apps/cms/src/api/search/services/search-health.ts` module — `attempts` and `failures` — plus `lastErrorMessage` and `lastErrorAt`. Increment from the search service around each embedding call. Expose via the health endpoint (Unit 3). Emit a structured log line (`[search] event=query_embedding_failure error_class=... message=...`) at error level on every failure for grep-based alerting.

**Rationale:** no metrics sink exists in the CMS today. Adding InfluxDB/Datadog is net-new infrastructure outside this bug's scope. Process-local counters give meaningful per-instance signal — Railway runs one or a small number of instances, external monitors can compute deltas by polling the health endpoint. Structured log lines are the lowest-friction "metric" pattern for Railway today; the log-line contract is stable enough that a real metrics sink can be added later without breaking consumers.

### D3. Response signal: `searchMode: "hybrid" | "keyword-only"` body field

**Decision:** add a new non-optional field `searchMode` to `SearchResponse` in both the service return type, the REST response body, and the GraphQL schema. Value is `"hybrid"` when the query embedding succeeded and `"keyword-only"` when it failed.

**Rationale:**

- A body field works for REST and GraphQL uniformly. A `X-Search-Mode` header is REST-only; apps/web uses GraphQL.
- Adding a new field to a GraphQL `type` is backward-compatible: consumers that don't request it see no change; consumers that do request it can render a banner.
- `searchMode` describes _what actually ran_, which is more precise than `degraded: true` (a judgment). UI can decide whether "keyword-only" warrants a banner.
- apps/web opts in by adding `searchMode` to its existing query and re-running `packages/graphql` codegen; no coordinated rollout.

**Alternative rejected:** response header `X-Search-Mode`. Works for REST but not GraphQL; `GraphQLError.extensions` only fires on errors, and degraded mode isn't an error.

### D4. Synthetic probe: on-demand `/api/search/health` endpoint, no boot-time or cron

**Decision:** add a lightweight `GET /api/search/health` route. It runs `embedQuery("health probe")` with a short timeout and returns a JSON body: `{ status: "ok" | "degraded", error?: string, attempts, failures, lastErrorAt? }`. External monitors (Railway HTTP healthcheck, BetterStack, curl from CI) can poll at any cadence.

**Rationale:**

- **Boot-time probe rejected.** The CMS bootstrap sequence in `apps/cms/src/index.ts` is synchronous and any failure there blocks startup. Making the probe non-blocking (`.catch(log)`) produces one log line at boot — useless for ongoing regression detection. Blocking startup on a third-party API is actively worse than silent degradation because a Railway redeploy during an OpenRouter incident would fail the new instance's health check.
- **Cron probe rejected.** Strapi cron is currently gated by `CORE_SYNC_ENABLED`/`ENRICHMENT_AUTOMATIONS_ENABLED` (see `apps/cms/config/server.ts`). A cron probe runs at fixed times — less responsive than on-demand — and couples new functionality to unrelated feature flags.
- **Endpoint probe wins on flexibility.** Externally scheduled, no startup coupling, reuses the existing Strapi route/controller pattern, and cost-effectively scales (monitor polls at its own cadence).
- **Security:** the endpoint does not echo the API key or query content beyond a fixed probe string. Attempts/failures counters are low-sensitivity operational data, comparable to any Railway-visible signal. Reuse the existing `SEARCH_RATE_LIMIT` bucket to stop abuse.

### D5. Track attempts and failures separately

**Decision:** the counters track both attempts and failures (not just failures). Failure rate (`failures / attempts`) is the actionable signal; isolated failure counts are ambiguous.

**Rationale:** "5 failures in the last hour" is meaningless without "out of 5 attempts" vs "out of 500". Process-local counters reset on restart, which is acceptable — external monitors compute deltas; alerts fire on non-zero `failures` since last poll.

## Open Questions

### Resolved During Planning

- **Any downside to warn → error?** No. Same log-line volume, better default-retention and alerting behavior. Resolved.
- **Is there an existing metrics sink?** No. Adding one is out of scope; structured log lines + process-local counters are sufficient for this bug.
- **Header vs body for the response signal?** Body. GraphQL needs body-field surfacing; header doesn't reach it.
- **Boot-time probe, cron probe, or endpoint probe?** Endpoint. Boot blocks startup on a third-party call; cron is discrete and feature-flag-coupled.
- **Separate attempts and failures counters?** Yes. Failure rate is the actionable signal.

### Deferred to Implementation

- **Counter reset semantics.** Default: process-lifetime, no reset. Documented on the health-endpoint response. Sliding window can be added later if operational experience requires it.
- **Should `/api/search/health` be auth-gated?** Default: no (health endpoints are conventionally public). Easy to gate with Strapi's internal API token if a security review pushes back.
- **Should apps/web query the new `searchMode` field immediately?** Probably yes, in a follow-up PR that also adds the UI banner — but it's a separate, low-risk change gated on `packages/graphql` codegen.
- **Should the log line carry a request-ID correlation key?** The CMS doesn't propagate one today. Defer until there's a broader request-tracing initiative.

## Implementation Units

- [ ] **Unit 1: Harden the try/catch and introduce the counters module**

**Goal:** change `warn` → `error`, emit a structured log line on failure, and start tracking `attempts`/`failures`/`lastErrorMessage`/`lastErrorAt` in a shared module that the health endpoint and tests can read.

**Requirements:** R1, R2, R4.

**Dependencies:** none.

**Files:**

- Create: `apps/cms/src/api/search/services/search-health.ts` — a small, side-effect-free module exporting `recordAttempt()`, `recordFailure(error)`, `getStats()`, `resetForTest()`. Counters live in module-level closure.
- Create: `apps/cms/src/api/search/services/search-health.test.ts` — unit tests for the counter module (increment, read, reset).
- Modify: `apps/cms/src/api/search/services/search.ts` — call `recordAttempt()` before `embedQuery`; on catch, call `recordFailure(error)`, change `strapi.log.warn` to `strapi.log.error`, and include `error_class` in the log line.
- Modify: `apps/cms/src/api/search/services/search.test.ts:330-387` — update the degraded-path test to assert `strapi.log.error` is called (not `warn`) and that the log line format matches.

**Approach:**

- The counters module is intentionally tiny — two numbers plus a last-error record. No mutex, no window, no persistence. A comment on the module explains the "process-local, reset-on-restart, external monitor polls deltas" semantics.
- The log line format: `[search] event=query_embedding_failure error_class=<ErrorName> message=<stringified-message>`. Keeps grep-friendly structure without pulling in a structured-logging library.
- Reset helper is used only from tests to isolate cases.

**Patterns to follow:**

- Module-level singleton with functional API — same shape as `apps/cms/src/lib/rate-limit-bucket.ts`.
- `strapi.log.error(`[namespace] message: ${detail}`)` convention visible throughout `apps/cms/src`.

**Test scenarios:**

- `recordAttempt()` and `recordFailure()` increment the right counters independently.
- `getStats()` returns a snapshot (not a live reference) so callers can't mutate internal state.
- When `embedQuery` resolves: `attempts` incremented, `failures` unchanged, no error log.
- When `embedQuery` rejects: both `attempts` and `failures` incremented, `lastErrorMessage` populated, `strapi.log.error` called with the expected format.
- When `embedQuery` rejects with `Error("OPENROUTER_API_KEY is not set")`: log line contains `error_class=Error` and the message text.

**Verification:**

- Existing "degrades to keyword-only when embedQuery fails" test passes with updated assertions.
- New test asserts counter state after one success and one failure.
- No regression to the happy-path test — success still increments attempts and yields `queryEmbedding != null`.

- [ ] **Unit 2: Add `searchMode` to the response contract**

**Goal:** expose `searchMode: "hybrid" | "keyword-only"` in the `SearchResponse` from both REST and GraphQL without breaking existing consumers.

**Requirements:** R3, R5.

**Dependencies:** Unit 1 (reuses the same `queryEmbedding != null` signal; easier to land after the counters module exists, though not strictly required).

**Files:**

- Modify: `apps/cms/src/api/search/services/search.ts` — extend `SearchResponse` type with `searchMode: "hybrid" | "keyword-only"`; derive from `queryEmbedding != null` at the return site.
- Modify: `apps/cms/src/graphql/search.ts` — add `searchMode: String!` to the `SearchResponse` typeDef.
- Modify: `apps/cms/src/api/search/services/search.test.ts` — add assertions for `searchMode === "hybrid"` on the happy path and `searchMode === "keyword-only"` on the degraded path.
- Modify if present: `apps/cms/src/graphql/search.test.ts` — add an assertion at the GraphQL boundary.
- Run: `packages/graphql` codegen (per root CLAUDE.md's "GraphQL Change Flow") so the type surfaces in the generated client. No code changes in apps/web or apps/mobile in this plan; they can opt into the field in a follow-up.

**Approach:**

- The field is non-nullable in both REST and GraphQL — always populated. A union of two string literals communicates the contract cleanly in TypeScript and a `String!` in GraphQL keeps clients simple.
- No mapping logic needed beyond a single conditional expression at the `search()` return statement.

**Patterns to follow:**

- `SearchResponse` type is already exported from `search.ts`; adding a field keeps the single-source-of-truth pattern.
- GraphQL typeDef extension via `extensionService.use(...)` — already how `search.ts` adds the `type` filter.

**Test scenarios:**

- Happy path: `searchMode === "hybrid"` when embedding succeeds.
- Degraded path: `searchMode === "keyword-only"` when `embedQuery` rejects.
- Empty-results path: `searchMode` still reflects whether the embedding ran, even if `results.length === 0`.
- Backward compatibility: a test that destructures only `{ results, hasMore, query }` (ignoring `searchMode`) still passes — nothing we control breaks.

**Verification:**

- Types compile across `apps/cms` and `packages/graphql`.
- Introspecting the GraphQL schema locally shows `searchMode: String!` on `SearchResponse`.
- REST response includes the field.
- Existing apps/web queries keep working (they don't request the field).

- [ ] **Unit 3: Add `/api/search/health` probe endpoint**

**Goal:** expose an HTTP endpoint external monitors can poll to detect OpenRouter embedding failures without inspecting logs.

**Requirements:** R2, R4.

**Dependencies:** Unit 1 (reads from `search-health.ts`).

**Files:**

- Modify: `apps/cms/src/api/search/routes/search.ts` (or the relevant file defining the existing search route) — register `GET /search/health` with `auth: false`.
- Modify: `apps/cms/src/api/search/controllers/search.ts` — add an `async health(ctx)` method that runs `embedQuery("health probe")` with a 5-second timeout wrapper (`Promise.race`), then responds with `{ status, error?, attempts, failures, lastErrorAt? }`.
- Create: `apps/cms/src/api/search/controllers/search.test.ts` (if not already present) — test the happy and degraded paths.
- Modify: `apps/cms/src/api/search/services/search-health.ts` — export a tiny `withTimeout(promise, ms)` helper if one doesn't already exist in the codebase (a 5-line utility, not a dependency).

**Approach:**

- `status: "ok"` when the probe call resolves; `status: "degraded"` when it rejects or times out.
- Reuse `SEARCH_RATE_LIMIT` from `apps/cms/src/lib/rate-limit-bucket.ts` (conservative limit is fine — monitors poll once per minute, not hundreds of times).
- The endpoint increments `attempts`/`failures` via `search-health.ts`, so synthetic probe traffic contributes to the same counter the search service updates — giving external monitors a single source of truth.
- No new auth surface. The body echoes no user data and no credentials; it reveals only whether OpenRouter is currently reachable and aggregate attempt/failure counts.

**Patterns to follow:**

- Strapi file-based routing in `apps/cms/src/api/search/routes/`.
- Controller shape in `apps/cms/src/api/search/controllers/search.ts` (Koa context, `ctx.status`/`ctx.body`).
- Rate-limit reuse in `apps/cms/src/graphql/search.ts` (already uses `SEARCH_RATE_LIMIT`).

**Test scenarios:**

- `embedQuery` resolves → `status: "ok"`, HTTP 200, counters show one attempt / zero failures (relative to pre-test baseline).
- `embedQuery` rejects → `status: "degraded"`, HTTP 200, counters show one additional attempt and one additional failure, `error` field contains the message.
- `embedQuery` hangs → timeout triggers after 5 seconds, `status: "degraded"`, error mentions timeout.
- Rate limit exceeded → HTTP 429 with standard rate-limit response.
- No authentication header required → endpoint still responds (auth: false).

**Verification:**

- `curl https://cms.jesusfilm.org/api/search/health` returns JSON with a `status` field after deploy.
- Forcing `OPENROUTER_API_KEY` unset locally causes `status: "degraded"` on the endpoint (matches the bug's production symptom).
- Railway can be configured (manually, outside this PR) to poll the endpoint as its service healthcheck or through an external uptime monitor.

## System-Wide Impact

- **Interaction graph:** the `search()` service is called from both `apps/cms/src/api/search/controllers/search.ts` (REST) and `apps/cms/src/graphql/search.ts` (GraphQL). Both return the same `SearchResponse`; adding `searchMode` to the return value propagates automatically.
- **Error propagation:** the existing try/catch contract is preserved — embedding failures still _don't_ throw. The only change is noise level (warn→error), counter state, and an extra response field. Retrieval failures inside `Promise.allSettled` remain on the existing `error`-level path.
- **State lifecycle risks:** counters are process-local, reset on restart. Acceptable for diagnostic probes; not suitable as a system-of-record. Documented in the module comment.
- **API surface parity:** `searchMode` is added to REST and GraphQL in the same PR so the two APIs stay aligned. apps/mobile (REST consumer) and apps/web (GraphQL consumer) can adopt the field independently.
- **Integration coverage:** unit tests cover service-level behavior; the health endpoint needs at least one integration-style test that exercises the controller boundary (rate-limit + response shape).
- **Codegen coupling:** the GraphQL schema change means `packages/graphql` must be regenerated. This follows the "GraphQL Change Flow" in the root CLAUDE.md and is a required step before the PR is green.

## Risks & Dependencies

- **GraphQL schema drift:** if `packages/graphql` codegen is not re-run in the same PR, downstream apps will see stale types. Mitigation: include regenerated files in the PR; CI should surface the drift.
- **False-positive error alerts during the operational fix window:** until `OPENROUTER_API_KEY` is rotated in Railway, every search query will log an error line. That's expected — it's exactly the signal we want. Note this in the PR description and document it as "resolve operational fix (A) before this PR's alerts become meaningful for ongoing monitoring."
- **Probe endpoint abuse:** the `/api/search/health` endpoint calls OpenRouter on every hit. Without rate-limiting, an attacker could run up OpenRouter costs. Mitigation: reuse `SEARCH_RATE_LIMIT` or a stricter per-IP cap for this endpoint.
- **Probe timeout tuning:** 5 seconds is a reasonable default given OpenRouter's 10-second client timeout. If real-world latency is higher, the timeout may need adjusting; easy to tune since it's a single constant.

## Documentation / Operational Notes

- Update `docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md` to document the `searchMode` field and the `/api/search/health` endpoint as part of the public contract.
- Update `docs/roadmap/content-discovery/feat-097-investigate-prod-query-embedding.md` to `status: in-progress` when work starts, `status: complete` when merged and verified in production.
- Capture the "process-local counters as a pragmatic stand-in for a metrics sink" decision in `docs/solutions/` via `ce:compound` after shipping — this may apply across packages that also lack metric infrastructure.
- Operational rollout: after merge, Railway ops (outside this PR) should configure the `forge-cms` service healthcheck to poll `/api/search/health` every 60 seconds and page on `status: "degraded"`. That turns the code changes into an actionable alert channel.

## Sources & References

- **Origin document:** [docs/roadmap/content-discovery/feat-097-investigate-prod-query-embedding.md](../roadmap/content-discovery/feat-097-investigate-prod-query-embedding.md)
- Related code: `apps/cms/src/api/search/services/search.ts`, `apps/cms/src/lib/openrouter.ts`, `apps/cms/src/api/search/services/fusion.ts`, `apps/cms/src/graphql/search.ts`, `apps/cms/config/cron-tasks.ts`, `apps/cms/src/index.ts`
- Related issue: JesusFilm/forge#778
- Related PRs: JesusFilm/forge#744 (feat-010 original search), JesusFilm/forge#777 (feat-086 experience search — surfaced this bug during validation)
- Institutional learnings: [docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md](../solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md), [docs/solutions/best-practices/rrf-fusion-heterogeneous-content-types-20260415.md](../solutions/best-practices/rrf-fusion-heterogeneous-content-types-20260415.md)
