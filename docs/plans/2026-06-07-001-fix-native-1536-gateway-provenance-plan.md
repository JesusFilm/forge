---
title: "fix: Align AI Gateway content embedding provenance with native 1536 output"
type: fix
status: active
date: 2026-06-07
origin: docs/handoffs/2026-06-07-native-1536-prod-reembed-agent-prompt.md
roadmap: docs/roadmap/content-discovery/feat-156-mastra-ai-gateway-content-embeddings.md
---

# fix: Align AI Gateway Content Embedding Provenance With Native 1536 Output

## Summary

Update the AI Gateway content embedding contract so Mastra and Admin treat the
current production gateway as native 1536-dimensional output with no client
transform. Preserve the generic 4096-to-1536 transform helper for future
gateway configurations, then run the provider-bound validation gates before any
production content vectors are rewritten.

---

## Problem Frame

`feat-156` originally assumed the Jesus Film AI Gateway returned native
4096-dimensional Matryoshka vectors that Mastra truncated and re-normalized to
1536 before Admin ingest. The live production gateway has since been verified
to emit native 1536-dimensional unit vectors for `model: embeddings`.

If the code and gate artifacts still report `nativeDimensions: 4096` and
`transformVersion: "matryoshka-truncate-1536-v1"`, Admin can reject a valid
native-1536 production gate or persist misleading provenance. The corrective
contract is provider `jesus-film-ai-gateway`, model/request model
`embeddings`, native dimensions `1536`, final dimensions `1536`, and
`transformVersion: null`.

---

## Requirements

- R1. Mastra gateway provider config must not pass `truncateToDimensions` or
  `transformVersion` when expected native and final dimensions are both 1536.
- R2. Mastra gate reports must serialize the provider tuple as native `1536`,
  final `1536`, and `transformVersion: null` for the current production
  gateway.
- R3. Admin `run-embeds --pipeline=all` must accept only the same native-1536
  provider tuple for production all-content backfill reports.
- R4. The shared embedding provider helper and tests must continue supporting
  real 4096-to-1536 truncation if a future gateway configuration returns 4096
  again.
- R5. Documentation that operators use for `feat-156` must be updated so it no
  longer instructs them to expect 4096 native output for the current production
  contract.
- R6. Production wipe or re-embed must remain blocked until the provenance fix
  is merged, deployed to Admin and Mastra, production backup is verified, and a
  fresh provider-bound native eval gate passes.
- R7. The production rewrite target is the main `embedding` content-vector path
  for scene, transcript, and experience content; `embedding_qwen` columns stay
  out of scope unless separately verified.
- R8. All eval reports and operator summaries that authorize or describe the
  migration must live under `docs/search-eval-reports/` and must not contain
  secrets, raw vectors, raw provider payloads, raw query/source text, database
  URLs, or bearer tokens.

---

## Key Technical Decisions

- KTD1. **Represent no-op transforms as `null`:** A native 1536 response needs
  no Matryoshka transform marker. `null` is more accurate than an empty string
  and lets Admin distinguish "no transform" from "unknown transform."
- KTD2. **Derive transform settings from native/final dimension equality:**
  Mastra should only include `truncateToDimensions` and `transformVersion`
  when native dimensions differ from final dimensions. This keeps one config
  path valid for both native-1536 production and a future 4096 gateway.
- KTD3. **Keep Admin's backfill gate provider-bound:** Admin should compare the
  full provider tuple from the docs report to its expected tuple before
  allowing `--pipeline=all` against non-local databases.
- KTD4. **Correct operator docs without rewriting historical artifacts:**
  Existing June 3 eval JSON files remain historical records of earlier local
  runs. Current roadmap, guide, and solution notes should explain the verified
  production contract and when older 4096 artifacts are no longer sufficient.

---

## Implementation Units

### U1. Native-1536 Provider Contract in Mastra

- **Goal:** Make Mastra emit no client transform config and no transform
  provenance for the current native-1536 gateway contract.
- **Requirements:** R1, R2, R4
- **Files:**
  - Modify: `apps/mastra/src/config/env.ts`
  - Modify: `apps/mastra/src/config/env.test.ts`
  - Modify: `apps/mastra/src/scripts/run-content-embedding-search-eval.ts`
  - Modify: `apps/mastra/src/scripts/run-content-embedding-search-eval.test.ts`
  - Modify: `apps/mastra/src/services/offline-search-eval/report.ts`
  - Modify: `apps/mastra/src/services/offline-search-eval/report.test.ts`
  - Test: `apps/mastra/src/services/embedding-provider.test.ts`
- **Patterns:** Keep the shared transform behavior in
  `apps/mastra/src/services/embedding-provider.ts`; configure whether it runs
  from `apps/mastra/src/config/env.ts`.
- **Test scenarios:**
  - Gateway mode with native/final 1536 returns provider config without
    `truncateToDimensions` and without `transformVersion`.
  - Gate report provider tuple has `transformVersion: null`.
  - Existing embedding-provider tests still prove 4096 input can truncate and
    re-normalize to 1536.

### U2. Native-1536 Backfill Gate in Admin

- **Goal:** Require native `1536`, final `1536`, and `transformVersion: null`
  before Admin accepts a production all-content backfill gate report.
