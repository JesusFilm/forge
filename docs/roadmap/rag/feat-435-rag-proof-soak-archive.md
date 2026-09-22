---
id: "feat-435"
title: "Prove RAG maintenance, soak, and archive jfrag"
owner: "jaco"
priority: "P0"
status: "in-progress"
start_date: "2026-10-04"
duration: 7
depends_on: ["feat-434", "feat-452", "feat-460", "feat-461"]
blocks: []
tags: ["rag", "verification", "retirement"]
---

## Problem

Forge ownership is not proven until a new small source completes the full pipeline and the rollback window closes. Historical scope: [jfrag #168](https://github.com/JesusFilm/jesusfilm-rag/issues/168).

## Entry Points — Read These First

1. Forge acquisition/indexing commands delivered by `feat-431`, dashboard/eval commands delivered by `feat-432`, and `apps/rag/AGENTS.md` — end-to-end operating path and safety constraints.
2. [Seeker cutover](evidence/feat-434/seeker-cutover.md) and the [consumer inventory](evidence/feat-435/proof-soak-archive.md#consumer-inventory) — recorded cutover and the limits of consumer coverage.
3. [Proof, soak, and archive receipt](evidence/feat-435/proof-soak-archive.md) — requirement-by-requirement evidence, fresh dashboard observation, and missing retirement decisions. This consolidates the previously planned proof and inventory records.

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

## Closure audit — September 22, 2026

The repository archive and basic Forge README redirect are verified. The fresh
production-read dashboard observes 51 embedded GotQuestions documents labelled
`is`; it does not prove import provenance, all pipeline stages, or production
evaluation. Jaco's recollection of the import remains explicitly attributed.
The accepted local slice evidence is unchanged.

Keep this ticket **in progress**: the retained records do not establish a full
consumer inventory, Seeker/NanoClaw soak, rollback rehearsal and approved expiry,
final snapshot retention ownership, or legacy service/secret retirement. The
archived README also lacks the two direct links required above. Missing evidence
is not evidence that an operation failed or did not occur. Owner confirmation
or an explicit acceptance/scope decision is required; this documentation PR
does not invent it. See the [closure matrix and decision needed](evidence/feat-435/proof-soak-archive.md).

The dashboard is refreshed and prepared locally for the normal PR-to-main Pages
flow. Publication and owner acceptance remain external. Feat-463 remains
non-blocking; feat-471 continues to own production-maintenance proof. The
`feat-461` dependency restores the reciprocal edge already present in that
completed ticket.

Audit and prepared dashboard: [draft Forge PR #2379](https://github.com/JesusFilm/forge/pull/2379).
This is not a completion resolution.
