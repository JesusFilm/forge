---
title: "Recommendation Profile Reconciliation Roadmap - Plan"
type: "docs"
date: "2026-09-06"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# Recommendation Profile Reconciliation Roadmap - Plan

## Goal Capsule

- **Objective:** Forge operators can see and sequence the production-evidenced recommendation profile reconciliation work before any personalization expansion.
- **Means:** Add one P0 roadmap ticket and connect it as a prerequisite for recommendation readiness and live-profile rollout work. (KTD1)
- **Authority:** The user's request and verified production evidence govern scope; current roadmap conventions govern metadata and rendering.
- **Execution profile:** Documentation-only roadmap change on a fresh branch from `origin/main`.
- **Stop conditions:** Stop if the ticket would activate experiments, promotion, learning, or ranking, or if roadmap validation fails.
- **Tail ownership:** Ship through the repository PR workflow and verify the production Roadmap deployment.

## Product Contract

### Summary

Add a dedicated P0 recommendation reliability ticket for eligibility revision reconciliation and stale profile projection fencing. Make it a prerequisite for semantic readiness and the active anonymous-profile rollout without changing their authored statuses.

### Problem Frame

The 2026-09-06 production audit found 45 profile contributions that current policy no longer considers eligible. Those contributions affected 23 current profile generations, and 78 later hybrid requests consumed affected generations. The same audit found 73 profile projection runs stuck beyond the expected claim window. The projection builder can rebuild from current eligible evidence, but the live profile candidate read does not yet reject a generation whose contribution lineage has become ineligible.

Observational hybrid CTR is promising, but there are no randomized exposures and the readiness decision remains data-unhealthy. Profile integrity repair must therefore precede experiment, promotion, and rollout expansion.

### Key Decisions

- **Add a dedicated P0 reliability ticket before personalization expansion.** (session-settled: user-approved — chosen over proceeding to profile-retention or feature expansion work: current production evidence shows stale ineligible lineage can remain live.) Governs R1-R5.
- **Keep the implementation out of this roadmap shipment.** (session-settled: user-directed — chosen over combining code changes with the roadmap update: the user requested a shipped ticket followed by a separate kickoff prompt.) Governs R6.

### Requirements

**Ticket identity and sequencing**

- R1. Add `feat-459` as a P0, not-started Content Discovery ticket owned by `nisal`.
- R2. Make `feat-459` depend on the completed integrity and profile foundations while treating the still-open active-playback closeout as related evidence, not a start blocker.
- R3. Keep every `feat-459` dependency edge bidirectional: add the reverse block from `feat-376` and `feat-386`, and make `feat-459` a prerequisite for `feat-381` and `feat-447` on both sides of the roadmap graph.
- R4. Preserve `feat-369` and `feat-447` as in-progress.

**Future implementation contract**

- R5. The ticket must require fail-closed profile serving, deterministic replacement generations, current-policy contribution reconciliation, stuck-run recovery, privacy-safe Admin evidence, and production proof without fabricating evidence or widening ranking authority.
- R6. This shipment must change roadmap documentation only and leave the future implementation for a separately launched task.

**Release quality**

- R7. Regenerate the root roadmap index and pass roadmap lint and build checks.
- R8. Verify that the deployed production Roadmap can render the new ticket after merge.

### Scope Boundaries

**Included**

- Add the new ticket and reciprocal dependency metadata.
- Regenerate the roadmap index.
- Ship and verify the Roadmap deployment.

**Deferred to Follow-Up Work**

- Implement profile reconciliation, serving fences, workflow recovery, Admin evidence, and production cleanup.
- Reassess semantic delivery reliability after profile integrity is clean.
- Consider experiments or promotion only after their existing gates pass.

**Excluded**

- GitHub issue mutation.
- Recommendation serving, database, Web, Admin, or production-data mutation.
- Any activation or widening of experiments, promotion, learning, or ranking.

## Planning Contract

### Key Technical Decisions

- KTD1. **Use the next repository-wide roadmap ID and reciprocal graph edges.** Create `feat-459`, list completed `feat-376` and `feat-386` as prerequisites with reverse block entries, and add `feat-459` to `feat-381` and `feat-447` dependencies. Keep `feat-369` as a related in-progress evidence source rather than blocking the next ticket from starting. This keeps every edge reciprocal and the generated blocked state consistent with the ticket's `blocks` list. (session-settled: user-approved — chosen over an unlinked informational ticket: the repair must be an enforceable gate before readiness and rollout.)
- KTD2. **Keep production measurements as dated problem evidence, not permanent thresholds.** The ticket names the observed contamination and backlog while its completion gates require a fresh zero-contamination audit.
- KTD3. **Use existing roadmap validation and deployment boundaries.** Regenerate `docs/roadmap/README.md`, validate the Roadmap app, and rely on its `docs/roadmap/**` Railway watch path after merge.

