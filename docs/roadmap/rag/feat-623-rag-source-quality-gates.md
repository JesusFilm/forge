---
id: "feat-623"
title: "Define repeatable source and retrieval quality gates"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-10-08"
duration: 5
depends_on: []
blocks: ["feat-622"]
tags: ["rag", "strategy", "documentation"]
---

## Problem

A source expansion needs evidence of useful retrieval, accurate attribution and
safe follow-up without turning accepted historical limitations into new blockers.

## Entry Points — Read These First

1. `apps/rag/docs/eval-approach.md` and `apps/rag/docs/ops/evaluation.md`.
2. `apps/rag/scripts/lib/evaluation/identity.ts` — compatible comparisons.
3. `docs/roadmap/rag/feat-463-rag-baseline-concerns-investigation.md` and
   `feat-467-gotquestions-icelandic-negative-retrieval.md` — existing investigations.
4. `apps/rag/src/retrieval/retrieve.ts` — mechanism versus consumer policy.

## Grep These

`recall`, `coverage`, `caseLanguage`, `minimumScore`, `identity`.

## What To Build

Define a versioned pilot checklist and evaluation pack covering extraction quality,
duplicates, language labels, provenance/citations, source-scope isolation,
positive queries, off-topic negatives, harmful/misleading material and missing
answers. Review whole-document relevance separately from doctrinal/editorial
suitability; consumer audience weighting remains consumer-owned.

Before a run, name the reviewer, corpus/case/model/configuration identities,
metrics and acceptance thresholds: recall/rank, coverage, false positives,
attribution, language correctness and latency/cost. Select numeric thresholds
with the owner for the specific pilot, rather than inventing universal floors.
No unresolved rights violation, scope leak or misattribution may be promoted.
Record other failures and explicit accepted limitations; never tune expectations
only to pass. Pair new-source probes with existing-corpus regression cases.

Route baseline questions to feat-463 and Icelandic negatives to feat-467 without
duplicating their investigations or gating this checklist on their completion.
Create linked remediation tickets for confirmed defects with reproducible safe IDs.

## Constraints

Preserve the separate RAG service/database and consumer-neutral retrieval contract.
This roadmap authorizes no source import, production mutation, credential handling,
deployment or purchase. Future execution needs its own bounded scope and authority.
Dates and durations are planning placeholders, not delivery commitments.

## Verification

A synthetic/local rehearsal demonstrates positive, negative, wrong-language,
wrong-source, duplicate, missing-citation and harmful-content cases. Incompatible
identities are reported without a regression claim. A candidate fails promotion
when a mandatory check fails or the threshold/reviewer is missing. Receipts hold
IDs, counts and metrics only; query/corpus text stays outside durable evidence.
