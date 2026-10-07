---
id: "feat-621"
title: "Publish the RAG strategy and Source Expansion roadmap"
owner: "jaco"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags: ["rag", "strategy", "documentation"]
---

## Problem

October 5 show-and-tell suggestions need a durable path from ideas to reviewed
source pilots, alongside existing migration and consumer work.

## Entry Points — Read These First

1. `docs/roadmap/rag/strategy.md` — workstream map and sequencing.
2. `docs/plans/2026-10-08-j075-rag-strategy.md` — documentation-only execution scope.
3. `docs/reports/2026-10-08-j075-rag-strategy.md` — reconciliation and checks.

## Grep These

`feat-575`, `Source Expansion`, `depends_on`, `blocks`.

## What To Build

Publish the strategy, source initiative and missing follow-ups. Reuse existing
features, repair the feat-575 collision and index, and retain accepted closures.

## Constraints

Preserve the separate RAG service/database and consumer-neutral retrieval contract.
This roadmap authorizes no source import, production mutation, credential handling,
deployment or purchase. Future execution needs its own bounded scope and authority.
Dates and durations are planning placeholders, not delivery commitments.

## Verification

All requested themes map to actionable tickets; new IDs are globally unique;
RAG dependencies are reciprocal and acyclic; counts, local links, hidden-lane
checks and changed-Markdown formatting pass. Deliver a documentation-only draft PR.
The later dependent ce-code-review is outside this job.
