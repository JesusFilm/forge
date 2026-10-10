---
title: "Remove legacy Admin search eval harness"
type: "chore"
status: "complete"
date: "2026-06-01"
origin: "docs/roadmap/content-discovery/feat-155-remove-legacy-admin-search-eval-harness.md"
---

# Remove legacy Admin search eval harness

## Summary

Remove Admin's old local semantic-search eval CLI and runbook while preserving
the Admin-owned internal HTTP contracts that Mastra still uses for offline
search eval. The end state is one operator-facing search eval path: Mastra
orchestrator/native Evaluation, backed by Admin live search and candidate
contracts.

---

## Problem Frame

Admin currently exposes two different search eval stories: a local
`pnpm eval:search` harness under `apps/admin`, and the newer Mastra-owned
workflow stack for query generation, offline reports, native Evaluation sync,
and release gates. The duplicate ownership is confusing and keeps stale
OpenRouter/env/runbook surface alive.

This cleanup is not a removal of Admin's search-eval HTTP API. Admin still owns
live search, trace labeling, trace retention, staged candidate storage, catalog
context, and bearer-gated internal contracts. Mastra owns the eval workflow and
operator surface.

---

## Requirements

**Legacy harness removal**

- R1. Remove the Admin local CLI entry point and every `eval:search*` package
  script.
- R2. Delete harness-only Admin eval modules and fixtures, including baseline,
  calibration, judge, fingerprint, query generation, runner, reporter, CLI
  search-client, committed calibration/regression files, and their tests.
- R3. Remove eval-only Admin env vars and comments that existed solely for the
  deleted local CLI.

**Contract preservation**

- R4. Preserve Admin public search REST/GraphQL behavior and live search
  ownership.
- R5. Preserve Admin internal search-eval routes used by Mastra:
  catalog-context, candidates/review actions, and no-trace eval search.
- R6. Preserve Admin trace labeling, sampling, retention, and optional offline
  query classification behavior.
- R7. Keep Mastra search eval workflows and clients unchanged unless a test or
  stale reference forces a narrow update.

**Documentation and operator path**

- R8. Remove current-runbook references to `pnpm eval:search` and point
  operators at `search-eval-orchestrator`/native Evaluation instead.
- R9. Update roadmap/solution references that identify deleted Admin files as
  active implementation anchors.
- R10. Historical completed brainstorm/plan artifacts may remain as history,
  but active package guides must no longer present the Admin harness as the
  current run path.

---

## Key Technical Decisions

- KTD1. Preserve route paths, relocate service ownership: Keep
  `/api/internal/search-eval/*` route URLs stable because Mastra clients and
  env vars use them. Move surviving Admin service helpers out of
  `apps/admin/src/services/search-eval/` into a contract-oriented namespace so
  the legacy harness directory can disappear without breaking HTTP contracts.
- KTD2. Keep locale profiles as contract data, not harness data:
  `catalog-context.ts` still needs the 30-locale/tier profile. Rename this
  helper away from `HARNESS_LOCALES` language and keep its tests near the new
  contract module.
- KTD3. Keep the optional LLM classifier, decoupled from the old judge:
  `query-classifier.ts` is offline trace-labeling support, not the local CLI
  judge. Move or inline its model default/OpenRouter helper dependencies so
  deleting `judge.ts` and the harness helpers does not remove classification.
- KTD4. Delete compatibility instead of aliasing it: Do not leave
  `eval-search.ts`, package-script aliases, or compatibility re-export modules
  just to keep old commands compiling. The purpose of this work is to remove
  the old operator path.
- KTD5. Update live docs, preserve historical docs: Active guides such as
  `apps/admin/CLAUDE.md`, `apps/admin/AGENTS.md`, and current roadmap/solution
  anchors should describe the Mastra path. Completed historical plans can stay
  when they are clearly past-tense history rather than current instructions.

---

## Implementation Units

### U1. Roadmap and plan artifacts

- **Goal:** Add the cleanup ticket and plan, and wire roadmap dependencies
  bidirectionally.
- **Files:** `docs/roadmap/content-discovery/feat-155-remove-legacy-admin-search-eval-harness.md`,
  `docs/roadmap/content-discovery/feat-148-search-eval-orchestrator-workflow.md`,
  `docs/roadmap/content-discovery/feat-154-production-search-eval-seed-baseline.md`,
  `docs/plans/2026-06-01-002-chore-remove-legacy-admin-search-eval-harness-plan.md`.
- **Test Scenarios:** Roadmap frontmatter has valid dependency/block symmetry;
  the plan uses repo-relative paths only.
- **Verification:** Review markdown diff and run a targeted `rg` for
  `feat-155`.

### U2. Relocate surviving Admin internal-contract services

- **Goal:** Preserve Mastra-facing Admin contracts while removing the legacy
  `apps/admin/src/services/search-eval/` namespace.
- **Files:** `apps/admin/src/services/search-eval/candidates.ts`,
  `apps/admin/src/services/search-eval/candidates.test.ts`,
  `apps/admin/src/services/search-eval/catalog-context.ts`,
  `apps/admin/src/services/search-eval/catalog-context.test.ts`,
  `apps/admin/src/services/search-eval/locales.ts`,
  `apps/admin/src/services/search-eval/locales.test.ts`,
  `apps/admin/src/app/api/internal/search-eval/**`.
- **Patterns:** Keep service-owned validation and Prisma access in
  `apps/admin/src/services/`; keep route-level bearer/rate-limit/body parsing
  in `apps/admin/src/app/api/internal/search-eval/**`.
- **Test Scenarios:** Candidate store behavior, trace redaction, review
  transitions, catalog context filters, and route mocks still pass after import
  path changes.
