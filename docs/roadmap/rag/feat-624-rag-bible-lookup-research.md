---
id: "feat-624"
title: "Research Bible lookup behavior and licensing"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-10-08"
duration: 5
depends_on: []
blocks: []
tags: ["rag", "strategy", "documentation"]
---

## Problem

Bible reference lookup may need exact passage semantics rather than semantic
retrieval; source suggestions involving Biblica do not settle access or licensing.

## Entry Points — Read These First

1. `packages/rag-contracts/src/retrieval.ts` — current retrieval contract.
2. `apps/rag/docs/architecture.md` — bounded-context ownership.
3. `docs/roadmap/rag/feat-622-rag-source-expansion.md` — rights decision record.

## Grep These

`SearchRequest`, `includeDocument`, `language`, `Biblica`.

## What To Build

Produce a primary-source research matrix for candidate providers/translations:
reference/range parsing, book aliases, versification, language coverage, exact
text/version attribution, API availability, rate limits, cost, caching, storage,
embedding, display/excerpt limits and redistribution terms. Record dated official
terms and unresolved permissions; consult the rights owner for clearance.
Compare direct licensed API lookup, cleared local reference index and remaining
on semantic retrieval. Describe ownership and consumer contract implications.

Recommend a bounded option with synthetic reference examples, error/no-match
behavior and cost bounds. Present material provider, translation, architecture
or purchase decisions to Jaco before an implementation ticket is activated.

## Constraints

Preserve the separate RAG service/database and consumer-neutral retrieval contract.
This roadmap authorizes no source import, production mutation, credential handling,
deployment or purchase. Future execution needs its own bounded scope and authority.
Dates and durations are planning placeholders, not delivery commitments.

## Verification

Every claimed capability/permission links to dated primary evidence or is marked
unknown. Test cases cover aliases, ranges, invalid references, unavailable
translations and versification differences using synthetic fixtures. Deliver a
reviewable decision matrix and explicit go/no-go questions; no provider signup,
text import or licensed-content test is part of this research ticket.