- **Requirements:** R3, R6, R8
- **Files:**
  - Modify: `apps/admin/src/scripts/run-embeds.ts`
  - Modify: `apps/admin/src/scripts/run-embeds.test.ts`
- **Patterns:** Preserve the provider-bound report checks from
  `docs/solutions/architecture-patterns/provider-bound-content-embedding-backfill-gate-pattern.md`,
  including docs-path validation, schema checks, secret scanning, judge/gate
  checks, and local-only bypass boundaries.
- **Test scenarios:**
  - A valid native-1536 report with `transformVersion: null` is accepted.
  - A stale 4096/truncate report is rejected for production all-content
    backfill.
  - A missing, empty-string, or wrong transform version fails with a useful
    config error.

### U3. Operator Documentation and Provenance Notes

- **Goal:** Align current operator-facing guidance with verified production
  native 1536 output while preserving historical context for old local reports.
- **Requirements:** R5, R6, R7, R8
- **Files:**
  - Modify: `apps/mastra/AGENTS.md`
  - Modify: `docs/roadmap/content-discovery/feat-156-mastra-ai-gateway-content-embeddings.md`
  - Modify: `docs/search-eval-reports/README.md`
  - Modify: `docs/solutions/architecture-patterns/provider-bound-content-embedding-backfill-gate-pattern.md`
- **Patterns:** Follow the production go/no-go and report safety language
  already in the roadmap and solution note, but change the current expected
  tuple to native `1536` and `transformVersion: null`.
- **Test scenarios:** Documentation-only; review for absence of secrets,
  database URLs, or obsolete current-contract claims.

### U4. Local Validation and PR Readiness

- **Goal:** Prove the code contract before opening the PR that must merge
  before production operations.
- **Requirements:** R1, R2, R3, R4
- **Files:** Same files as U1 and U2.
- **Verification commands:**
  - `pnpm --filter @forge/mastra exec vitest run src/services/embedding-provider.test.ts src/config/env.test.ts src/services/offline-search-eval/report.test.ts src/scripts/run-content-embedding-search-eval.test.ts`
  - `pnpm --filter @forge/admin exec vitest run src/scripts/run-embeds.test.ts`
  - `pnpm --filter @forge/mastra typecheck`
  - `pnpm --filter @forge/admin typecheck`
- **Test scenarios:**
  - Targeted tests pass for Mastra and Admin.
  - Typechecks pass for both packages.
  - Diff contains no production secrets or raw env values.

### U5. Production Deployment and Re-embed Gate

- **Goal:** Define the safe production sequence after the code contract lands.
- **Requirements:** R6, R7, R8
- **Files:**
  - Create or modify: `docs/search-eval-reports/<native-1536-report-id>.json`
  - Create or modify:
    `docs/search-eval-reports/<native-1536-report-id>-summary.md`
- **Approach:** After merge and deploy, verify Admin and Mastra production are
  running the merged commit, confirm required env presence without printing
  values, run the live gateway dimension smoke, record pre-backfill provenance
  counts, capture a fresh native-1536 eval gate, verify a fresh production DB
  backup, and only then run `run-embeds --pipeline=all` with model-upgrade modes
  against the passed report.
- **Test scenarios:**
  - The live gateway smoke returns dimension `1536` and unit norm around `1.0`
    without printing the API key.
  - Pre-backfill and post-backfill counts are recorded for
    `video_scene_locale`, `video_transcript_chunk` joined to
    `video_transcript`, and `experience_locale`.
  - Post-backfill provenance shows provider `jesus-film-ai-gateway`, native
    `1536`, final `1536`, and transform `NULL` for regenerated rows.
  - A post-backfill eval report is saved and summarized with pass/fail,
    multilingual coverage, and residual workflow/run IDs.

---

## Scope Boundaries

- The generic 4096-to-1536 transform helper remains in
  `apps/mastra/src/services/embedding-provider.ts`.
- No production data wipe occurs in the code-contract PR.
- No `embedding_qwen` columns are changed for this migration.
- No public search response shapes, Admin GraphQL schema, pgvector dimensions,
  or live query embedding ownership boundaries change.
- Historical June 3 eval artifacts that recorded 4096-native local runs are
  not edited as if they were current production evidence.

---

## Risks & Dependencies

- The current work depends on the verified production gateway behavior staying
  native 1536 for `model: embeddings`. If the gateway returns 4096 again, the
  provider config must intentionally re-enable truncation and gate reports must
  carry the 4096/truncate tuple.
- Production re-embed depends on merge, deploy verification, credentials,
  a fresh backup, a passed native eval gate, and operator access to production
  Admin/Mastra environments.
- Stale 4096 reports under `docs/search-eval-reports/` are useful historical
  evidence but must not authorize the native-1536 production backfill.

---

## Sources

- `docs/handoffs/2026-06-07-native-1536-prod-reembed-agent-prompt.md`
- `docs/roadmap/content-discovery/feat-156-mastra-ai-gateway-content-embeddings.md`
- `docs/plans/2026-06-03-001-feat-mastra-ai-gateway-embeddings-plan.md`
- `docs/solutions/architecture-patterns/provider-bound-content-embedding-backfill-gate-pattern.md`
- `apps/mastra/AGENTS.md`
- `apps/admin/AGENTS.md`