- **Verification:** `pnpm --filter @forge/admin test -- app/api/internal/search-eval/catalog-context/route.test.ts app/api/internal/search-eval/candidates/route.test.ts search-eval-contracts/candidates.test.ts search-eval-contracts/catalog-context.test.ts`.

### U3. Relocate optional query classifier dependencies

- **Goal:** Keep offline trace query classification while deleting the local
  judge/query-generator helper modules.
- **Files:** `apps/admin/src/services/search-eval/query-classifier.ts`,
  `apps/admin/src/services/search-eval/query-classifier.test.ts`,
  `apps/admin/src/services/search-eval/openrouter-helpers.ts`.
- **Patterns:** Follow `docs/solutions/platform/admin-search-query-labeling-pattern.md`:
  classifier must stay offline/eval-only and must not enter REST/GraphQL live
  search paths.
- **Test Scenarios:** Missing API key, model override/default, schema
  validation, transport/error handling, and sanitized prompt behavior remain
  covered under the relocated test path.
- **Verification:** `pnpm --filter @forge/admin test -- search-trace/query-classifier.test.ts`.

### U4. Delete legacy CLI harness and fixtures

- **Goal:** Remove the local CLI operator path and harness-only files.
- **Files:** `apps/admin/src/scripts/eval-search.ts`,
  `apps/admin/eval/`, `apps/admin/package.json`,
  `apps/admin/src/services/search-eval/baseline.ts`,
  `apps/admin/src/services/search-eval/calibration.ts`,
  `apps/admin/src/services/search-eval/fingerprint.ts`,
  `apps/admin/src/services/search-eval/judge.ts`,
  `apps/admin/src/services/search-eval/paths.ts`,
  `apps/admin/src/services/search-eval/query-generator.ts`,
  `apps/admin/src/services/search-eval/regressions.ts`,
  `apps/admin/src/services/search-eval/reporter.ts`,
  `apps/admin/src/services/search-eval/runner.ts`,
  `apps/admin/src/services/search-eval/search-client.ts`,
  `apps/admin/src/services/search-eval/schemas.ts`,
  `apps/admin/src/services/search-eval/types.ts`, and matching harness-only
  tests.
- **Patterns:** Use explicit deletes and rely on TypeScript/tests to catch
  missed imports.
- **Test Scenarios:** `rg "eval:search|eval-search|apps/admin/eval"` finds no
  active operator path; package scripts no longer expose deleted files.
- **Verification:** `pnpm --filter @forge/admin typecheck`.

### U5. Clean Admin env and docs

- **Goal:** Remove stale env/runbook references and replace current guidance
  with Mastra-native search eval guidance.
- **Files:** `apps/admin/src/config/env.ts`, `apps/admin/AGENTS.md`,
  `apps/admin/CLAUDE.md`, `apps/mastra/CLAUDE.md`,
  `docs/solutions/architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md`,
  `docs/solutions/platform/admin-search-query-labeling-pattern.md`,
  `docs/solutions/platform/admin-search-trace-retention-pattern.md`,
  current roadmap docs that mention deleted Admin harness files.
- **Patterns:** Keep Admin/Mastra ownership language from `apps/admin/AGENTS.md`
  and the Mastra orchestration language from `feat-148`.
- **Test Scenarios:** `rg` no longer shows active docs instructing operators
  to run `pnpm eval:search`; `OPENROUTER_QUERY_CLASSIFIER_MODEL` is retained only if the
  offline classifier still uses it, otherwise removed with the harness envs.
- **Verification:** Targeted `rg` checks plus Admin/Mastra typecheck.

### U6. Validation and completion status

- **Goal:** Prove the cleanup did not break Admin contracts or Mastra eval.
- **Files:** No primary source edits expected beyond test-driven fixes.
- **Test Scenarios:** Admin internal search-eval route tests pass; Admin trace
  labeling/sampling tests pass; Mastra search eval workflow/client tests pass;
  full typechecks pass for touched packages.
- **Verification:**

```bash
pnpm --filter @forge/admin test -- app/api/internal/search-eval/search/route.test.ts app/api/internal/search-eval/catalog-context/route.test.ts app/api/internal/search-eval/candidates/route.test.ts app/api/internal/search-traces/sample/route.test.ts search-trace.service.test.ts search-trace-privacy.test.ts
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/mastra test -- admin-search-eval-client offline-search-eval search-eval-native-suite search-eval-orchestrator eval-query-generation search-eval-candidate-review
pnpm --filter @forge/mastra typecheck
```

---

## Scope Boundaries

- Do not remove Admin public search APIs, public GraphQL search, live query
  embeddings, vector storage, or result-shape contracts.
- Do not rename Mastra env vars or internal HTTP route URLs as part of this
  cleanup.
- Do not implement production baseline capture; `feat-154` tracks that
  operational work.
- Do not migrate live search strategy ownership to Mastra.
- Do not delete trace/candidate data tables or migrations.

---

## Sources and Research

- `docs/roadmap/content-discovery/feat-148-search-eval-orchestrator-workflow.md`
  establishes Mastra's current search eval orchestrator.
- `docs/roadmap/content-discovery/feat-154-production-search-eval-seed-baseline.md`
  establishes the production baseline path through Mastra.
- `docs/solutions/architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md`
  defines the Admin/Mastra boundary and internal route contracts.
- `docs/solutions/platform/admin-search-query-labeling-pattern.md` keeps the
  optional LLM classifier out of live search.
- `docs/solutions/best-practices/external-client-retry-parity-in-runner-fanout-20260512.md`
  preserves the retry lesson even as the old Admin runner is deleted.
