---
date: 2026-10-05
draft_id: "09"
title: "Bound experiment storage and prove cleanup capacity"
status: published
issue_url: https://github.com/JesusFilm/forge/issues/2574
roadmap: feat-590
draft_blocked_by: ["04", "08"]
---

# 09: Bound experiment storage and prove cleanup capacity

## Parent

https://github.com/JesusFilm/forge/issues/2565

## What to build

Provide an operator-visible storage/capacity report and safe cleanup for the
experiment's generations, diagnostics, and evaluation history. Verify the combined
generation and measurement footprint under realistic traffic before it can be
approved for public activation.

Preserve all accepted connections in retained generations and the existing
recommendation evidence meaning while keeping Railway growth bounded.

## Acceptance criteria

- [ ] Extend the merged compact trace, packed snapshot, compact identity, and nonredundant-index patterns. Exact served history remains readable without reconstruction from mutable catalog data.
- [ ] Retention explicitly protects active, fixed-test, and required rollback generations. Superseded builds, failed diagnostics, checkpoints, and evaluation revisions have bounded lifetimes; references are handled safely before reclamation.
- [ ] Explanations/evidence are stored once per generation. Raw model responses, full transcripts, warehouse rows, and repeated checkpoint payloads do not become an unbounded second data store.
- [ ] Preserve the 29-day request-owned raw lifecycle, descendant expiry, and existing sanitized audit rules. Compact results/sufficient statistics from evaluation survive as designed without preserving raw visit identities indefinitely.
- [ ] Admin reports native PostgreSQL bytes per visit/connection/generation, observed traffic assumptions, retained-volume projection, heap/index/TOAST, WAL, write/query impact, and concurrent-build/rollback overlap.
- [ ] Include Mastra runtime checkpoints and observability volume in the footprint review. Measure available Railway headroom and record a capacity budget/readiness result; no arbitrary numeric budget is claimed without measurement.
- [ ] The build capacity preflight uses the measured retained/build-overlap budget. An oversized new generation fails explicitly while keeping the prior complete results; protected storage is not consumed to meet a model-output count.
- [ ] Loaded cleanup tests include realistic expired roots/descendants, concurrent writes, interruptions, and protected generations. Successful empty cleanup does not count as throughput proof.
- [ ] Report database space available for reuse separately from filesystem bytes recovered; deleting rows is not claimed to shrink the volume automatically.
- [ ] Native format parity, raw/aggregate reconciliation, and retention tests prove storage savings do not sample the visit denominator, truncate the graph to six edges, or lose immutable attribution.
- [ ] No destructive production reclamation, retention shortening, new analytics database, or BigQuery export is introduced.

## Implementation context

Read the merged storage-efficiency work and the separate outstanding loaded
retention-capacity work. Fixture savings are not a production forecast. The first
model build's unrestricted spending decision does not remove physical capacity
requirements. This slice produces readiness evidence for the manual controls.

## Blocked by

- #2569
- #2573

## Execution policy

The user approved this ticket breakdown and the parent spec's testing boundaries.
Use GPT-6 Sol development chats and Matt Pocock's implement, tdd, and code-review
skills. Do not invoke Compound Engineering skills, directly or through another
skill; this explicit user instruction overrides that default repository workflow.
Follow the other repository conventions. Development-chat Sol does not replace
the product's Astra model. Work under the orchestrator's integration branch;
public activation remains a separate explicit operation.
