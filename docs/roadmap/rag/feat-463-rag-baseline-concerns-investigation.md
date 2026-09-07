---
id: "feat-463"
title: "Investigate RAG baseline recall, coverage, and language-label concerns"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-09-08"
duration: 3
depends_on: []
blocks: []
tags: ["rag", "evaluation", "investigation", "language"]
---

## Problem

The September 7 production evaluation surfaced three concerns for investigation.
They are observations and hypotheses, not confirmed broken functionality or
proven migration regressions. The run completed 416 cases with a working
read-only production credential. No compatible historical evaluation receipt
exists to establish regression or causation.

| Concern         | Observation                                                                                                                                                                                                                | What requires validation                                                                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recall          | Recall@10 was `0.949519` (395/416); 21 cases had no relevant match, versus the documented provisional `0.980` floor.                                                                                                       | Validate case expectations, eligible documents, language filtering, and ranking for the misses; establish whether the historical floor is applicable to this fresh baseline.                                                |
| Coverage        | Mean per-case coverage was `0.803193`, versus the documented provisional `0.86926` floor; source-specific coverage also varied.                                                                                            | Determine whether relevant-set size, top-k limits, cross-source alternatives, duplicate suppression, or retrieval behavior explains incomplete coverage. A passing case may return a relevant document from another source. |
| Language labels | Aggregate inspection found declared-source/stored-label differences, including 20/20 Nepali-source documents labelled `hi`, 14/14 Tigrinya-source documents labelled `am`, and 47/52 Malay-source documents labelled `id`. | Validate actual document language, golden-case language, and filter eligibility before calling a label incorrect or proposing changes. Source declarations alone do not establish document language.                        |

All 21 complete misses were in translated multilingual cases. This is a useful
investigation lead, not proof that language metadata explains every miss.
The corpus reported 77,160 embeddings under `qwen/qwen3-embedding-8b`, matching
the evaluation model identity; that alone does not prove semantic equivalence.

## Operator Decision — September 8, 2026

The operator agreed that recording these three concerns here is sufficient to
proceed with the bounded new-source acquisition/ingestion proof in feat-435.
Resolving this ticket or implementing fixes is not a prerequisite. `blocks` is
intentionally empty, and feat-435 must not depend on this investigation.

The previous quality-based no-go in the September 7 baseline assessment is
superseded by this acceptance. Preserve the original measurements and historical
assessment; do not lower thresholds, claim a passing comparison, or describe the
concerns as confirmed defects merely to justify proceeding. Existing production
target and operation safeguards still apply.

This PR captures deferred work and the decision to proceed. The investigation
itself remains not started; feat-435 and issue #168 remain incomplete.

## Entry Points — Read These First

1. [Forge PR #2186](https://github.com/JesusFilm/forge/pull/2186) — baseline evidence PR; receipt path `docs/roadmap/rag/evidence/feat-435/production-eval-baseline.json` (in that PR until merged), run `9c1f2e8c-4e9e-44e6-b034-802a6e27eb61`, completed `2026-09-07T06:27:04.372Z`.
2. `apps/rag/docs/ops/evaluation.md`, `apps/rag/scripts/eval.ts`, and `apps/rag/scripts/lib/evaluation/identity.ts` — case selection, run identity, and comparison prerequisites. The recorded run uses `control-2026-08-06`, excluding the nine newer cases.
3. `apps/rag/scripts/lib/evaluation/metrics.ts` — `CaseResult`, `computeMetrics`, `coverageBySource`, and `caseLanguage`; distinguish any-relevant-document recall from mean coverage and source-specific metrics.
4. `apps/rag/src/retrieval/retrieve.ts` and `apps/rag/src/adapters/postgres/` — language/model eligibility, candidate selection, and deduplication.
5. `apps/rag/src/indexing/decide-language.ts`, `apps/rag/src/indexing/resolve-language.ts`, `apps/rag/docs/source-status.yaml`, and `apps/rag/docs/decisions/0008-language-label-lifecycle.md` — stored versus declared language and the documented Tigrinya detector limitation.
6. `apps/rag/docs/ops/readonly-database.md` and `apps/rag/docs/ops/corpus-maintenance.md` — read-only investigation and any later, explicitly scoped remediation workflow.

## Grep These

- `firstRelevantRank`
- `relevantReturned`
- `coverageBySource`
- `caseLanguage`
- `documents.language`
- `everystudent-ne`
- `everystudent-ti`
- `everystudent-ms`

## What To Build

- Investigate each concern independently using the retained case IDs, ranks,
  aggregate counts, and documented metric semantics. Start with read-only
  eligibility checks before attributing misses to ranking or model behavior.
- Record each outcome as confirmed concern, not substantiated, or unresolved,
  with supporting redacted evidence and a bounded explanation of uncertainty.
- For validated concerns, propose the smallest justified fix, affected scope,
  verification, and production requirements. A justified no-change outcome is
  acceptable; do not prescribe blanket language relabelling or reindexing.
- Keep this investigation separate from the new-source proof. Preserve the
  accepted baseline and clearly identify corpus/case/configuration differences
  in later runs; never force mismatched runs through `eval:compare`.

## Constraints

- This is an investigation ticket, not a declaration of defects or a requirement
  to restore historical aggregate numbers whose comparison identity is absent.
- Do not reconstruct missing historical evidence or infer that matching row
  counts prove an unchanged corpus.
- Validate document-language hypotheses before proposing metadata writes.
  Production remediation follows its separately scoped maintenance authority.
- Durable evidence contains only safe IDs, ranks, counts, metrics, model identity,
  timestamps, identity hashes, and redacted commands; exclude secrets, connection
  details, questions, retrieved text, URLs, embeddings, prompts, and corpus content.
- Do not make resolution of these accepted concerns a gate for acquisition or
  ingestion, or conflate that acceptance with soak/retirement completion.

## Verification

- All three concerns have an explicit evidence-backed disposition; unknowns
  remain labelled as such. Potential fixes follow validated findings.
- A language-label finding distinguishes source declarations, stored metadata,
  actual language evidence, and retrieval filter behavior.
- Any rerun uses `apps/rag/docs/ops/evaluation.md`; only genuinely compatible
  identities receive a regression comparison. No threshold or golden-case
  edits are made solely to obtain a pass.
- Add redacted findings under `docs/roadmap/rag/evidence/feat-463/` and a
  `## Resolution` with the investigation PR link when that work is finished.
- For this documentation scope, run formatting, hidden-roadmap-lane validation,
  and frontmatter/link/count checks; no production access is needed.
