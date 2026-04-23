---
title: Admin Experience Content Dump — durable cms → admin migration via direct Postgres + canonical-JSON content hash
date: 2026-04-23
category: platform
problem_type: integration
component: workflow_orchestration
root_cause: cross_database_data_sync
resolution_type: architecture_pattern
severity: medium
module: apps/admin
tags:
  - admin-migration
  - r3
  - strapi-v5
  - cross-database-read
  - content-hash
  - useworkflow
  - merge-upsert
  - dynamic-zone
related_features:
  - feat-009
  - feat-010
related:
  - "docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md"
  - "docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md"
  - "docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md"
  - "docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md"
  - "docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md"
  - "docs/solutions/security-issues/zod-validation-errors-must-not-echo-user-controlled-input-20260420.md"
  - "docs/solutions/best-practices/experience-embedding-pipeline-pgvector-strapi-v5-20260414.md"
date_learned: 2026-04-23
---

## Problem

R3 of the admin migration playbook needed admin to host the
Experience corpus that R4 (hybrid search) and R5 (recommendations)
operate over, while cms continued serving existing consumers until
R8 cutover. Two complications made the obvious approaches
unworkable:

1. **Strapi REST hides fields.** A `populate=*` against cms's
   experience endpoint omits fields based on the API token's
   permissions, and dynamic-zone populate has known limits (open
   issue strapi/strapi#22166) that silently drop component order on
   published rows in some 5.4.x builds. Reading via REST means
   wondering whether "this looked empty" was data or permissions.
2. **Editor authorship doesn't move on day one.** Editors keep
   working in cms during the R3→R8 window. The dump must be
   rerunnable (cron-friendly) without (a) wiping admin-side editor
   work that lands on the new surface or (b) becoming a dual-write
   system the admin migration playbook explicitly forbids at R9.

R3 also can't shoehorn into R1/R2's "S3 artifact → admin" pattern.
Manager produces those artifacts as a side effect of enrichment;
nothing produces an "experience snapshot" artifact, and standing up
that producer is more work than reading cms directly.

## Solution

The shipped pattern (PR landed 2026-04-23 in `feat/admin-r3-experience-migration`):

### Direct Postgres read with a typed repository layer

Admin connects to cms's Postgres via a new `CMS_DATABASE_URL` env on
the `forge-admin` Doppler project (read-only role on the platform
team's side). The connection is a lazy singleton `pg.Pool` in
`apps/admin/src/db/cms-pg.ts` — admin still boots when the env is
unset, and the workflow surfaces a typed `CmsDatabaseUrlMissingError`
the first time the mutation fires without it.

A typed repository layer
(`apps/admin/src/services/cms-experience-source.repository.ts`)
exposes Strapi-shaped reads as four methods:

```text
enumerateDocumentLocales(filter?)      → CmsDocumentLocaleSummary[]
loadExperienceRow(documentId, locale, prefer)  → CmsExperienceRow | null
loadComponents(ownerTable, ownerId, field)     → CmsComponentRow[]
loadMediaUrl(relatedType, relatedId, field)    → string | null
```

Snake_case row shapes mirror cms PG columns exactly so SQL and test
fixtures stay 1:1 readable. Table names come from a hardcoded
allowlist (`COMPONENT_TABLES`) so a typo or attacker-influenced
component_type cannot reference an arbitrary table. An in-memory
fake (`cms-experience-source.fake.ts`) is the test surface for
service-level tests; the real implementation's SQL is verified at
deploy time against the live cms PG.

### Per-component transformer registry with closure-based video resolution

`apps/admin/src/services/cms-block-transforms.ts` carries one
transformer per Strapi component UID. Each transformer:

- Constructs the admin shape FROM SCRATCH (no spread of cms attrs)
  so Strapi internals can't leak in.
- Normalises null/empty cms strings to `undefined` for Zod
  optionality.
- Routes video relations through a `VideoIdLookup` closure that
  shares one batch resolution across every block in a locale (no
  per-block round-trips to admin's PG).
- Throws a typed `BlockTransformError` (code + componentType +
  cmpId) on required-field violations. Error messages NEVER echo
  cms row data — only field name and ids — to honor the
  zod-echo learning.

Section + container blocks recurse into the narrower
SectionContent / ContainerContent scopes; admin's discriminated
unions enforce scope correctness at parse time.

### Per-locale `$transaction` + content-hash-gated rerun

`apps/admin/src/services/experience-content-dump.service.ts`
(`dumpExperienceLocale`) bundles transform + validation + upsert
into one operation per locale:

```text
ABAC gate (canWriteDerived)
  → load source row (prefer published)
  → load components
  → resolve cms video ids (one batched Map)
  → transform → BlocksSchema.parse (single-pass)
  → resolve experience-level ogImage URL
  → SHA-256 hex over canonical-JSON merge payload
  → if previous hash matches: skipped_unchanged (timestamp-only update)
  → else: $transaction { find/create canonical Experience,
                         slug-collision check,
                         upsert ExperienceLocale (content + cms_dumped_at) }
```

The hash is **NOT** persisted by this service. The workflow writes
it AFTER `runExperienceEmbedding` dispatches successfully — so a
failed dispatch leaves the previous hash in place and the next
rerun's "differs?" check retries automatically. This is the
load-bearing rerun-recovery invariant.

### Workflow as the orchestration boundary

`apps/admin/src/workflows/experienceContentDump.ts` mirrors
R1/R2's structural pattern verbatim:
`"use workflow"` at top, inner `stepX` closures with `"use step"`,
sequential `for…of` per-target (NOT `Promise.all`), per-target
`try/catch` with typed-error branching, exhaustive `stepReport`
with `_exhaustive: never` guard, `export const _internals` at
file bottom for test visibility.

The mutation `triggerExperienceContentDump` is ADMIN-only via
Pothos scope-auth (`hasPermission: "write:experience-content-dump"`)
plus `canWriteDerived` at the service boundary. Its return shape
matches R1/R2: `{ totalTargets, documentIdFilter, localeFilter,
outcomes, succeeded, skipped, failed, embedsDispatched }`.

## Why This Works

**Direct PG read solves the field-hiding + ordering issues.** The
repository sees the canonical state. We pay one new env var and a
read-only role; we get a deterministic fidelity contract. The
five-table-allowlist + `$N` placeholders combo keeps the SQL
identifier surface narrow.

**Content-hash gating makes reruns idempotent without dual-write
risk.** The hash captures every byte cms's dump writes into admin.
Unchanged content → no admin write at all (just a `cms_dumped_at`
timestamp bump). Changed content → one upsert. The hash also gates
embedding regeneration, so cron-rate reruns don't bill OpenRouter
for identical content.

**Persisting the hash AFTER embed-dispatch closes the recovery
loop.** If `runExperienceEmbedding`'s dispatch throws (workflow
runtime down, embedding provider 5xx during the inner workflow's
boot), the previous hash stays in place. Next rerun sees "hash
differs," retries the dispatch, and only persists the new hash on
success. No operator intervention required for the transient case.

**Three properties make the pattern transferable to R6+ migrations:**

1. **Repository abstraction lets service tests stay deterministic.**
   The fake-vs-real split is generally applicable to any
   cross-database read.
2. **Content-hash gating is a general "skip work if unchanged"
   primitive.** Use it any time admin re-derives state from an
   external source on a cron cadence.
3. **The "persist hash after side-effect" pattern keeps recovery
   loops honest.** Whenever you need "fire side effect X for
   each changed row, retry on failure," the same shape works:
   compute the new state's identifying value, do the side effect,
   persist the value only on success.

## Prevention / Things to Watch For

### For the author (next sibling port — R4/R5/R6)

- **Don't copy assertions from R3 without re-deriving them.** The
  dead-invariant-checks learning applies: an `if (i === seen)`
  guard that protects against duplicate scene indexes (where `i`
  IS `scene.sceneIndex`, a data field) becomes structurally dead
  if you port it to a context where `i` is a loop counter. Re-walk
  every assertion against the new module's data model.
- **Don't hardcode locale lists.** R3's enumeration is data-derived
  (`SELECT DISTINCT locale FROM experiences`). Future Rn ports that
  enumerate an axis must do the same — no `["en", "es", "fr"]`
  defaults, no `?? "en"` fallback. Cf. the prototype-defaults
  learning.
- **Add a dispatch-level test for every `"use workflow"` call site.**
  R3 has two: mutation→workflow and workflow→`runExperienceEmbedding`.
  Vitest's inert directive mode cannot catch a missing `start()`
  wrapper. Cf. the workflow-dispatch-test-mode-divergence learning.
- **Never echo Zod / Prisma error messages out the API surface.**
  `BlockTransformError` carries componentType + cmpId only;
  `ExperienceContentDumpError` masks raw Prisma errors as `db_write`.
  Server-side logs get the full detail; the GraphQL response gets
  a generic message keyed by the typed code.

### For the reviewer

- **Hash determinism is load-bearing.** Any change to
  `canonicalize()` or to the merge payload shape (adding a field,
  reordering arrays, etc.) silently re-flags every locale as
  "changed" on next rerun. If a future PR touches those, it must
  also document the impact (one-time re-embed cost).
- **Sequential `for…of` is intentional.** A future "make it faster
  with `Promise.all`" PR would (a) un-honor the per-target error
  isolation contract and (b) put concurrent pressure on the cms
  read-only role. The R3 cost is bounded (~100 experiences × ~3
  locales × <1s per target).
- **The pg.Pool singleton is HMR-safe but tests must reset it.**
  `_resetCmsPgPoolForTests()` exists for this reason; production
  code must not call it.

### For the next R-stage that wants to dump from cms

- **Extend the table allowlist BEFORE writing the SQL.** Adding a
  new component type to admin's BlockSchema means:
  1. Add the Zod variant in `apps/admin/src/domain/blocks.ts`.
  2. Add the table name to `COMPONENT_TABLES` in
     `cms-experience-source.repository.ts`.
  3. Add the typed row shape to
     `cms-experience-source.types.ts::CmsComponentRow`.
  4. Add the per-component loader to the dispatch in
     `loadOneComponent()`.
  5. Add the transformer in `cms-block-transforms.ts`.
  6. Add a happy-path + required-field test.
     Forgetting (2) makes the dump return `null` for that
     componentType silently (the loader's "unknown returns null"
     branch swallows it). Forgetting (5) crashes at the exhaustive-
     switch in the transformer (compile-time error) — preferable.

## Verification

- After deploying R3, before invoking the mutation:
  - `\d experience_locale` on admin DB shows the three new
    columns and the partial index.
  - `pnpm --filter @forge/admin typecheck` and
    `pnpm --filter @forge/admin test` pass without
    `CMS_DATABASE_URL` set.
- After provisioning the read-only PG role + setting
  `CMS_DATABASE_URL`:
  - First mutation invocation produces `succeeded > 0` outcomes
    with `action="created"` for every cms experience document.
  - Second invocation (no cms changes) produces `skipped > 0` with
    every outcome `action="skipped_unchanged"`. Zero `db.exp_loc`
    `updated_at` advancement except for `cms_dumped_at`.
  - `SELECT COUNT(*) FROM experience_locale WHERE
status='PUBLISHED' AND embedding IS NOT NULL` grows
    monotonically as `runExperienceEmbedding` workflows complete.
- After a single cms-side block edit + rerun:
  - Exactly one outcome reports `action="updated"` with that
    document_id + locale.
  - Exactly one `runExperienceEmbedding` dispatch fires
    (observable via admin's workflow dashboard).

## Appendix: the canonical-JSON helper

```ts
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(canonicalize)
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue
    out[key] = canonicalize(obj[key])
  }
  return out
}
```

Three properties matter:

- **Object keys are sorted recursively** so `{a:1,b:2}` and
  `{b:2,a:1}` hash identically.
- **Arrays preserve order** because position is content (changing
  the order of blocks IS a content change).
- **`undefined` values omit the key** so transformer outputs that
  set an optional field to `undefined` hash the same as outputs that
  omit it entirely. Zod `.optional()` parses both, so the dumper
  treats them as equivalent.

The naive `JSON.stringify` does NOT sort keys. The `json-stable-stringify`
npm package does the same thing as `canonicalize` but adds a
runtime dependency. Twelve lines of in-house code is the better
trade.

## Related

- `apps/admin/src/services/experience-content-dump.service.ts` —
  the per-locale indexer.
- `apps/admin/src/workflows/experienceContentDump.ts` — the
  workflow.
- `apps/admin/src/graphql/mutations/experience-content-dump.ts` —
  the GraphQL surface.
- `apps/admin/src/services/cms-experience-source.repository.ts` —
  the cms read surface.
- `apps/admin/src/services/cms-block-transforms.ts` — the per-
  component transformers.
- `apps/admin/src/services/cms-video-id-resolver.ts` — the
  cms id → admin cuid resolver.
- `apps/admin/CLAUDE.md` "Experience content dump (R3 of admin
  migration playbook)" section.
- `docs/brainstorms/2026-04-23-r3-experience-content-migration-requirements.md`
  — origin requirements.
- `docs/plans/2026-04-23-001-feat-admin-r3-experience-migration-plan.md`
  — implementation plan.