### Assumptions

- `feat-459` is the next unused repository-wide feature ID on the fetched `origin/main` revision.
- The current production audit is sufficient to prioritize the work, but the implementation task must independently reproduce and refresh every count.
- A docs-only change does not require Web or Admin application suites because it does not touch their code or contracts.

### Risks and Mitigations

- A one-sided dependency edit could leave roadmap presentation inconsistent. Update the reverse edge for every `depends_on` and `blocks` entry added by this ticket.
- Volatile production counts could be mistaken for permanent acceptance thresholds. Date the evidence and make the completion gate a fresh invariant check.
- A promising observational CTR could be read as promotion authority. State that there is no randomized exposure evidence and prohibit activation in this ticket.

## Implementation Units

### U1. Add the recommendation reconciliation ticket

- **Goal:** Capture the production-evidenced integrity repair as an implementation-ready P0 roadmap ticket.
- **Requirements:** R1, R2, R5, R6.
- **Dependencies:** None.
- **Files:** `docs/roadmap/content-discovery/feat-459-recommendation-profile-eligibility-reconciliation.md`
- **Approach:** Follow the recommendation roadmap ticket structure. Include dated evidence, precise entry points, build scope, Admin evidence gate, constraints, and verification. Keep the ticket outcome-based and omit raw profile identifiers.
- **Patterns to follow:** `docs/roadmap/content-discovery/feat-376-recommendation-integrity-eligibility.md`, `docs/roadmap/content-discovery/feat-386-multi-interest-profile-candidates.md`, and `docs/roadmap/content-discovery/feat-447-live-anonymous-profile-personalization-pilot.md`.
- **Test scenarios:** Test expectation: none — this unit adds roadmap content without runtime behavior.
- **Verification:** The ticket parser accepts the frontmatter and the rendered ticket communicates the failure, repair, boundaries, and proof gates without requiring session context.

### U2. Wire the roadmap gate and generated index

- **Goal:** Make the new reliability ticket an enforceable roadmap prerequisite and publish it through the Roadmap app.
- **Requirements:** R3, R4, R7, R8.
- **Dependencies:** U1.
- **Files:** `docs/roadmap/content-discovery/feat-376-recommendation-integrity-eligibility.md`, `docs/roadmap/content-discovery/feat-381-semantic-control-readiness.md`, `docs/roadmap/content-discovery/feat-386-multi-interest-profile-candidates.md`, `docs/roadmap/content-discovery/feat-447-live-anonymous-profile-personalization-pilot.md`, `docs/roadmap/README.md`.
- **Approach:** Add every reverse `blocks` and `depends_on` edge without changing authored statuses. Regenerate the index through the repository script and validate the Roadmap app before shipping.
- **Patterns to follow:** Existing reciprocal `depends_on` and `blocks` relationships in the recommendation roadmap series.
- **Test scenarios:**
  - The generated index lists `feat-459` once in Content Discovery with P0 and not-started metadata.
  - `feat-381` and `feat-447` resolve as blocked by the unfinished `feat-459` while `feat-447` retains its authored in-progress status.
  - The ticket detail route renders the markdown sections and dependency links.
- **Verification:** Roadmap generation has no unstaged regeneration drift, lint passes, the production build succeeds, and the deployed ticket route returns successfully after merge.

## Verification Contract

| Gate               | Scope  | Done signal                                                                                                       |
| ------------------ | ------ | ----------------------------------------------------------------------------------------------------------------- |
| Roadmap generation | U1, U2 | `pnpm --filter roadmap generate:readme` followed by Prettier completes, and repeating that pair produces no diff. |
| Roadmap lint       | U1, U2 | `pnpm --filter roadmap lint` passes with zero warnings or errors.                                                 |
| Roadmap build      | U1, U2 | `pnpm --filter roadmap build` passes and includes the ticket surface.                                             |
| Diff review        | U1, U2 | The diff from `origin/main` contains only the ticket, reciprocal dependencies, generated index, and this plan.    |
| Production proof   | U2     | The merged commit is deployed by the Roadmap service and the public ticket route returns the new content.         |

## Definition of Done

- `feat-459` exists with the required production evidence, repair scope, safety constraints, and verification contract.
- The dependency graph gates `feat-381` and `feat-447` on `feat-459` without changing `feat-369` or `feat-447` authored status.
- Roadmap generation, lint, build, review, and CI pass.
- The PR is merged and the production Roadmap renders the new ticket.
- No abandoned or unrelated changes remain in the branch.
