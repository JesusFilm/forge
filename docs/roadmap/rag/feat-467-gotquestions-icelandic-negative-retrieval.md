---
id: "feat-467"
title: "Investigate the GotQuestions Icelandic off-topic retrieval hit"
owner: "jaco"
priority: "P2"
status: "not-started"
start_date: "2026-09-08"
duration: 1
depends_on: []
blocks: []
tags: ["rag", "evaluation", "retrieval", "i18n"]
---

## Problem

During the local Icelandic slice, two off-topic probes returned no hits, but a
programming probe returned one irrelevant hit above the unchanged 0.37 cutoff.
Both repeats reproduced it. This is a confirmed local false positive, not
evidence of a migration regression. It is retained as a retrieval-quality
limitation of the completed slice in feat-466; this investigation does not block
that local lifecycle closure or expand its authority to production.

## Entry Points — Read These First

- `apps/rag/docs/slices/gotquestions.md` — canonical evaluation and closure.
- `apps/rag/docs/slices/gotquestions.md#limits-and-dispositions` — negative
  checks and repeats; canonical metrics and reviewed keys are in the same record.
- `apps/rag/src/retrieval/retrieve.ts` — query policy and cutoff.
- `apps/rag/scripts/lib/evaluation/identity.ts` — comparison identity.
- `docs/roadmap/rag/feat-463-rag-baseline-concerns-investigation.md` — separate
  production baseline concerns and missing historical comparison.

## Grep These

- `programming`, `negatives`, `minimumScore`, `minScore`, `gq-is-`

## What To Build

Reproduce and explain the false positive with read-only local queries. Review
the returned whole document and compare a small set of Icelandic off-topic
paraphrases, keeping query text and retrieved content outside durable receipts.
Decide whether retrieval needs a bounded correction or whether consumer intent
policy should handle this class of request. Preserve the existing six canonical
cases, including their expanded relevant sets and partial-coverage observations.

## Constraints

Do not raise a cutoff or remove relevant documents solely to obtain a passing
result. Any proposed retrieval change needs evidence of its effect on relevant
Icelandic queries as well as negatives. Do not infer a regression from a run with
different cases, corpus, or configuration. No production operation is included.

## Verification

Record an evidence-backed cause or explicit remaining uncertainty, the chosen
disposition, and aggregate negative/positive results. Run scope-appropriate tests
if implementation changes. Add a Resolution with the investigation PR link.
