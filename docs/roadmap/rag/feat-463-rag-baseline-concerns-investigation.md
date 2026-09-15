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

### 1. Recall: 21 cases found no relevant document

Recall@10 was **94.95% (395/416)** against the documented provisional **98%**
floor. Of all cases, 290 first matched at rank 1, 381 within the top 3, and
14 first matched at ranks 4–10. All 21 complete misses were translated
multilingual cases; the language/source breakdown appears below.

**Investigation task:** account for each miss by checking whether its expected
relevant documents exist, have embeddings, pass the case's language filter,
and reach the top 10 above the score floor. Separate excluded documents from
ranking misses and incorrect golden expectations. The Russian case
`esru-newcomer-krest` is a useful separate check: all 95 documents in its source
were labelled Russian, so a source-wide language mismatch does not explain it.
Record a specific cause and potential correction for each validated concern.

### 2. Coverage: relevant documents are not consistently represented

Mean per-case coverage was **80.32%**, against the provisional **86.93%** floor.
259 cases returned their entire relevant set, 136 returned only part, and
21 returned none. English found at least one relevant document in all 78 cases,
but its mean coverage was only **52.67%**. Global recall can therefore look good
while relevant documents from particular sources are absent.

These source-level diagnostics count only cases where that source has a golden
relevant document. Cases can appear in multiple rows. Source recall means at
least one relevant document from that source appeared; coverage is the average
fraction of that source's relevant set returned.

| Source key           | Cases | Source recall@10 | Source coverage |
| -------------------- | ----: | ---------------: | --------------: |
| `starting-with-god`  |    24 |           37.50% |          27.78% |
| `everystudent`       |    22 |           54.55% |          46.59% |
| `jesusfilm-org`      |    30 |           56.67% |          44.61% |
| `sightline-ministry` |    46 |           65.22% |          38.44% |
| `cru`                |    36 |           75.00% |          47.31% |

**Investigation task:** start with these five sources and the partially covered
cases. Check whether top-k=10, relevant-set size, cross-source alternatives,
duplicate suppression, filtering, or ranking explains the missing documents.
Determine whether a retrieval change or a reviewed expectation change is
justified; do not assume every absent relevant document represents a defect.

### 3. Language labels: stored metadata can exclude expected documents

The September 7 read-only review observed the following distributions. The
source keys below use the `everystudent-` prefix, followed by the shown suffix.
Miss counts are from the 416-case evaluation, not counts of missing documents.

| Source language (suffix) | Documents under a different stored label | Documents under the declared label | Evaluation misses / cases |
| ------------------------ | ---------------------------------------- | ---------------------------------: | ------------------------: |
| Nepali (`ne`)            | 20/20 labelled Hindi (`hi`)              |                                  0 |                       4/4 |
| Tigrinya (`ti`)          | 14/14 labelled Amharic (`am`)            |                                  0 |                       4/4 |
| Malay (`ms`)             | 47/52 labelled Indonesian (`id`)         |                                  5 |                       5/6 |
| Croatian (`hr`)          | 30/41 labelled Serbian (`sr`)            |                                 11 |                       2/5 |
| Albanian (`sq`)          | 37/76 labelled Dutch (`nl`)              |                                 39 |                      2/10 |
| Persian (`fa`)           | 26/75 labelled Arabic (`ar`)             |                                 49 |                      2/10 |
| Slovenian (`sl`)         | 6/23 labelled Serbian (`sr`)             |                                 17 |                       1/4 |
| Russian (`ru`)           | 0/95 under a different label             |                                 95 |                      1/10 |

The evaluation filters on the case's expected language. No documents anywhere
in the inspected corpus were labelled `ne` or `ti`, so those filtered searches
had no eligible documents. Other rows suggest similar exclusion risks, but
aggregate counts alone do not establish the cause of each missed case or the
actual language of a document. The existing Tigrinya source note already warns
that tinyld lacks a Tigrinya model and can classify its script as Amharic.

**Investigation task:** verify actual document language and expected-case
language for the affected records. Where a stored label is confirmed wrong,
propose a scoped metadata correction and address the detector/decision behavior
that would reproduce it on future ingestion. Where the stored label is correct,
investigate the source declaration or golden expectation instead. Do not blindly
replace document labels with the source's declared language.

The affected source documents and their embeddings exist. Corpus-wide inspection
reported 77,160 embeddings under `qwen/qwen3-embedding-8b`, matching the evaluation
model identity. This rules out a mixed stored-model-ID explanation in that
inspection, but does not prove semantic quality or that every expected golden
document was present. All observations above describe September 7, not a new
production check made when this ticket was written.

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
