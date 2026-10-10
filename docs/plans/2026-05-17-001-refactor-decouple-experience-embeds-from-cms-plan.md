---
title: Decouple admin experience embeddings from cms
type: refactor
status: completed
date: 2026-05-17
completed: 2026-05-17
origin: docs/brainstorms/2026-04-23-r3-experience-content-migration-requirements.md
---

# Decouple admin experience embeddings from cms

## Overview

R3 (the experience-content-dump workflow) was built to port cms's Strapi v5 `experiences` corpus into admin during the R3 → R8 migration window. Experiences now live in admin natively — the editor surface, the canonical store, the consumer-facing renderer (via the data-layer flip in `feat/web-admin-data-layer-flip`) all sit on admin. cms is being deleted, so the dump is dead weight: it depends on a `CMS_DATABASE_URL` that no longer points at a corpus worth dumping.

This plan does three things:

1. Adds an admin-native bulk-embed entry point so existing `ExperienceLocale` rows can be embedded without going through a cms dump (replaces the embed-dispatch role the dump played).
2. Deletes the dump workflow + service + cms-coupled modules + `CMS_DATABASE_URL` + the dump's permission key + snapshot columns on `ExperienceLocale`.
3. Updates `apps/admin/CLAUDE.md` and the roadmap to reflect admin-native operation.

The downstream `runExperienceEmbedding` workflow (`apps/admin/src/workflows/experienceEmbedding.ts`) is already admin-native — it reads from `prisma.experienceLocale` and writes the vector back. The publish path in `apps/admin/src/services/experience.service.ts:573` already dispatches it on every publish/update. Nothing in the embedding step itself needs to change.

## Problem Frame

The origin document (`docs/brainstorms/2026-04-23-r3-experience-content-migration-requirements.md`) explicitly scoped R3 to the "R3 → R8 window" with cms canonical for experience content. That premise has collapsed:

- Experiences are now authored and published in admin directly.
- cms's experiences corpus is empty / going away.
- The local-dev attempt to invoke `triggerExperienceContentDump` on 2026-05-15 (see `docs/solutions/deployment/admin-local-dev-cms-content-dump-blocked-20260515.md`) surfaced three stacked dev-environment gauntlets blocking the mutation. Rather than fix the gauntlets for a workflow that's about to be deleted, we delete the workflow.

