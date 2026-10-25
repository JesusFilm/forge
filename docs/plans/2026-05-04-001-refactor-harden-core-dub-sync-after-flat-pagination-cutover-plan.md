---
title: Harden Core dub-sync after flat-pagination cutover
type: refactor
status: active
date: 2026-05-04
---

# Harden Core dub-sync after flat-pagination cutover

## Overview

The video-dubs Core sync phase was just refactored from a nested `videos { variants { … } }` batched query (which tripped Core's ~50s resolver timeout on megavideos like JFP-Classic) to a flat top-level `videoVariants(offset, limit)` paginated loop with `PAGE_SIZE=100` and a per-page try/catch. The refactor unblocked full coverage — **1,088 / 1,088 videos, 209,297 dub rows** — but landed with sharp edges that this plan cleans up: a soft-delete bind-variable overflow that aborts the cleanup tail of every full run, an outdated unit test still mocking the old nested response shape, missing rationale for the `PAGE_SIZE` choice, no documentation of the new pagination pattern in `CLAUDE.md`, and no captured solutions doc for the Core-side root cause that future readers will need to understand why the client looks the way it does.

This plan does not change the runtime contract: same writes, same idempotency, same per-page error isolation. It hardens the periphery so the refactor is durable.

## Problem Frame

After the flat-pagination cutover, a single full sync still terminates with:

```
Invalid `prisma.videoDub.updateMany()` invocation in
.../sync-dubs.ts:366
Assertion violation on the database: too many bind variables in prepared statement,
expected maximum of 32767, received 209300
```

`prisma.videoDub.updateMany({ where: { coreId: { notIn: [...seenCoreIds] } } })` translates to a `NOT IN ($1, $2, …, $N)` prepared statement. Postgres caps prepared-statement parameters at 32,767 (`PG_INT16_MAX`). With 209k+ seen IDs the soft-delete tail blows past that and never runs — meaning Core-side deletions stop being mirrored to admin until the call is reshaped.

Adjacent gaps:

- The first test in `sync-dubs.test.ts` mocks the now-removed `{ videos: [{ variants: [...] }] }` response shape and would silently process 0 rows under the new code (regression that wasn't caught by the existing harness).
- `PAGE_SIZE = 100` is a load-bearing constant whose rationale (Core resolver fan-out cliff between limit=5 and limit=25 in our probe data) lives only in this session's chat history.
- `CLAUDE.md` doesn't mention the dubs phase or the diagnosis at all; future contributors will repeat the trial-and-error.
- The Core-side root cause (Pothos `t.prismaField` collapsing nested includes without a `take` cap → unbounded relation fan-out → ~50s Postgres `statement_timeout` → masked as `INTERNAL_SERVER_ERROR`) is documented only in a Core-team agent report scoped to this session. Worth durable capture under `docs/solutions/`.
- Two incidental in-flight changes need explicit retention decisions: the `@map("video_source")` fix on `schema.prisma:670` (a separate pre-existing column-name mismatch bug) and the widened `CoreGraphQLError.errors` type in `core-client.ts` (added for diagnostic logging — the diagnostic try/catch is now removed, but the wider type is still useful for the new per-page error logger).

## Requirements Trace

- **R1.** Full sync completes without hitting the 32,767 prepared-statement parameter limit, regardless of catalogue size.
- **R2.** Core-side dub deletions continue to be mirrored to admin via soft-delete after R1's fix, with the existing safety guard preserved (`!since && stats.errors === 0`).
- **R3.** `sync-dubs.test.ts` reflects the new query shape and covers the regressions that this session uncovered (page-error continuation, soft-delete bind-var fix, since vs full both routing through one loop).
- **R4.** `PAGE_SIZE` and the `CoreGraphQLError` widening have inline rationale a reader can follow without external context.
- **R5.** Future contributors can find the dubs-phase architecture and runbook in `apps/admin/CLAUDE.md`.
- **R6.** The Core-side root cause + client-side mitigation pattern is captured in `docs/solutions/` so the next person hitting unbounded relation fan-out from Core inherits the diagnosis.
- **R7.** The `@map("video_source")` fix is preserved with a one-line rationale comment so it isn't reverted by a future schema sweep.

## Scope Boundaries

- **In scope:** `sync-dubs.ts`, `sync-dubs.test.ts`, `core-client.ts`, `apps/admin/CLAUDE.md`, the new solutions doc, the `@map` retention decision on `schema.prisma`.
- **Out of scope:** filing the upstream Core issue (captured as a follow-up in the new solutions doc, not as an implementation unit); re-merging `origin/main` to pick up the media-asset migrations (separate concern); any change to `processVariantPage`'s row-write semantics; the lingering `pnpm dev` from the prior session.
- **Non-goal:** introducing a new Prisma migration. The `@map` fix is schema-only — the `video_source` column already exists in `0001_init`. No DDL change.
- **Non-goal:** restoring the nested `DUBS_BY_VIDEOS_QUERY` path. The flat-pagination shape is intentionally the only path now; the `since` and full branches share one loop.

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/services/core-sync/phases/sync-dubs.ts` — the refactored phase (378 LOC, single while-loop over `DUBS_QUERY` with try/catch).
- `apps/admin/src/services/core-sync/phases/sync-dubs.test.ts` — existing test harness using `vi.mock("../core-client")` and a tx fake; first test still references the dead nested response shape.
- `apps/admin/src/services/core-sync/core-client.ts` — `CoreGraphQLError.errors` was widened from `{ message }[]` to `{ message, path?, locations?, extensions? }[]` for diagnostic logging.
- `apps/admin/src/services/core-sync/phases/sync-videos.ts` and `sync-keywords.ts` — sibling phases for shape comparison (other paginated phases that have NOT hit the bind-var limit yet because their seen-set sizes are smaller; same fix pattern would apply if they grow).
- `apps/admin/prisma/schema.prisma:670` — `videoSource` field, now annotated `@map("video_source")` to match the snake-case column from `0001_init`.

### Institutional Learnings

- `docs/solutions/platform/admin-core-sync-entity-coverage.md` — umbrella doc for the admin-side Core sync graph. New doc files as a sibling and is linked from this one's `related:` list.
- `docs/solutions/cms/core-sync-bulk-update-temp-table-pattern.md` — the canonical fix for "bulk update on Postgres without hitting the parameter limit": temp table + `UPDATE … FROM`. Reuse this shape for the soft-delete fix.
- `docs/solutions/cms/core-sync-incremental-delta-sync.md` — establishes the "soft-delete only on full sync" rule. Existing `!since && stats.errors === 0` guard already complies; the fix must preserve it.
- `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md` — if we add `$queryRaw` for the soft-delete fix, the test must assert the SQL string contains the load-bearing clauses, not just the row-mapping.
- `docs/solutions/cms/core-sync-per-page-upsert-pattern.md` — the per-page write pattern the refactor already follows; cite from the new solutions doc as the upstream norm being preserved.
- `docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md` — closest "GraphQL pagination + nested-relation cost" precedent. The lesson generalizes to Core's Pothos `t.prismaField` behavior.

### External References

None gathered. The Core-team agent report (delivered in this session's chat history) is the authoritative external input and is reproduced verbatim in the new solutions doc; no further external research adds value for this scope.

## Key Technical Decisions

- **Soft-delete fix uses raw SQL `NOT = ANY($1::text[])` against an array param**, not chunked `notIn` and not a temp table for v1. Rationale: array-as-single-param sidesteps the 32,767 limit with the smallest blast radius — one bind variable holds the whole list, Postgres parses it once, and the `UPDATE` stays atomic. Temp table (per the bulk-update-pattern doc) is more elaborate than this case warrants because the soft-delete is read-only-ish (single UPDATE, no JOIN against fetched rows). If a future phase needs to bulk-write derived data per row, it should use the temp-table pattern; we don't.
- **Keep the wider `CoreGraphQLError.errors` type.** The diagnostic try/catch around `coreQuery` is gone, but the new per-page error logger at `sync-dubs.ts:332` still benefits from being able to surface `extensions.code` and `path` when Core fails a page. The wider type costs nothing and improves future debugging.
- **Keep `@map("video_source")` on `Video.videoSource`.** It's a schema-only correction for a pre-existing field/column mismatch. Reverting it would re-break sync at `tx.video.upsert(...)`. Add a one-line `///` doc comment explaining why so a future schema sweep doesn't strip it.
- **Document `PAGE_SIZE = 100` with a probe-result comment.** Per our limit=5 → 240ms vs. limit=25 → 50s probe data, 100 is the "fits inside the resolver-cost budget for a flat list with downloads/muxVideo/edition fan-out" sweet spot. If Core ships their `take` cap on `Video.variants`, this could safely be raised; the comment says so.
- **Solutions doc lives under `docs/solutions/platform/`**, not `integration-issues/`. Per the learnings researcher: `admin-core-sync-entity-coverage.md` is the umbrella sibling under `platform/`, and the new doc cross-references it.
- **Tests use mocked `coreQuery` and a Prisma fake** — same shape the existing tests use. Don't introduce a real-DB integration test for this; the integration story has already been validated by the 209k-row run.

## Open Questions

### Resolved During Planning

- **Soft-delete fix shape**: array-param raw SQL, not temp-table, not chunked. (Rationale above.)
- **Solutions doc location**: `docs/solutions/platform/`, sibling of `admin-core-sync-entity-coverage.md`. (Per learnings researcher.)
- **`@map("video_source")` retention**: keep, with rationale comment. (Pre-existing bug; reverting re-breaks sync.)
- **`CoreGraphQLError` widening retention**: keep, used by per-page error logger.

### Deferred to Implementation

- **Exact rendered SQL shape for the soft-delete `$executeRaw`** — Prisma's tagged-template behavior with `string[]` array parameters needs a manual sanity check against the dev DB once the code is written; minor risk that the array-param coercion needs an explicit `::text[]` cast. The unit test will assert the SQL contains `NOT = ANY` and `deleted_at IS NULL`, which catches this.
- **Whether to log a `core-sync.video-dub.soft-delete.complete` event** alongside the existing softDeleted-count stat — depends on whether the orchestrator already structurally surfaces softDeleted; the implementer should mirror what other phases emit.
- **Whether to retain `firstPageCount` or rename it `firstPageVariantCount`** — rename is editorial; defer to implementer's judgement when reading the new code in context.

## Implementation Units

- [ ] **Unit 1: Restore test-suite truth and add regression coverage**

**Goal:** `sync-dubs.test.ts` reflects the post-refactor query shape, covers the page-error continuation path, and locks in the bind-var fix as a regression that can't silently re-break.

**Requirements:** R3.

**Dependencies:** None — this lands first so subsequent units have a working safety net.

**Files:**

- Modify: `apps/admin/src/services/core-sync/phases/sync-dubs.test.ts`

**Approach:**

- Rewrite the first test ("writes edition, mux metadata, and download rows for a Core variant") to mock `{ data: { videoVariants: [...] } }` instead of the dead nested `{ data: { videos: [...] } }` shape. The assertions on the tx fake stay the same; only the input shape changes.
- Add a test that asserts: when `coreQuery` rejects with a `CoreGraphQLError` on page N, the loop logs `core-sync.video-dub.page.error` to `console.error`, increments `stats.errors`, advances `offset` by `PAGE_SIZE`, and continues to fetch page N+1.
- Add a test that asserts: after a successful full sync (no `since`, `stats.errors === 0`, `seenCoreIds.size > 32_767`), the soft-delete call doesn't throw. The test mocks `prisma.$executeRaw` (or whichever raw-SQL primitive Unit 2 picks) and asserts it's called with bound params containing the full ID list, not 32,767+ separate parameters. Per `prisma-raw-sql-invariant-assertions-20260423`, also assert the SQL string contains `NOT = ANY` and `deleted_at IS NULL`.
- Add a test that asserts: when `since` is provided, the loop calls `coreQuery` with `input: { updatedAt: { gte: since } }`, and when `since` is absent, with `input: undefined`. Same loop, two paths.

**Execution note:** Test-first. Write Unit 2's regression assertion (the >32k soft-delete case) before Unit 2's code change so the test fails red against the current implementation, then turns green when Unit 2 lands.

**Patterns to follow:**

- Existing `vi.mock("../core-client", ...)` pattern at the top of the file.
- `vi.spyOn(console, "warn"|"error").mockImplementation(...)` from the second existing test.
- `prisma-raw-sql-invariant-assertions-20260423` for SQL-shape assertions on the raw-SQL test.

**Test scenarios:**

- Happy path: one page, one variant, asserts tx fake calls (current first test, with input shape fixed).
- Skipped-missing-video: variant whose `videoId` isn't in `videoMap` is skipped with `core-sync.video-dub.skipped-missing-videos` warn (current second test, no change needed).
- Page-error continuation: `coreQuery` mock rejects on second call, third call returns one variant; assert phase completes with `stats.errors === 1`, processed variant landed, `console.error` was called with `event=core-sync.video-dub.page.error`.
- Bind-var-safe soft-delete: `seenCoreIds.size = 35_000` (above the 32,767 limit); assert `prisma.$executeRaw` (or chosen primitive) was called once with array param containing all 35,000 IDs and the SQL string matches the load-bearing pattern.
- `since` routes through the same loop with the right `input`.
- `since` skips soft-delete entirely (`stats.softDeleted === 0`).

**Verification:**

- `pnpm --filter @forge/admin test sync-dubs` runs the new test list and passes.
- The bind-var-safe test fails when run against the current `prisma.videoDub.updateMany({ where: { coreId: { notIn: [...] } } })` code; passes once Unit 2 lands.

---

- [ ] **Unit 2: Fix soft-delete bind-variable overflow with array-param raw SQL**

**Goal:** Soft-delete tail of full sync completes successfully on a 200k+ seen-set without hitting Postgres's 32,767 prepared-statement parameter limit.

**Requirements:** R1, R2.

**Dependencies:** Unit 1's regression test exists (Test-first per `Execution note`).

**Files:**

- Modify: `apps/admin/src/services/core-sync/phases/sync-dubs.ts` (around line 365)

**Approach:**

- Replace the `prisma.videoDub.updateMany({ where: { source: "CORE", coreId: { notIn: [...seenCoreIds] }, deletedAt: null }, data: { deletedAt: new Date() } })` call with a `prisma.$executeRaw` (or `Prisma.sql` template) that issues:
  ```
  UPDATE "video_dub"
  SET    "deleted_at" = NOW()
  WHERE  "source"    = 'CORE'
    AND  "deleted_at" IS NULL
    AND  NOT ("core_id" = ANY($1::text[]))
  ```
  with `$1` bound to the `Array.from(seenCoreIds)` array. One bind variable, no parameter-limit exposure.
- Capture the affected row count from `$executeRaw`'s return value into `stats.softDeleted` exactly as before.
- Preserve the existing guard: `if (!since && stats.errors === 0 && seenCoreIds.size > 0)`. No behavioral change to when soft-delete runs.
- Verify the column name is `core_id` (snake_case) and table is `video_dub` against `prisma/schema.prisma:VideoDub` `@map` annotations before writing the SQL string. If `@@map` differs, use the actual mapped name.

**Patterns to follow:**

- `apps/admin/src/db/pgvector.ts::toPgArray()` and the PG-array note in root `CLAUDE.md` for array-param shape on Railway PG18.
- `docs/solutions/cms/core-sync-bulk-update-temp-table-pattern.md` — referenced as the heavyweight cousin of this fix for the doc.
- Other admin raw-SQL call sites for `Prisma.sql` template style (`apps/admin/src/services/scene-embedding.service.ts` writes embeddings via `$queryRaw`).

**Test scenarios:** Covered by Unit 1's bind-var-safe test.

**Verification:**

- The Unit 1 regression test that previously failed against the old code passes against this change.
- `pnpm --filter @forge/admin typecheck` clean.
- (Optional, nice-to-have) Manual smoke: re-run `pnpm core-sync:run --full --scope=video-dubs` against the local DB; the `phase.complete` event emits `errors: 0` and `softDeleted` populated when applicable.

---

- [ ] **Unit 3: Annotate load-bearing constants and prune dead diagnostic state**

**Goal:** Future readers can understand why `PAGE_SIZE = 100`, why `CoreGraphQLError.errors` is widened, and which incidental session edits were intentional retentions.

**Requirements:** R4, R7.

**Dependencies:** None.

**Files:**

- Modify: `apps/admin/src/services/core-sync/phases/sync-dubs.ts`
- Modify: `apps/admin/src/services/core-sync/core-client.ts`
- Modify: `apps/admin/prisma/schema.prisma`

**Approach:**

- Add a comment block above `PAGE_SIZE = 100` describing the Core resolver fan-out cliff (limit=5 → 240ms, limit=25 → 50s timeout from our probes), pointing the reader at the new solutions doc, and noting that the value can be raised if Core lands a `take` cap on `Video.variants`.
- Verify and retain `firstPageCount` semantic (page-zero variant count, used only by the `empty_first_page` soft-delete-skip guard at line 355). The semantic is unchanged from the old `since`-branch behavior; what changed is that the old full branch used `videos.length`. Either keep the variable name or rename to `firstPageVariantCount` for clarity (implementer's call).
- Add a `///` JSDoc above `CoreGraphQLError` in `core-client.ts` explaining that the `errors` array carries `path` / `locations` / `extensions` so per-page error loggers can surface `extensions.code` and `path[0]` for diagnosis. Reference the new solutions doc.
- Add a `///` doc comment above `videoSource` in `schema.prisma:670` noting that `@map("video_source")` is required because `0001_init` created the column as snake_case while the field name is camelCase — and that removing the `@map` re-breaks `tx.video.upsert(...)` in `sync-videos.ts`.

**Patterns to follow:**

- `///` Prisma doc-comment style already present elsewhere in `schema.prisma` (e.g., `aiMetadata` at line 675).
- Other `// rationale: …` comments in `apps/admin/src/services/core-sync/` for inline-decision style.

**Test scenarios:**

- Re-run existing tests; all stay green (this unit changes no behavior).

**Verification:**

- `pnpm --filter @forge/admin typecheck` clean.
- `pnpm --filter @forge/admin lint` clean.
- A reader new to the file can answer "why 100?" and "why does this Prisma model have @map but its sibling fields don't?" by reading the file alone.

---

- [ ] **Unit 4: Document the dubs phase in `apps/admin/CLAUDE.md`**

**Goal:** Future contributors can find the dubs-phase architecture, the Core-side root cause, and the operational shape of a re-run from `CLAUDE.md` without spelunking commit history.

**Requirements:** R5.

**Dependencies:** Unit 6 has been drafted (so we can cite its filename in the link).

**Files:**

- Modify: `apps/admin/CLAUDE.md`

**Approach:**

- Add a "## Core sync — video-dubs phase" subsection adjacent to the existing Core-sync coverage block (search for `runCoverageAudit` / `core-sync` headings).
- Cover: (a) what the phase writes (`VideoDub` + `VideoDubDownload` + `VideoEdition` + `MuxVideo`); (b) the flat-pagination shape (`videoVariants(offset, limit, input)` with `PAGE_SIZE = 100`); (c) per-page try/catch isolation and the soft-delete safety guard (`!since && stats.errors === 0`); (d) the bind-var-safe soft-delete via array-param raw SQL; (e) operational runbook ("expect ~30-40 min on a fresh DB at current catalogue size, ~85% of wall time spent on JFP-Classic-class megavideos"); (f) link to the new solutions doc for the upstream Core diagnosis.
- Stress the data-derived "no hardcoded language list" rule still applies — the dubs phase materializes the data the embed workflows enumerate against.

**Patterns to follow:**

- The existing "## Scene embeddings (R1 …)" and "## Transcript embeddings (R2 …)" subsection style — schema, indexer service, backfill workflow, operational runbook, "common things to remember."

**Test scenarios:** Documentation only — no executable assertions. Verified by editorial pass.

**Verification:**

- Section reads coherently in isolation.
- A new contributor briefed only on `CLAUDE.md` can answer: "If I add a new phase that fetches a relation-heavy nested entity from Core, what should I do?" with: "Use Core's flat top-level paginated query; don't use `videos { variants {} }` style; add per-page try/catch; soft-delete via array-param raw SQL when seen-set may exceed 32k."

---

- [ ] **Unit 5: Capture Core unbounded-fan-out diagnosis as a solutions doc**

**Goal:** The next person who hits "Core returns `INTERNAL_SERVER_ERROR` after 50s on a deep selection set" finds the diagnosis without re-running our session.

**Requirements:** R6.

**Dependencies:** None — but Unit 4 cites this file's path, so write this first or in parallel.

**Files:**

- Create: `docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md`

**Approach:**

- Frontmatter: `title`, `date: 2026-05-04`, `module: apps/admin`, `severity: high`, `related: [admin-core-sync-entity-coverage.md, core-sync-bulk-update-temp-table-pattern.md, core-sync-incremental-delta-sync.md, core-sync-per-page-upsert-pattern.md]`.
- Sections (mirror the style of `admin-core-sync-entity-coverage.md`):
  1. **Symptom** — Core returns `{ "errors": [{ "message": "Unexpected error.", "path": ["videos"], "extensions": { "code": "INTERNAL_SERVER_ERROR" }}] }` after ~50s on `videos(limit:N){ variants { downloads, muxVideo, videoEdition }}` for N≥25 when megavideos are in the batch.
  2. **Diagnostic probe table** — verbatim from this session: limit=1 ok 1.0s, videoVariants(limit:1) ok 1.4s, languages(limit:1) ok 0.2s, videos(limit:5)+variants ok 0.2s, videos(limit:25)+variants+muxVideo+downloads **fail at 50.4s**.
  3. **Root cause (Core-side)** — Pothos `t.prismaField` collapses the entire selection set into one `prisma.video.findMany` graph; `Video.variants` has no `take` cap; megavideos like JFP-Classic (~2,000 variants × ~5 downloads each) push the result set past Postgres's `statement_timeout` (~50s). Apollo masks the real exception as `"Unexpected error"`. Reference the Core-side fix recommendation (server-side `take: 200` default + paginated `variants` field).
  4. **Client-side mitigation** — flat top-level pagination (`videoVariants(offset, limit, input)`), `PAGE_SIZE` between Core's safe-cost ceiling and one's tolerable round-trip count (we picked 100), per-page try/catch so one failed page doesn't abort the loop, soft-delete via array-param raw SQL to handle resulting large seen-sets.
  5. **Why this matters beyond dubs** — any Core sync phase or admin reader that reaches into a relation with unbounded cardinality (e.g., `Edition.subtitles`, `Video.keywords`) will hit the same wall when megavideos enter their working set. Cite the closest precedent in the repo (`strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md`).
  6. **Validation** — local sync ran 1,088 / 1,088 videos, 209,297 dub rows, zero page errors, ~35 min wall time.
  7. **Follow-up: file upstream Core issue** — paste the diagnostic prompt + Core-team agent's response inline (or link to a separate gist if the doc gets long).

**Patterns to follow:**

- `docs/solutions/platform/admin-core-sync-entity-coverage.md` for section structure and tone.
- Other `docs/solutions/integration-issues/` and `docs/solutions/platform/` docs for frontmatter shape.

**Test scenarios:** Documentation only — verified by editorial pass and link integrity.

**Verification:**

- All `related:` paths resolve to existing files.
- `admin-core-sync-entity-coverage.md`'s `related:` list is updated to include this doc (one-line edit; bundle into this unit).

---

- [ ] **Unit 6: Compile-time + lint clean and final manual smoke**

**Goal:** No regressions slip through the cleanup; the assembled change is mergeable.

**Requirements:** All — final acceptance gate.

**Dependencies:** Units 1-5.

**Files:** None modified — verification only.

**Approach:**

- `pnpm --filter @forge/admin typecheck`, `pnpm --filter @forge/admin lint`, `pnpm --filter @forge/admin test sync-dubs` all clean.
- One end-to-end `pnpm core-sync:run --full --scope=video-dubs` against local DB; assert `phase.complete` event reports `errors: 0` and any `softDeleted` count is plausible (could be 0 since local is post-fresh-sync state).
- Run `pnpm core-sync:run --full` (all phases) once to confirm no other phase regressed during the cleanup pass.

**Verification:**

- All checks green.
- `git diff` review shows only the in-scope files touched, no incidental drift.

## System-Wide Impact

- **Interaction graph:** None — `processVariantPage`'s tx fake contract is preserved verbatim; no change to row writes, no change to the orchestrator's per-phase contract, no change to the workflow callbacks consuming `VideoDub` rows downstream (scene/transcript embed enumeration JOINs `video_dub` and benefits from the now-complete data with no code change).
- **Error propagation:** Per-page errors are isolated and counted (`stats.errors++`); the phase still surfaces total errors to the orchestrator's `phase.complete` event. Soft-delete still gated by `stats.errors === 0` so a partial seen-set never mass-deletes.
- **State lifecycle risks:** The `@map("video_source")` retention and `CoreGraphQLError` widening have no migration component; both are forward-only schema-only / type-only edits.
- **API surface parity:** `VideoDub` GraphQL types and resolvers are unchanged. The existing `embedding | vector | similarit` field-leak guard in `schema.test.ts` keeps applying.
- **Integration coverage:** The 209k-row local run is the integration proof for the runtime path. Tests added in Unit 1 are unit-level — same level as the existing test file. Real-DB integration coverage (a megavideo seed + full sync against Postgres) is deferred to whatever harness the next phase rewrite warrants; not adding it as part of this cleanup.

## Risks & Dependencies

- **Risk: array-param raw-SQL coercion misbehaves on Railway PG18.** Mitigation: Unit 1's regression test asserts the rendered SQL contains `NOT = ANY` and `text[]`. Unit 6's manual smoke run catches any runtime mismatch before merge.
- **Risk: someone reverts `@map("video_source")` thinking it's stylistic.** Mitigation: Unit 3 adds a `///` rationale comment specifically calling out the breakage.
- **Risk: the new `core-sync.video-dub.page.error` log volume becomes noisy if Core regresses widely.** Mitigation: per-page errors are gated on actual `coreQuery` rejections; healthy days emit zero. If Core regresses to consistent failure, one log per 100 variants is still bounded (~50 messages on a 5,000-variant catalogue worst case) and the structured shape makes filtering trivial.
- **Dependency: solutions doc presumes the Core-team agent's diagnosis is accurate.** Mitigation: the doc cites it as the diagnosis we received and leaves room for the upstream Core team to refute or refine; the client-side mitigation works regardless of whether Pothos-fan-out or Postgres-statement-timeout is the precise mechanism.

## Documentation / Operational Notes

- `apps/admin/CLAUDE.md` gains a new subsection (Unit 4).
- `docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md` is created (Unit 5).
- `docs/solutions/platform/admin-core-sync-entity-coverage.md`'s `related:` list gets one new entry (Unit 5).
- No runbook change for operators — `pnpm core-sync:run --full` invocation is identical; just expect it to actually finish now.
- Follow-up todo (not implemented in this plan): file the upstream Core issue using the diagnostic prompt + Core-team agent's response captured in Unit 5's solutions doc. Owner: nisal.

## Sources & References

- Refactor commit (uncommitted on `fix/keyword-first-camelcase-recall` as of plan date) — `git diff` shows the relevant `sync-dubs.ts`, `core-client.ts`, `schema.prisma` changes.
- Core-team agent's diagnosis report (in this session's chat history; reproduced in Unit 5's solutions doc).
- Local probe results from this session: limit=1 → 1.0s ok, limit=25 → 50.4s INTERNAL_SERVER_ERROR.
- Local validation: 1,088 / 1,088 videos with dubs, 209,297 dub rows, zero page errors, 2,104s wall time.
- Related solutions:
  - `docs/solutions/platform/admin-core-sync-entity-coverage.md`
  - `docs/solutions/cms/core-sync-bulk-update-temp-table-pattern.md`
  - `docs/solutions/cms/core-sync-incremental-delta-sync.md`
  - `docs/solutions/cms/core-sync-per-page-upsert-pattern.md`
  - `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`
  - `docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md`
