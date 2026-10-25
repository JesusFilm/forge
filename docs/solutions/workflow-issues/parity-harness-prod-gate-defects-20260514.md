---
module: packages/graphql
date: "2026-05-14"
problem_type: workflow_issues
component: parity-verification-harness
severity: high
applies_when:
  - "Running packages/graphql/scripts/run-batch-verification.ts against prod URLs"
  - "Treating the harness's 'Gate: PASSED' output as proof the cutover is safe"
  - "Onboarding the next engineer to the consumer-migration verification flow"
  - "Auditing whether plan-003 U8's cutover gate actually gates anything in prod"
symptoms:
  - "SyntaxError: does not provide an export named 'BlocksSchema' when running the harness from packages/graphql"
  - "Harness exits 0 with 'Gate: PASSED' and totals.slugs === 0 against prod URLs"
  - "Strapi prod returns ForbiddenError on the harness's experiences enumeration"
  - "Operator reads 'PASSED' and flips FORGE_CONTENT_API on a never-actually-verified corpus"
  - "Prod admin returns null for every experienceBySlug + empty for experienceTemplates — admin has Languages/Videos but no Experience content yet"
  - "Browser smoke against prod web in admin mode returns 404 for /easter, /christmas, /advent because admin prod has no published Experiences to serve"
related_components:
  - admin-core-migration
  - cutover-runbook
tags:
  - parity-harness
  - consumer-migration
  - esm-cjs-interop
  - false-positive-pass
  - prod-gate
  - tier-2-gap
---

# Parity verification harness has two defects blocking the prod cutover gate

## Context

> **Refresh note (2026-06-24).** The `packages/graphql` parity harness this post-mortem covers has since been **removed** (Strapi→admin migration cleanup; see root `CLAUDE.md`). Defects 2 and 3 were harness/operational-specific and are now moot. Defect 1's root cause (ESM importer can't see a CommonJS package's named exports) is the durable lesson — generalized in [tsx-esm-named-export-resolution…](../runtime-errors/tsx-esm-named-export-resolution-across-workspace-package-boundary-20260508.md) and [mastra-dev-tsx-loader…](../tooling-decisions/mastra-dev-tsx-loader-for-raw-ts-workspace-deps.md).

`packages/graphql/scripts/run-batch-verification.ts` shipped in PR #937 (plan-003 U8) as the cutover gate: it walks the published-slug corpus, fetches each slug from Strapi AND admin in parallel, diffs the normalized payloads across structural/value/order/semantic classes, and exits 0 only when every diff is empty or allow-listed. The cutover runbook (`docs/admin-core-migration/cutover-runbook.md`) names "batch verification harness gate is green" as a pre-cutover checklist box.

Attempting to run the harness against prod (`cms.jesusfilm.org` + `admin.jesusfilm.org`) on 2026-05-14 surfaced two independent defects. Neither was caught at merge because the harness has no end-to-end test against real cross-package imports or a real Strapi prod endpoint — unit tests stub both surfaces.

## Defect 1 — ESM/CJS interop blocks the import chain

`packages/graphql/package.json` declares `"type": "module"`, so the harness loads as ESM. The chain reaches `apps/admin/src/domain/blocks.ts` via the package export `@forge/admin/domain/blocks`. `apps/admin/package.json` has NO `"type": "module"`, so Node 24 treats the cross-package `.ts` file as CommonJS regardless of import style (package-name or relative path). The ESM importer in `normalize-admin.ts:26` then can't see named exports:

```
SyntaxError: The requested module '@forge/admin/domain/blocks'
does not provide an export named 'BlocksSchema'
```

Tried and failed: `node --import tsx`, `NODE_OPTIONS=--experimental-strip-types`, `--experimental-vm-modules`, `node --no-experimental-strip-types --import tsx`, relative-path import. Module-type is determined by the file's nearest `package.json`, not by the import site.

### Workaround

Drop a one-line `package.json` at `apps/admin/src/domain/`:

```json
{ "type": "module" }
```

This scopes ESM to that one directory without flipping the whole admin app. `apps/admin` typecheck still passes. Verified on 2026-05-14.

### Long-term fix

Promote `apps/admin/package.json` to `"type": "module"`. apps/admin is a Next.js app with several CJS-shaped config files (`next.config`, `postcss`, `tailwind`, etc.); converting risks cascading breakage and deserves its own PR with full Tier-2 review.

## Defect 2 — False-positive "PASSED" on empty corpus

The harness enumerates the corpus at `batch-verification.ts:653-657` with `bearer: null` — it assumes Strapi's `experiences` query is publicly readable. Prod Strapi returns `ForbiddenError: Forbidden access`. The error is swallowed silently, the corpus comes back empty, and the script reports:

```
Batch verification — 0 slugs verified
Gate: PASSED
```

This is the dangerous defect. An operator running the harness expecting "PASSED = safe to flip the env var" gets a green light on a corpus that was never actually compared. There is no fail-loud condition for empty enumeration.

Two contributing issues:

1. **No Strapi auth support.** The harness uses a single bearer (admin's `PARITY_API_KEYS` or `WEB_ADMIN_API_KEYS`) and treats Strapi as anonymous. It does not read `STRAPI_API_TOKEN` or any equivalent. Local Strapi may allow anonymous reads; prod Strapi (the only meaningful gate target) does not.
2. **No empty-corpus guard.** The runner treats `corpus.length === 0` as a degenerate pass rather than a misconfiguration error.

### Fix sketch

`scripts/run-batch-verification.ts` should read `STRAPI_API_TOKEN` from env and thread it through `enumerateCorpus` + `fetchStrapi` (parallel to the admin bearer). `batch-verification.ts` should add an explicit check: if `corpus.length === 0` after enumeration, exit code 2 (misconfiguration) with a clear error message — never report PASSED.

Both halves need tests using a stubbed enumerator that returns `[]` and a stubbed Strapi fetcher that throws a 403 — the existing tests don't cover either path.

## Impact

The cutover-runbook's pre-cutover checkbox "Batch verification harness gate is green" is currently unenforceable against prod. Plan-003's R4 / R5 / R6 (batch verification → empty diff set OR allow-listed) cannot be satisfied as the harness ships. The runbook still names this gate as required reading before flipping `FORGE_CONTENT_API=admin`.

**Tier-2 review gap.** Per `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md`, #937 touched a sensitive surface (cutover gate logic, data-routing for user-facing render) and should have surfaced these defects through reliability + correctness personas. The empty-corpus false-positive is exactly the kind of "design-shape bug under adversarial conditions" Tier-2 catches.

## Defect 3 — Prod admin has no Experience content to render

Independent of the two harness defects, prod admin (`admin.jesusfilm.org/api/graphql`) currently has:

- Languages: populated
- Videos: populated
- Keywords: empty
- `experienceTemplates(locale)`: returns `[]` for every locale tested (`en`, `en-US`, `en-GB`, `es`, `es-ES`, `pt`, `pt-BR`, `fr`, `de`, `ja`, `ko`, `zh`, `ar`, `ru`, `hi`)
- `experienceBySlug(slug, locale)`: returns `null` for every common slug × locale combination tested

The slug route the cutover targets (`apps/web/src/app/[slug]/page.tsx`) renders Experience content. If `FORGE_CONTENT_API=admin` were flipped on prod today, every Experience page would 404 — even with the harness defects fixed, there is no content for the harness to verify or for users to receive.

This is the load-bearing gap. The harness defects matter, but they're downstream of a content-sync prerequisite that has not happened in prod admin. **PR #937 shipped cutover INFRASTRUCTURE in advance of cutover-ready content.** This is consistent with plan-003's "ship infra, then operationalize" approach but is not documented as a remaining operational prerequisite in the cutover-runbook.

## Recommended action

Three blockers stack here, in order of fix sequence:

1. **Content prerequisite.** Run whatever sync/migration path lands Experience content from Strapi into admin prod. (Owner: the operator running cutover. Out of scope for the harness PR.)
2. **Harness Strapi auth + empty-corpus guard.** Once content exists in admin, the harness still can't gate without thread STRAPI_API_TOKEN + fail-loud on empty corpus.
3. **ESM/CJS workaround → proper fix.** The nested `apps/admin/src/domain/package.json` is a workaround; promote `"type": "module"` to admin's top-level package.json as a follow-up.

Until step 1 lands, the slug-page cutover cannot be smoke-tested against prod even with browser-based verification. The most useful work in the meantime is the U5-deletion cleanup PR (deferred follow-up in plan-003) or Unit 7 hardening (R17 no-redeploy rollback, parity-diff CI gate, GraphQL Armor recalibration) — both of which make progress without requiring Experience content in admin.

Cutover-runbook should be updated to list "Experience content synced into admin prod" as the first pre-cutover checkbox, ahead of the harness gate.

## Related

- Plan: [docs/plans/2026-05-11-003-feat-web-admin-direct-cutover-plan.md](../../plans/2026-05-11-003-feat-web-admin-direct-cutover-plan.md) (U8 — the unit that shipped this harness)
- Runbook: [docs/admin-core-migration/cutover-runbook.md](../../admin-core-migration/cutover-runbook.md) (pre-cutover checklist references the gate)
- PR: #937 (the cutover bundle that shipped the harness)
- Adjacent learning: [docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) — same META: mocked-shape tests do not catch real-contract bugs at the integration seam.
- Root-cause sibling: [docs/solutions/runtime-errors/tsx-esm-named-export-resolution-across-workspace-package-boundary-20260508.md](../runtime-errors/tsx-esm-named-export-resolution-across-workspace-package-boundary-20260508.md) — same `@forge/admin/domain/blocks` named-export failure; Defect 1 here is the precise root cause that doc's "Why This Works" was corrected to cite.
- Generalized form: [docs/solutions/tooling-decisions/mastra-dev-tsx-loader-for-raw-ts-workspace-deps.md](../tooling-decisions/mastra-dev-tsx-loader-for-raw-ts-workspace-deps.md) — distinguishes this CJS named-export seam (tsx can't fix) from the missing-extension case (tsx fixes).