The user-visible trigger today: the operator wants to capture a semantic-search eval baseline (PR #922) with experience-side ranking covered. That requires `experience_locale.embedding` populated. The dump was the documented path to "get experience embeddings populated"; with cms gone, we need a path that doesn't pass through cms.

## Requirements Trace

- **R1.** Admin can populate `ExperienceLocale.embedding` for every eligible existing row without reading cms.
- **R2.** The dump workflow + GraphQL mutation + CLI + permission key + cms-coupled service modules + `CMS_DATABASE_URL` env are removed from the admin codebase (no orphaned dead code).
- **R3.** `cms_document_id`, `cms_dumped_at`, `cms_content_hash` are removed from `experience_locale` via a forward-only migration so the schema reflects current reality.
- **R4.** `apps/admin/CLAUDE.md` no longer documents R3 as an operational surface; replaced with a short "Triggering experience embeddings" section that mirrors R1/R2's runbook shape.
- **R5.** No existing consumer (apps/web, apps/mobile, apps/tv, apps/cms, apps/manager, packages/admin-graphql) breaks. The data-layer-flip branch (`feat/web-admin-data-layer-flip`, the U9-U22 work referenced in the freeze at the top of root `CLAUDE.md`) is unaffected because it never depended on the dump.
- **R6.** GraphQL artifacts (`apps/admin/schema.graphql` and `packages/admin-graphql/src/admin-graphql-env.d.ts`) are regenerated and committed.

## Scope Boundaries

- **Not** a redesign of how experience content gets into admin in the first place. Authoring happens through admin's editor surface and existing service mutations (`createExperience`, `updateExperienceLocale`, `publishExperienceLocale`, etc.); none of that is in scope.
- **Not** a deprecation announcement to external consumers — internal grep proves nothing outside admin calls the dump mutation. The introspection drop in `packages/admin-graphql` is a side-effect of regen, not a breaking change for any live caller.
- **Not** a change to the embedding model, vector dimensions, hybrid-search service, or `runExperienceEmbedding` workflow body.
- **Not** removal of `ContentRevision` snapshot semantics for experiences. Editor revisions stay; only the cms-dump bookkeeping leaves.
- **Not** a change to R1 (scene embeddings) or R2 (transcript embeddings). Those pipelines are admin-native already.
- **Not** an immediate Doppler clean-up of `CMS_DATABASE_URL` on the `forge-admin` project. Removing the var from the Doppler config is a follow-up; admin tolerates the env-var presence/absence either way once the consumer is gone.

## Context & Research

### Relevant Code and Patterns

**Files to delete (cms-coupled, dump-specific):**

- `apps/admin/src/workflows/experienceContentDump.ts` (+ `.test.ts`)
- `apps/admin/src/services/experience-content-dump.service.ts` (+ `.test.ts`)
- `apps/admin/src/services/cms-experience-source.repository.ts`
- `apps/admin/src/services/cms-experience-source.types.ts`
- `apps/admin/src/services/cms-experience-source.fake.ts` (+ `.test.ts`)
- `apps/admin/src/services/cms-block-transforms.ts` (+ `.test.ts`)
- `apps/admin/src/services/cms-video-id-resolver.ts` (+ `.test.ts`)
- `apps/admin/src/db/cms-pg.ts` (+ `.test.ts`)
- `apps/admin/src/graphql/mutations/experience-content-dump.ts` (+ `.test.ts`)
- `apps/admin/src/scripts/run-experience-dump.ts`

**Files to edit (subtractive):**

- `apps/admin/src/graphql/schema.ts` — remove side-effect `import "@/graphql/mutations/experience-content-dump"` at line 24.
- `apps/admin/src/auth/permissions.ts` — remove `"write:experience-content-dump"` from the `PermissionKey` union (line 53) and from the tier matrix (line 96). TypeScript's exhaustiveness check across both surfaces means atomic removal.
- `apps/admin/src/config/env.ts` — remove `CMS_DATABASE_URL` Zod entry (line ~276 in the schema block) and its `emptyToUndefined(...)` consumer.
- `apps/admin/package.json` — remove the `"run-experience-dump": "tsx src/scripts/run-experience-dump.ts"` script entry.
- `apps/admin/prisma/schema.prisma` — drop `cmsDocumentId`, `cmsDumpedAt`, `cmsContentHash` (and the JSDoc block above them) from the `ExperienceLocale` model (lines ~1205–1224).

**Files to keep (admin-native, no cms dependency):**

- `apps/admin/src/workflows/experienceEmbedding.ts` — admin-native workflow. Reads `prisma.experienceLocale.findUniqueOrThrow(...)` and writes the vector back. Untouched.
- `apps/admin/src/services/embeddings.service.ts` — provider client. Already gated on `OPENROUTER_API_KEY || OPENAI_API_KEY`. Untouched.
- `apps/admin/src/services/experience.service.ts:573` — publish-path dispatcher of `runExperienceEmbedding`. Untouched.
- `apps/admin/src/graphql/mutations/experience.ts:107` — existing `triggerExperienceEmbedding(localeId)` mutation (per-locale, ADMIN-only via `write:experiences`). Untouched.

**Files to add (admin-native bulk-embed):**

- `apps/admin/src/workflows/experienceEmbeddingBackfill.ts` (+ `.test.ts`) — new workflow that enumerates eligible `ExperienceLocale` rows and dispatches `runExperienceEmbedding` for each. Modeled on `sceneEmbeddingBackfill.ts` / `transcriptEmbeddingBackfill.ts`.
- `apps/admin/src/graphql/mutations/experience-embedding-backfill.ts` (+ `.test.ts`) — ADMIN-only GraphQL mutation that dispatches the new workflow via `start()`. Mirrors `triggerSceneEmbeddingBackfill` and `triggerTranscriptEmbeddingBackfill` shape.
- New permission key `write:experience-embeddings` on `PermissionKey` union + tier matrix in `permissions.ts`. Added to `WORKFLOW_TRIGGER_PERMISSIONS` so bearer-callable from CLIs (symmetric with R1/R2).
- Extend `apps/admin/src/scripts/run-embeds.ts` to accept `--pipeline=experience` (or sibling) so the local-dev CLI works without standing up admin's auth gauntlet. Bypasses GraphQL + useworkflow runtime, dispatches the same per-locale step path. Same shape `run-embeds` already uses for scene/transcript.

**Migration to add:**

- `apps/admin/prisma/migrations/0014_drop_experience_locale_cms_snapshot/migration.sql` — forward-only `ALTER TABLE "experience_locale" DROP COLUMN "cms_document_id", DROP COLUMN "cms_dumped_at", DROP COLUMN "cms_content_hash"; DROP INDEX IF EXISTS "experience_locale_cms_document_id_idx";`. Number 0014 (latest is `0013_rename_legacy_video_source_column`).

**Docs to edit:**

- `apps/admin/CLAUDE.md` — delete the "Experience content dump (R3 of admin migration playbook)" section (lines ~991–1090 currently). Replace with a short "Triggering experience embeddings" section that documents the new backfill mutation + CLI + the per-locale `triggerExperienceEmbedding` that already exists.
- `apps/admin/CLAUDE.md` — remove the "R1-R5 shipped" reference to R3's cms dependency, update the data-flow narrative.
- The R3 origin docs (`docs/plans/2026-04-23-001-feat-admin-r3-experience-migration-plan.md` and `docs/brainstorms/2026-04-23-r3-experience-content-migration-requirements.md`) are historical artifacts. **Leave them as-is** — they accurately describe what shipped at the time. Adding a one-line note pointing forward to this plan is reasonable but optional.
- The solutions doc `docs/solutions/deployment/admin-local-dev-cms-content-dump-blocked-20260515.md` becomes historical (the workflow it documents no longer exists). Add a one-line "Superseded by: docs/plans/2026-05-17-001-refactor-decouple-experience-embeds-from-cms-plan.md" note at the top — don't delete the learning since the dev-env gauntlets it documents apply to any future admin-only GraphQL mutation that dispatches a workflow.

### Institutional Learnings

- `docs/solutions/deployment/admin-local-dev-cms-content-dump-blocked-20260515.md` — the dump was unrunnable locally; deleting it sidesteps that whole class of dev-env gauntlet.
- `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md` — every `start()` call site needs a dispatch-level test. Applies to the NEW backfill mutation + workflow dispatch in Unit 1.
- `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md` — the new backfill should use sequential `for…of` per-target like the dump did (NOT `Promise.all`), and the per-target embedding dispatch is the natural parallelisation seam if needed later.
- `docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md` — if we DO parallelise per-locale embedding dispatch, this is the canonical shape. Recommend deferring parallelism to a follow-up; admin's experience corpus is small enough that sequential is fast enough and keeps the diff minimal.
- `docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md` — the new backfill must data-derive its target set from `prisma.experienceLocale` (no hardcoded locale list). Mirrors R1/R2.
- `docs/solutions/workflow-issues/check-migration-playbook-before-extending-source-side-20260429.md` — applies in spirit: removing the dump completes the playbook step rather than extending the obsolete source-side.
- `docs/solutions/architecture-patterns/parity-bearer-narrow-carveout-pattern-20260513.md` — the new `write:experience-embeddings` key on `WORKFLOW_TRIGGER_PERMISSIONS` is a narrow carveout, same shape as the scene/transcript backfill keys.
- CLAUDE.md "Migrations" section — forward-only rule. This plan introduces the first migration in admin that drops columns; the rule's caveat ("the first migration that drops or renames anything will change this rule and require a deeper rollback playbook") applies. Mitigation: see Risks below.

### External References

None gathered for this plan — pure in-house cleanup.

## Key Technical Decisions

- **Add a bulk-embed mutation rather than relying on per-locale `triggerExperienceEmbedding`.** The existing per-locale trigger requires the caller to know each `localeId` up front. The eval-baseline use case (and any future "regenerate every embedding after a model upgrade") needs a single-call entry point. Mirrors the R1/R2 backfill pattern (`triggerSceneEmbeddingBackfill`, `triggerTranscriptEmbeddingBackfill`) for consistency.
- **Reuse `runExperienceEmbedding` as-is.** The downstream workflow is already admin-native. The new backfill is purely an enumerator + dispatcher; the embedding logic itself is unchanged. Keeps the diff small and reuses a battle-tested path.
- **Add `write:experience-embeddings` to `WORKFLOW_TRIGGER_PERMISSIONS`.** Symmetric with R1/R2; lets bearer-authenticated CLIs invoke the backfill without standing up admin's full session-cookie auth flow. Honest threat-model trade-off: any `WORKFLOW_API_KEYS` bearer can now trigger embed regeneration, which is at most a CPU/$ cost spike, not data loss. Acceptable.
- **Drop the snapshot columns in a forward-only migration.** Per CLAUDE.md "Forward-only" rule, this is the first admin migration to drop anything. Mitigation: the same PR removes every code reference to the columns, so a code-side rollback to the immediately-prior commit is functionally safe (schema and code are co-versioned). Rollback to an earlier commit that references the columns is unsafe — the columns would be gone in the DB but the code would expect them. Operationally: don't roll back across this migration without coordinated re-add.
- **One PR with six commits, not six PRs.** Each unit is buildable on its own (the additive Unit 1 ships clean; Units 2–5 each delete a self-contained slice), but landing them as six separate PRs invites the dump being half-deleted during a window. One PR with logical commit boundaries reads cleanly and lands atomically.
- **Migration number 0014.** Latest applied migration is `0013_rename_legacy_video_source_column`. There are two duplicate `0009_*` and `0010_*` migration directories on disk from a prior branch merge; this is historical and doesn't block 0014. Confirm by reading `prisma/migrations/migration_lock.toml` before authoring the new migration.
- **`cms-video-id-resolver` is delete-only — admin already has a native video-id story.** The resolver bridged cms's Strapi video ids to admin's cuids during the dump. With dump gone, video references in `ExperienceLocale.blocks` are admin-native cuids end-to-end (writes through the admin editor surface, not through cms).

## Open Questions

### Resolved During Planning

- **Q: Do any non-admin apps depend on `triggerExperienceContentDump`?**
  Resolved. `grep -rn` across `apps/web`, `apps/mobile`, `apps/tv`, `apps/cms`, `apps/manager`, `packages/` returns no consumer. The only reference outside admin is the auto-generated `packages/admin-graphql/src/admin-graphql-env.d.ts` introspection, which regenerates automatically.
- **Q: Does `runExperienceEmbedding` have other dispatchers besides the dump?**
  Resolved. Yes — `apps/admin/src/services/experience.service.ts:573` dispatches it on publish/update through `triggerExperienceEmbedding(localeId)` (existing mutation at `apps/admin/src/graphql/mutations/experience.ts:107`). The embedding workflow itself doesn't need changes.
- **Q: Is `write:experience-content-dump` in `WORKFLOW_TRIGGER_PERMISSIONS`?**
  Resolved. No — `WORKFLOW_TRIGGER_PERMISSIONS` contains scene/transcript embedding keys + the manager-enrichment trigger. The local-dev "temporarily widened" mention in `admin-local-dev-cms-content-dump-blocked-20260515.md` was a never-merged experiment.
- **Q: Does the data-layer-flip branch (`feat/web-admin-data-layer-flip`, U9–U22) consume the dump?**
  Resolved. No. The branch shifts web's read path to admin's GraphQL surface for content reads; nothing on that branch invokes `triggerExperienceContentDump`. Removing it is safe relative to the freeze.

### Deferred to Implementation

- ~~**Q: Does prod's `experience_locale` table have any non-null `cms_*` values worth preserving before the drop migration?**~~ **Resolved 2026-05-17.** Verified against admin's prod Postgres (`@forge/admin/db`, `roundhouse.proxy.rlwy.net:52894`): the table is **0 rows total** — every `cms_*` column count is trivially 0. The R3 cms dump never successfully landed in prod (consistent with the 2026-05-15 local-dev-blocked solutions doc). The drop migration in Unit 5 is unconditionally safe — no data to preserve. Side finding: prod admin currently has zero experiences, which means experience-side ranking in hybrid search + scene recommendations is operationally inert in prod until experiences land (presumably via the `feat/web-admin-data-layer-flip` branch's U9-U22 work or post-cutover editor activity).
- **Q: Filter args on `triggerExperienceEmbeddingBackfill` — `localeIds: [ID!]?`, `bcp47Locales: [String!]?`, `force: Boolean = false`?**
  Concrete arg names + defaults belong to the implementer. The shape SHOULD mirror `triggerSceneEmbeddingBackfill` / `triggerTranscriptEmbeddingBackfill` (which take optional restriction filters); the specifics can settle when those mutations are next to it on screen.
- **Q: Should the backfill skip rows where `embedding IS NOT NULL` by default?**
  Recommended yes (skip-by-default with `force: true` to re-embed). Honest trade-off: rebuilds are cheap (~$0.01 per locale at admin's catalogue size) so making `force` default-true is also defensible. Pick at implementation time after a single embed cost is measured.
- **Q: Do we also delete `CMS_DATABASE_URL` from Doppler's `forge-admin` project?**
  Operational follow-up, not in the code diff. Leave for post-merge cleanup.

## Implementation Units

- [x] **Unit 1: Admin-native experience-embedding backfill workflow + mutation + CLI**

**Goal:** Ship an admin-native bulk-embed path that enumerates eligible `ExperienceLocale` rows and dispatches `runExperienceEmbedding` per locale. Mirrors the R1/R2 backfill shape so operators and future readers find the same pattern in the same place.

**Requirements:** R1, plus the Cross-Cutting Constraints in the R1/R2 admin migration playbook (dispatch test, `"use workflow"` directive, sequential per-target loop, data-derived enumeration, per-target error isolation, exhaustive `_internals` export).

**Dependencies:** None — purely additive on top of the existing `runExperienceEmbedding` workflow.

**Files:**

- Create: `apps/admin/src/workflows/experienceEmbeddingBackfill.ts`
- Create: `apps/admin/src/workflows/experienceEmbeddingBackfill.test.ts`
- Create: `apps/admin/src/graphql/mutations/experience-embedding-backfill.ts`
- Create: `apps/admin/src/graphql/mutations/experience-embedding-backfill.test.ts`
- Modify: `apps/admin/src/graphql/schema.ts` (add side-effect import)
- Modify: `apps/admin/src/auth/permissions.ts` (add `write:experience-embeddings` to `PermissionKey` union, tier matrix entry `ADMIN`, append to `WORKFLOW_TRIGGER_PERMISSIONS`)
- Modify: `apps/admin/src/scripts/run-embeds.ts` (accept `--pipeline=experience` and dispatch the new path via direct prisma access, mirroring how `--pipeline=scene|transcript` work)
- Modify: `apps/admin/src/scripts/run-embeds.test.ts` (cover the new flag)
- Modify: `apps/admin/package.json` (no new top-level script needed — `pnpm run-embeds --pipeline=experience` reuses the existing entry)

**Approach:**

- Workflow body enumerates targets via `prisma.experienceLocale.findMany({ where: { /* eligibility predicate */ }, select: { id, locale } })`. Eligibility predicate defaults to `status: "published" AND embedding: null`; with `force: true` it drops the embedding-null clause.
- Sequential `for…of target of targets`; per-target try/catch dispatches `start(runExperienceEmbedding, [{ localeId: target.id }])` and awaits `run.returnValue`. Per-target failure records `{ status: "failed", reason, message, durationMs }` and continues.
- Report shape parity with R1/R2: `{ totalTargets, localeFilter, outcomes, succeeded, skipped, failed }`. No `embedsDispatched` field (it would be redundant with `succeeded`).
- Return value JSON-serializable through Pothos `JSON` scalar (mutation return type).
- ABAC: `authScopes: { hasPermission: "write:experience-embeddings" }`.

**Execution note:** Test-first for the dispatch-level shape so the `start()` call gets exercised before the workflow body lands (per `workflow-dispatch-test-mode-divergence-20260421.md`).

**Patterns to follow:**

- `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` for workflow body shape + `_internals` export
- `apps/admin/src/graphql/mutations/scene-embedding.ts` for resolver + dispatch helper split
- `apps/admin/src/scripts/run-embeds.ts` for the CLI direct-invocation shape (no GraphQL, no useworkflow runtime — direct service call against prisma)

**Test scenarios:**

- Mutation dispatch: resolver calls `start(runExperienceEmbeddingBackfill, [input])` exactly once with the expected args (R1/R2 dispatch-test convention)
- Workflow body: with two eligible locales seeded, dispatch is invoked twice and report aggregates two `succeeded` outcomes
- Workflow body: one locale's embedding throws; outcome records `failed` reason without halting the loop
- Filter args: `localeIds: ["abc"]` restricts the query; `force: true` includes already-embedded rows
- Empty corpus: `totalTargets: 0` returns a clean success-shaped report (no surprise crash)
- Permission check: caller with `EDITOR` tier is rejected; ADMIN is allowed; `WORKFLOW_TRIGGER` bearer is allowed (key is in the allowlist)

**Verification:**

- `pnpm --filter @forge/admin test` runs the new tests green
- `pnpm --filter @forge/admin run-embeds --pipeline=experience` against a seeded local DB populates `experience_locale.embedding` for every eligible row
- GraphQL playground (or curl) against `triggerExperienceEmbeddingBackfill` with ADMIN session returns a parity-shaped JSON report

---

- [x] **Unit 2: Delete the dump GraphQL mutation surface**

**Goal:** Remove `triggerExperienceContentDump` from admin's GraphQL surface. Once gone, the schema artifact + admin-graphql introspection regenerate clean.

**Requirements:** R2, R6.

**Dependencies:** Unit 1 ships first so the admin-native backfill is in place before the dump trigger disappears (operators always have an alternative).

**Files:**

- Delete: `apps/admin/src/graphql/mutations/experience-content-dump.ts`
- Delete: `apps/admin/src/graphql/mutations/experience-content-dump.test.ts`
- Modify: `apps/admin/src/graphql/schema.ts` — remove `import "@/graphql/mutations/experience-content-dump"`
- Modify: `apps/admin/src/auth/permissions.ts` — remove `"write:experience-content-dump"` from the `PermissionKey` union (~line 53) and from the tier matrix (~line 96)
- Modify: `apps/admin/src/auth/permissions.test.ts` — drop any test case that asserts the now-deleted key
- Modify: `apps/admin/schema.graphql` — regenerate via `pnpm --filter @forge/admin schema:print`
- Modify: `packages/admin-graphql/src/admin-graphql-env.d.ts` — regenerate via `pnpm --filter @forge/admin-graphql generate`

**Approach:**

- Run schema regen + admin-graphql regen as part of this commit so the diff stays atomic.
- TypeScript's exhaustive `Record<PermissionKey, Tier>` on the matrix means the union edit + matrix edit must happen together. The compiler will refuse the partial state.

**Patterns to follow:**

- The shape of the cleanup mirrors how `apps/admin` already deletes obsolete mutations during ongoing refactors (no historical precedent specifically for this surface; the pattern is "remove file → remove side-effect import → regenerate schema").

**Test scenarios:**

- `apps/admin/src/graphql/schema.test.ts` already asserts the surface; it should pass after the regen (no negative assertion needed — its existing introspection guard catches accidental re-additions)
- `apps/admin/src/auth/permissions.test.ts` — passes with the deleted matrix entry gone

**Verification:**

- `pnpm --filter @forge/admin typecheck` green
- `pnpm --filter @forge/admin test` green
- `pnpm --filter @forge/admin lint` green
- `apps/admin/schema.graphql` no longer mentions `triggerExperienceContentDump`
- `packages/admin-graphql/src/admin-graphql-env.d.ts` no longer mentions `triggerExperienceContentDump`
- CI's `admin-schema-drift` and `admin-graphql-generate` jobs pass

---

- [x] **Unit 3: Delete the dump workflow + service + cms-coupled modules + CLI**

**Goal:** Remove every piece of cms-reading code from admin.

**Requirements:** R2.

**Dependencies:** Unit 2 (the GraphQL surface must already be gone, otherwise the mutation import explodes when its deps disappear).

**Files:**

- Delete: `apps/admin/src/workflows/experienceContentDump.ts`
- Delete: `apps/admin/src/workflows/experienceContentDump.test.ts`
- Delete: `apps/admin/src/services/experience-content-dump.service.ts`
- Delete: `apps/admin/src/services/experience-content-dump.service.test.ts`
- Delete: `apps/admin/src/services/cms-experience-source.repository.ts`
- Delete: `apps/admin/src/services/cms-experience-source.types.ts`
- Delete: `apps/admin/src/services/cms-experience-source.fake.ts`
- Delete: `apps/admin/src/services/cms-experience-source.fake.test.ts`
- Delete: `apps/admin/src/services/cms-block-transforms.ts`
- Delete: `apps/admin/src/services/cms-block-transforms.test.ts`
- Delete: `apps/admin/src/services/cms-video-id-resolver.ts`
- Delete: `apps/admin/src/services/cms-video-id-resolver.test.ts`
- Delete: `apps/admin/src/db/cms-pg.ts`
- Delete: `apps/admin/src/db/cms-pg.test.ts`
- Delete: `apps/admin/src/scripts/run-experience-dump.ts`
- Modify: `apps/admin/package.json` — remove the `"run-experience-dump": "tsx src/scripts/run-experience-dump.ts"` entry

**Approach:**

- Bulk file deletions; verify no dangling import via `pnpm --filter @forge/admin typecheck` before committing.
- The `pg` driver in `apps/admin/package.json` was added for `cms-pg.ts`. Check whether anything else in admin uses `pg` directly (it shouldn't — Prisma owns the admin DB connection). If `pg` is now unused, drop it from `dependencies` to remove the supply-chain surface. If a transitive dep needs it, leave it.

**Patterns to follow:**

- Atomic-deletion convention: every removed `.ts` file's matching `.test.ts` goes in the same commit.

**Test scenarios:**

- Full admin test suite passes
- Build passes (Next.js standalone + Pothos schema)
- No string `"cms-experience-source"`, `"cms-block-transforms"`, `"cms-pg"`, or `"cms-video-id-resolver"` remains anywhere in `apps/admin/src/`

**Verification:**

- `pnpm --filter @forge/admin typecheck` green
- `pnpm --filter @forge/admin test` green
- `pnpm --filter @forge/admin build` green
- `grep -rn "cms-experience-source\|cms-block-transforms\|cms-video-id-resolver\|cms-pg" apps/admin/src` returns nothing
- `grep -n "run-experience-dump" apps/admin/package.json` returns nothing

---

- [x] **Unit 4: Remove `CMS_DATABASE_URL` from env schema**

**Goal:** Drop the dead env var so admin no longer claims it as a configurable surface.

**Requirements:** R2.

**Dependencies:** Unit 3 (the only consumer, `cms-pg.ts`, is gone).

**Files:**

- Modify: `apps/admin/src/config/env.ts` — remove the `CMS_DATABASE_URL: z.string().url().optional()` Zod entry and its `emptyToUndefined(process.env.CMS_DATABASE_URL)` value
- Modify: `apps/admin/src/config/env.test.ts` — drop any case that asserts `CMS_DATABASE_URL` presence
- Modify: `apps/admin/.env.example` if it lists `CMS_DATABASE_URL`

**Approach:**

- Single deletion in `env.ts`; the var is `.optional()` so no env-load-time guard cares.
- After this lands, removing the var from Doppler's `forge-admin` project is a follow-up. Admin tolerates the env-var presence either way once the consumer is gone (env validator ignores unknown keys).

**Patterns to follow:**

- Existing `CMS_DATABASE_URL` Zod entry is the only example to subtract from.

**Test scenarios:**

- `env.test.ts` passes with the entry removed
- Admin boots locally without `CMS_DATABASE_URL` in `.env` (it already does today; this just confirms removing it from the schema doesn't break boot)

**Verification:**

- `pnpm --filter @forge/admin typecheck` green
- `pnpm --filter @forge/admin test` green
- `grep -rn "CMS_DATABASE_URL" apps/admin/src` returns nothing

---

- [x] **Unit 5: Drop snapshot columns on `experience_locale`**

**Goal:** Remove `cms_document_id`, `cms_dumped_at`, `cms_content_hash` from `experience_locale` and the partial index on `cms_document_id`. Schema reflects reality.

**Requirements:** R3.

**Dependencies:** Unit 3 (no code reads or writes the columns) and a pre-flight check (Open Questions, deferred) that prod doesn't have meaningful data in the columns.

**Files:**

- Create: `apps/admin/prisma/migrations/0014_drop_experience_locale_cms_snapshot/migration.sql`
- Modify: `apps/admin/prisma/schema.prisma` — drop the three `cms*` fields and the surrounding JSDoc block on `ExperienceLocale` (~lines 1205–1224); leave the rest of the model untouched
- Modify: any model-shape test that snapshots the `ExperienceLocale` columns (search for `cmsDocumentId` / `cmsDumpedAt` / `cmsContentHash` in test fixtures)

**Approach:**

- Migration body:
  ```sql
  -- Forward-only. Snapshot columns introduced by the R3 cms dump in
  -- 0005_r3_experience_cms_dump_snapshot; the dump is being removed
  -- because experiences live in admin natively. See
  -- docs/plans/2026-05-17-001-refactor-decouple-experience-embeds-from-cms-plan.md.
  DROP INDEX IF EXISTS "experience_locale_cms_document_id_idx";
  ALTER TABLE "experience_locale"
    DROP COLUMN IF EXISTS "cms_document_id",
    DROP COLUMN IF EXISTS "cms_dumped_at",
    DROP COLUMN IF EXISTS "cms_content_hash";
  ```
  Implementer should verify the exact partial-index name by reading `prisma/migrations/0005_r3_experience_cms_dump_snapshot/migration.sql` before authoring 0014; the literal name above is a best-guess from CLAUDE.md.
- Use `DROP COLUMN IF EXISTS` to make the migration idempotent against environments that already lack the columns.
- The migration is non-transactional in the sense that AccessExclusiveLock on `experience_locale` is brief (the table is small); no `CONCURRENTLY` needed.

**Execution note:** Verify prod state via the SELECT probe in Open Questions before applying. If the probe returns non-zero, pause and decide whether to archive the data first.

**Patterns to follow:**

- `apps/admin/prisma/migrations/0012_drop_media_asset_canonical_text` — the most recent precedent for a DROP COLUMN migration in admin.

**Test scenarios:**

- `prisma migrate dev` against a fresh local DB applies 0001 → 0014 cleanly
- After migration, `\d experience_locale` no longer lists the three columns
- `prisma migrate status` shows 0014 as Applied
- Existing tests that exercise `ExperienceLocale` shape pass (no longer expect snapshot fields)

**Verification:**

- `pnpm --filter @forge/admin db:migrate:dev` against a fresh DB succeeds end-to-end
- `pnpm --filter @forge/admin test` green
- `pnpm --filter @forge/admin db:generate` produces a Prisma client that has no `cmsDocumentId` / `cmsDumpedAt` / `cmsContentHash` fields

---

- [x] **Unit 6: Update CLAUDE.md + roadmap**

**Goal:** Documentation and roadmap reflect that experience embeddings are admin-native; R3 dump is retired.

**Requirements:** R4.

**Dependencies:** Units 1–5 merged (so the new surface exists and the old one is gone).

**Files:**

- Modify: `apps/admin/CLAUDE.md` — delete the "Experience content dump (R3 of admin migration playbook)" section. Replace with a short "Triggering experience embeddings" section that documents: (a) per-locale `triggerExperienceEmbedding(localeId)` from `experience.ts:107`, (b) the new bulk `triggerExperienceEmbeddingBackfill`, (c) the `pnpm run-embeds --pipeline=experience` CLI shim
- Modify: `apps/admin/CLAUDE.md` — update the "Migrations" section's "with today's contents (0001-0009 are all additive — new tables, new columns, new indexes)" sentence to acknowledge 0014 as the first drop, with a one-paragraph forward-only-with-drop rollback note
- Modify: `apps/admin/CLAUDE.md` — remove the R3-specific bullet from the "Build status" / "Unit 4 — data model highlights" sections if any still reference dump-driven semantics
- Modify: `docs/solutions/deployment/admin-local-dev-cms-content-dump-blocked-20260515.md` — add a one-line "Superseded by: docs/plans/2026-05-17-001-refactor-decouple-experience-embeds-from-cms-plan.md" note at the top
- Audit + update relevant roadmap entries (`docs/roadmap/content-discovery/feat-095-experience-embedding-pipeline.md`, `docs/roadmap/content-discovery/feat-096-experience-embeddings-backfill.md`, `docs/roadmap/platform/feat-092-admin-experience-embedding-workflow.md`). Most of these are already `status: complete`; update bodies only if they explicitly describe cms-side dispatch as the canonical mechanism.

**Approach:**

- Keep the new "Triggering experience embeddings" section short — three short subsections (per-locale trigger, bulk backfill, local CLI), each pointing at the canonical code path.
- DO NOT edit the R3 origin docs (`docs/plans/2026-04-23-001-feat-admin-r3-experience-migration-plan.md`, `docs/brainstorms/2026-04-23-r3-experience-content-migration-requirements.md`). They're timestamped artifacts.

**Patterns to follow:**

- The CLAUDE.md "Triggering embeds from manager" section (~line 1141) for the runbook shape of the new "Triggering experience embeddings" section.
- The "Running embeds locally (R1 + R2)" section for the `pnpm run-embeds` CLI shape.

**Test scenarios:**

- A reader following the new "Triggering experience embeddings" section can populate `experience_locale.embedding` end-to-end without confusion.
- `grep -n "CMS_DATABASE_URL\|cms_document_id\|cms-content-dump\|run-experience-dump" apps/admin/CLAUDE.md` returns nothing.

**Verification:**

- `pnpm --filter @forge/admin lint` green (catches any broken markdown link)
- Reading the updated CLAUDE.md section end-to-end matches what shipped in Units 1–5

## System-Wide Impact

- **Interaction graph:** Only the experience-content-dump path is removed. The publish path (`experience.service.ts:573` → `runExperienceEmbedding`) and the per-locale trigger (`triggerExperienceEmbedding`) keep working unchanged. The new bulk trigger is additive.
- **Error propagation:** `CmsDatabaseUrlMissingError` was the only typed error in `cms-pg.ts`; it disappears with the file. Per-target errors in the new backfill workflow flow through the same typed-outcome shape as the other R1/R2 backfills (sequential `for…of`, per-target try/catch, no swallowed throws).
- **State lifecycle risks:** Dropping the snapshot columns is the only state change. Forward-only; data loss is bounded to whatever was in `cms_*` columns at migration time (expected to be zero in prod — verify via Open Questions). `ContentRevision` rows are untouched.
- **API surface parity:** `triggerExperienceEmbeddingBackfill` lands as a sibling to `triggerSceneEmbeddingBackfill` and `triggerTranscriptEmbeddingBackfill`. Same args style, same JSON return shape, same permission idiom. `triggerExperienceContentDump` leaves the surface; `packages/admin-graphql/src/admin-graphql-env.d.ts` regenerates without it.
- **Integration coverage:** A real-DB smoke after Unit 5 (`pnpm db:migrate:deploy` against a copy of staging) is the single load-bearing integration check. Unit-test coverage alone won't prove the migration applies cleanly against a populated table.

## Risks & Dependencies

- **Risk: Prod has unrecoverable data in `cms_*` columns at migration time.** Mitigation: pre-flight SELECT probe (see Open Questions) before applying 0014 in prod. If non-zero, escalate before proceeding.
- **Risk: First-ever drop migration in admin trips the forward-only rule.** Mitigation: documented in the migration body's comment + in the CLAUDE.md "Migrations" section update (Unit 6). Code and schema are co-versioned in the same PR so a code-side rollback to the parent commit is functionally safe.
- **Risk: A hidden consumer somewhere references `triggerExperienceContentDump` that the grep missed.** Mitigation: post-merge, `gh search code "triggerExperienceContentDump"` and `gh search code "CMS_DATABASE_URL"` across the org to confirm. The introspection drop in `packages/admin-graphql/src/admin-graphql-env.d.ts` would show up in CI's `admin-graphql-generate` job for any consuming repo.
- **Risk: `pg` was a direct dependency added for `cms-pg.ts`.** Unit 3 should grep for any other `pg` import in admin; if none, remove from `apps/admin/package.json` `dependencies`. If `pg` is still pulled transitively, leave it.
- **Dependency: Unit 1 should land before Units 2–5** so operators always have an admin-native bulk-embed path. Ordering inside one PR's commit sequence achieves this.

## Documentation / Operational Notes

- **Doppler:** After the PR merges, remove `CMS_DATABASE_URL` from the `forge-admin` Doppler project. Optional but tidy. No rollout coordination required — admin already tolerates the var being absent.
- **Railway:** No service config changes. Migration applies automatically on next deploy via the chained `startCommand` (per CLAUDE.md "Migrations" section).
- **Monitoring:** Watch the deploy log for `0014_drop_experience_locale_cms_snapshot` in the `prisma migrate deploy` output. Per CLAUDE.md "Operational runbook — predeploy migration verification", `railway run pnpm --filter @forge/admin exec prisma migrate status` should confirm.
- **Eval harness re-baseline:** After Units 1 + 5 land and `pnpm run-embeds --pipeline=experience` has populated `experience_locale.embedding` in the target environment, the semantic-search eval harness (PR #922) can be re-baselined with experience-side ranking covered. This is the downstream work that triggered this plan.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-23-r3-experience-content-migration-requirements.md](../brainstorms/2026-04-23-r3-experience-content-migration-requirements.md) — the brainstorm that scoped the dump to the R3 → R8 window
- Original R3 plan (historical, do not edit): [docs/plans/2026-04-23-001-feat-admin-r3-experience-migration-plan.md](2026-04-23-001-feat-admin-r3-experience-migration-plan.md)
- Solutions doc to mark superseded: [docs/solutions/deployment/admin-local-dev-cms-content-dump-blocked-20260515.md](../solutions/deployment/admin-local-dev-cms-content-dump-blocked-20260515.md)
- Related (parallel admin migration work): [docs/plans/2026-05-14-001-feat-adapt-web-data-layer-to-admin-plan.md](2026-05-14-001-feat-adapt-web-data-layer-to-admin-plan.md) — web data-layer flip
- Sibling R1/R2 backfill pattern: `apps/admin/src/workflows/sceneEmbeddingBackfill.ts`, `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts`
- Sibling backfill mutations: `apps/admin/src/graphql/mutations/scene-embedding.ts`, `apps/admin/src/graphql/mutations/transcript-embedding.ts`
- Existing per-locale trigger to keep: `apps/admin/src/graphql/mutations/experience.ts:107`
- Existing publish-flow dispatcher to keep: `apps/admin/src/services/experience.service.ts:573`
- Migration pattern precedent: `apps/admin/prisma/migrations/0012_drop_media_asset_canonical_text`
