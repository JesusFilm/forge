---
date: 2026-06-01
topic: production-search-eval-seed-baseline
---

# Production Search Eval Seed Baseline

## Summary

Capture the first broad search-eval baseline by running synthetic/native
generated eval queries against production Admin search, storing the captured
baseline in Mastra runtime storage, and providing a sanitized export/import path
so local Mastra can compare future search changes against the same production
reference without local production access.

---

## Problem Frame

Search ranking and retrieval work needs a stable "better or worse than before"
reference. The earlier Admin eval harness established a synthetic/native query
mode and baseline comparison model, but the future owner for search evals is
Mastra, not the legacy Admin CLI. Without a first Mastra-owned seed baseline,
local search iteration still depends on ad hoc production access, stale Admin
artifacts, or subjective inspection.

The first baseline should not wait for production trace volume, query
promotion, or human-reviewed regression gates. The immediate value is a broad,
repeatable production-captured reference generated from synthetic/native eval
queries, stored where Mastra-owned search eval work can build on it.

---

## Key Decisions

- **Mastra runtime storage is the source of truth.** The baseline should be
  captured into Mastra's runtime database rather than committed as the primary
  source of truth. This keeps production-derived result data out of normal repo
  churn and aligns search eval ownership with Mastra.
- **Synthetic/native queries are the seed source.** The first baseline uses the
  generated query mode originally designed for broad multilingual search evals,
  not production traces or human-promoted regression cases.
- **Local access goes through a sanitized artifact.** Local development imports
  an explicit exported artifact instead of pulling directly from production or
  receiving production database credentials.
- **This is a seed baseline, not the full eval program.** The work unblocks
  future comparison and local development; trace-derived candidates,
  promotion/rejection workflows, and release gates remain separate layers.

---

## Actors

- A1. **Search evaluator.** Runs or reviews the baseline capture and uses local
  comparisons to judge future search changes.
- A2. **Mastra runtime.** Owns the durable search-eval baseline, export/import
  workflow, and future eval execution path.
- A3. **Admin search.** Serves production search results for the synthetic/native
  query set; remains the live search authority.
- A4. **Local developer.** Imports the sanitized baseline artifact into local
  Mastra and runs comparisons without production credentials.

---

## Requirements

**Baseline Capture**

- R1. The system must support capturing a named first seed baseline by running
  the broad synthetic/native search eval query set against production Admin
  search.
- R2. The captured baseline must preserve enough provenance for future
  comparisons: capture time, query source, locale mix, search target identity,
  result lists, strategy/version labels when available, and the production
  search state fingerprint available at capture time.
- R3. Baseline capture must store the durable baseline in Mastra runtime
  storage, not as the legacy Admin eval baseline file.
- R4. Capture must be explicit and operator-initiated; it must not silently
  regenerate or replace the seed baseline during normal eval runs.

**Local Portability**

- R5. The system must provide a sanitized export artifact for a captured Mastra
  baseline that is safe to move from production to local development.
- R6. The export artifact must contain only the data needed for local eval
  comparison and must not include service tokens, database credentials, raw
  production trace rows, cookies, IP addresses, or user identifiers.
- R7. Local Mastra must be able to import the sanitized artifact into local
  runtime storage and treat it as the baseline for later local search-eval
  comparisons.
- R8. Importing a baseline locally must be idempotent: repeating the import for
  the same exported baseline should not create duplicate active baselines or
  ambiguous comparison targets.

**Ownership and Compatibility**

- R9. Mastra must be the forward-looking owner of this seed baseline, even if
  implementation reuses ideas or adapters from the legacy Admin eval harness.
- R10. Admin remains the production search execution authority; the baseline
  workflow must not move live search orchestration or live query embedding into
  Mastra.
- R11. The seed baseline must be compatible with future Mastra search-eval
  reports, strategy comparisons, and native evaluation records.
- R12. The baseline model must leave room for later trace-derived candidates and
  human-promoted regression gates without treating those later sources as part
  of this ticket.

**Security and Operations**

- R13. Local development must not require production Admin database credentials,
  production Mastra database credentials, or direct production trace access to
  use the seed baseline.
- R14. Export and import actions must be authenticated or operator-gated in the
  environments where they run.
- R15. The implementation must verify production Mastra runtime storage before
  capture: database-backed runtime storage, configured storage location, and the
  ability to persist and read the baseline.
- R16. Capture output must make failures visible enough that an operator can see
  whether the baseline is incomplete, stale, or unsafe to use.

---

## Key Flows

- F1. Seed baseline capture
  - **Trigger:** The search evaluator starts the first seed-baseline capture in
    production.
  - **Actors:** A1, A2, A3
  - **Steps:** Mastra loads or generates the broad synthetic/native query set,
    calls production Admin search, records result lists and provenance, and
    persists the baseline in Mastra runtime storage.
  - **Outcome:** A named baseline exists in production Mastra and can be used as
    the reference for future comparisons.
  - **Covered by:** R1, R2, R3, R4, R9, R10, R15, R16

- F2. Sanitized export
  - **Trigger:** A search evaluator wants to make the captured production
    baseline available to local developers.
  - **Actors:** A1, A2
  - **Steps:** Mastra reads the stored baseline, removes anything outside the
    approved eval artifact shape, and produces a bounded artifact for local
    import.
  - **Outcome:** The exported artifact can be reviewed and moved locally without
    exposing production credentials or raw production trace data.
  - **Covered by:** R5, R6, R13, R14

