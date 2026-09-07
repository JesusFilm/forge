---
id: "feat-435"
title: "Prove RAG maintenance, soak, and archive jfrag"
owner: "jaco"
priority: "P0"
status: "in-progress"
start_date: "2026-10-04"
duration: 7
depends_on: ["feat-434", "feat-452", "feat-460"]
blocks: []
tags: ["rag", "verification", "retirement"]
---

## Problem

Forge ownership is not proven until a new small source completes the full pipeline and the rollback window closes. Historical scope: [jfrag #168](https://github.com/JesusFilm/jesusfilm-rag/issues/168).

## Entry Points — Read These First

1. Forge acquisition/indexing commands delivered by `feat-431`, dashboard/eval commands delivered by `feat-432`, and `apps/rag/AGENTS.md` — end-to-end operating path and safety constraints.
2. `docs/roadmap/rag/evidence/feat-434/seeker-cutover.md` and `docs/roadmap/rag/evidence/feat-435/consumer-inventory.md` — cutover baseline and planned public/private consumer inventory.
3. `docs/roadmap/rag/evidence/feat-435/proof-soak-archive.md` — planned small-source deltas, soak criteria, rollback exercise, snapshot retention, archival approval, and jfrag redirect receipt.

## Grep These

- `acquire`
- `index`
- `dashboard`
- `archive`

## What To Build

Run one small source through acquire → stage → normalize → chunk → embed → index → retrieve → dashboard/eval, complete soak, take the final snapshot, and archive jfrag with a Forge pointer.

## Operator Decision — September 8, 2026

The operator accepts the fresh production baseline as the starting point for
new-source acquisition and ingestion under this proof. Capturing the recall,
coverage, and language-label concerns in
[feat-463](./feat-463-rag-baseline-concerns-investigation.md) is the agreed
compromise: investigation and any potential fixes may proceed separately and
are not prerequisites for acquisition or ingestion.

This decision supersedes the quality-based `no-go` recommendation in the
September 7 baseline assessment in
[PR #2186](https://github.com/JesusFilm/forge/pull/2186), including its
`production-eval-baseline.json` receipt. The measured results remain unchanged;
acceptance does not turn an observed shortfall into a passing comparison or a
confirmed defect. No compatible historical evaluation receipt establishes a
migration regression.

GO for the bounded new-source acquisition/ingestion proof with these concerns
tracked. Continue the documented target, credential, health, migration, and
source-scope checks and retain before/after evaluation evidence. Feat-435 and
issue #168 remain incomplete; soak and retirement have their own criteria.

## Constraints

- Retirement requires approved rollback expiry and every consumer accounted for.
- Preserve final snapshot retention ownership and recovery documentation.

## Verification

- End-to-end evidence covers every pipeline stage without corpus text in reports.
- Seeker and NanoClaw pass soak; jfrag README points to `apps/rag/AGENTS.md` and the migration record.
