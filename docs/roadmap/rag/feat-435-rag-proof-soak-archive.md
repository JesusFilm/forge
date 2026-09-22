---
id: "feat-435"
title: "Prove RAG maintenance, soak, and archive jfrag"
owner: "jaco"
priority: "P0"
status: "complete"
start_date: "2026-10-04"
duration: 7
depends_on: ["feat-434", "feat-452", "feat-460", "feat-461"]
blocks: ["feat-532"]
tags: ["rag", "verification", "retirement"]
---

## Problem

The migration originally required a small-source pipeline proof, soak, rollback
expiry, and retirement. Historical scope:
[jfrag #168](https://github.com/JesusFilm/jesusfilm-rag/issues/168). The September
22 operator decision below revises those closure gates because Forge RAG is
already the active owner and all consumers have migrated.

## Entry Points — Read These First

1. Forge acquisition/indexing commands delivered by `feat-431`, dashboard/eval commands delivered by `feat-432`, and `apps/rag/AGENTS.md` — end-to-end operating path and safety constraints.
2. [Seeker cutover](evidence/feat-434/seeker-cutover.md) and the [consumer inventory](evidence/feat-435/proof-soak-archive.md#consumer-inventory) — recorded cutover and the limits of consumer coverage.
3. [Proof, soak, and archive receipt](evidence/feat-435/proof-soak-archive.md) — requirement-by-requirement evidence, dashboard observation, operator acceptance, and limitations. This consolidates the previously planned proof and inventory records.
4. [Legacy retirement follow-up](feat-532-rag-legacy-service-credential-retirement.md) — deferred service and credential retirement, outside this closure.

## Grep These

- `acquire`
- `index`
- `dashboard`
- `archive`

## What To Build

Consolidate the available acquire → stage → normalize → chunk → embed → index →
retrieve → dashboard/eval evidence, verify repository archival and the Forge
pointer, and refresh the committed dashboard. Apply the explicitly revised
closure gates below without inventing historical production proof.

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

The September 8 decision was GO for bounded new-source acquisition/ingestion
with these concerns tracked, retaining the documented target, credential,
health, migration, source-scope and before/after evaluation checks. At that
time, feat-435 and issue #168 remained incomplete. The September 22 decision
below now governs Forge-local closure; it does not rewrite those measurements
or change the archived issue.

## Operator Decision — September 22, 2026 (Option A)

Jaco explicitly confirms that **Forge RAG is already the active owner and all
consumers have migrated; no external traffic is in scope**. This is owner
attestation and the authority for migration/consumer closure, not a newly
measured soak interval or an independently audited deployment inventory.

- Rollback rehearsal/expiry and final snapshot retention are **not applicable**
  to this ticket's closure under that ownership decision. No rehearsal,
  snapshot, or retention result is claimed retroactively.
- Legacy JesusFilm-RAG service and credential retirement is deferred to
  [feat-532](feat-532-rag-legacy-service-credential-retirement.md). It does not
  block feat-435 and authorizes no production or credential action in J030.
- Unverified GotQuestions Icelandic import provenance and the archived
  README's missing direct migration-record/`apps/rag/AGENTS.md` links are
  **accepted limitations**. Existing local proof and observed production
  presence remain distinct from an import receipt or production evaluation.
- Complete the bounded documentation/status work in draft
  [PR #2379](https://github.com/JesusFilm/forge/pull/2379). Do not merge or deploy.

## Constraints

- Preserve evidence and distinguish measured facts from owner attestation,
  non-applicable gates, accepted limitations, and deferred work.
- Do not alter production, corpus contents, credentials, infrastructure, or
  repository settings. Publication remains on the normal reviewed merge path.

## Verification

- The receipt records all revised gate dispositions and accepted limitations,
  with no fabricated import, soak, rollback, or snapshot evidence.
- The dashboard snapshot/build/verification and allowlisted Pages assembly
  pass; retain browser/load evidence and identify publication as pending.
- Roadmap status/index totals, reciprocal follow-up dependencies, local links,
  formatting, and PR checks pass.

## Closure audit — September 22, 2026

The repository archive and basic Forge README redirect are verified. The fresh
production-read dashboard observes 51 embedded GotQuestions documents labelled
`is`; it does not prove import provenance, all pipeline stages, or production
evaluation. Jaco's recollection of the import remains explicitly attributed.
The accepted local slice evidence is unchanged.

The initial audit left this ticket in progress because the historical gates
lacked retained evidence. Jaco's Option A decision now resolves that closure
decision explicitly; it does not turn those gaps into verified operations.
See the [closure matrix](evidence/feat-435/proof-soak-archive.md#closure-matrix).

The dashboard is refreshed and prepared locally for the normal PR-to-main Pages
flow. Publication and owner acceptance remain external. Feat-463 remains
non-blocking; feat-471 continues to own separate production-maintenance proof
and does not block this accepted closure. The `feat-461` dependency restores
the reciprocal edge already present in that completed ticket.

## Resolution

Completed under the September 22 Option A operator decision in
[draft Forge PR #2379](https://github.com/JesusFilm/forge/pull/2379): documented
Forge ownership/consumer migration attestation, verified repository archival
and basic redirect, accepted the explicit evidence/link limitations, and
prepared the refreshed dashboard with 51 embedded GotQuestions Icelandic
documents (24,607 embedded documents overall). Rollback rehearsal/expiry and
final snapshot retention are not applicable; legacy service/credential
retirement is tracked separately in feat-532.

Completion is the Forge roadmap's documentation/status outcome for this PR.
It does not claim a new production import/evaluation, measured soak, legacy
retirement, live dashboard publication, or closure of archived issues #130/#168.
The PR remains a draft and is not merged.