- F3. Local import and comparison
  - **Trigger:** A developer wants to evaluate local search changes against the
    production seed baseline.
  - **Actors:** A2, A4
  - **Steps:** Local Mastra imports the sanitized artifact into local runtime
    storage, marks it as the comparison baseline, and future local eval runs use
    it as their reference.
  - **Outcome:** Local search work can be compared against the production seed
    baseline without logging into production.
  - **Covered by:** R7, R8, R11, R13

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given production Mastra can reach production Admin
  search, when the evaluator runs the seed-baseline capture, then Mastra stores
  a named baseline with query, locale, result, provenance, and capture metadata.
- AE2. **Covers R4.** Given a seed baseline already exists, when a normal eval
  comparison runs, then it does not overwrite or regenerate that baseline unless
  the operator explicitly starts a capture or replacement action.
- AE3. **Covers R5, R6, R13.** Given a production baseline exists, when an
  export is produced for local development, then the artifact includes the
  comparison data and excludes production credentials, raw traces, cookies, IPs,
  and user identifiers.
- AE4. **Covers R7, R8.** Given a local developer imports the same exported
  baseline twice, when local Mastra lists available baselines, then there is
  still one active local baseline for that exported capture.
- AE5. **Covers R10.** Given a live user performs production search, when the
  baseline feature exists, then Admin still handles the live search path without
  requiring Mastra to orchestrate live retrieval.
- AE6. **Covers R15, R16.** Given production Mastra storage is missing or cannot
  persist the baseline, when capture is attempted, then the run fails loudly
  before presenting an incomplete baseline as usable.

---

## Success Criteria

- A broad synthetic/native baseline can be captured against production Admin
  search and stored in Mastra runtime storage.
- A local developer can import the sanitized artifact into local Mastra and use
  it as the baseline for future comparison runs.
- The local workflow requires no production database credentials and no direct
  production trace access.
- The capture makes enough provenance visible that future search changes can be
  interpreted against a known production reference rather than a mystery
  snapshot.
- The artifact and storage shape can become the handoff point for later Mastra
  search-eval work without preserving the legacy Admin CLI as the long-term
  owner.

---

## Scope Boundaries

- Production search trace sampling is out of scope for this seed baseline.
- Human promotion, rejection, and permanent regression-gate workflows are out of
  scope.
- Copying production database rows into local development is out of scope.
- Live search orchestration remains in Admin; moving query-time retrieval into
  Mastra is out of scope.
- Deleting the legacy Admin eval harness is out of scope, though this baseline
  should unblock that later cleanup.
- CI gating and release-blocking search evals are out of scope for this ticket.

---

## Dependencies / Assumptions

- Production Mastra runtime storage is expected to exist via `DATABASE_URL`, with
  Studio-visible observability storage backed separately by `MASTRA_STORAGE_DIR`.
- The existing synthetic/native query generation concept remains acceptable as
  the first broad baseline source.
- Production Admin search has enough indexed content for the broad locale set
  to produce meaningful baseline result lists.
- The future Mastra search-eval path may need to be created or completed as part
  of this ticket; the referenced Mastra search-eval files are not present in
  this checkout.
- The exported artifact is allowed to contain query text and search result
  metadata from synthetic/native eval cases, but not raw production trace rows
  or sensitive operational secrets.

---

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- [Affects R2, R11][Technical] Define the exact Mastra-native baseline record
  and export artifact shape.
- [Affects R1, R4][Technical] Decide whether capture generates missing
  synthetic/native query sets on demand or requires them to exist before
  capture begins.
- [Affects R5, R14][Technical] Decide the operator interface for export and
  import: Studio workflow, service route, CLI script, or a combination.
- [Affects R15][Technical] Verify the live Railway `@forge/mastra` storage
  environment before the first production capture.
- [Affects R16][Technical] Decide how partial capture is represented: rejected
  entirely, stored as failed/incomplete, or stored only when minimum coverage is
  met.

---

## Sources / Research

- `docs/brainstorms/2026-05-06-semantic-search-eval-harness-requirements.md` -
  original synthetic/native query and baseline comparison requirements.
- `docs/plans/2026-05-07-001-feat-semantic-search-eval-harness-plan.md` -
  legacy Admin eval harness plan and baseline concepts.
- `apps/admin/src/services/search-eval/query-generator.ts` - current
  synthetic/native query generation behavior.
- `apps/admin/src/services/search-eval/locales.ts` - broad locale set used by
  the existing eval harness.
- `apps/admin/src/scripts/eval-search.ts` - legacy Admin CLI capture and run
  entry point.
- `docs/roadmap/content-discovery/feat-138-mastra-eval-query-generation.md` -
  later Mastra candidate-generation direction.
- `docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md` -
  later Mastra offline eval runner direction.
- `docs/roadmap/content-discovery/feat-140-search-eval-human-promotion-regression-gates.md` -
  later human-promotion and regression-gate direction.
- `docs/roadmap/content-discovery/feat-155-remove-legacy-admin-search-eval-harness.md` -
  cleanup that depends on `feat-154`.
- `apps/mastra/AGENTS.md` and `apps/mastra/CLAUDE.md` - Mastra ownership,
  storage, and boundary rules.
- `docs/roadmap/platform/feat-130-mastra-observability-storage.md` - completed
  Mastra runtime and observability storage setup.
