---
id: "feat-626"
title: "Prepare RAG operational ownership and handover"
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

Migration acceptance and implemented portal features do not establish that a
second operator can handle routine support and source lifecycle work.

## Entry Points — Read These First

1. `docs/roadmap/rag/strategy.md` — workstream ownership and open items.
2. `apps/rag/docs/ops/` — current operator procedures.
3. `docs/roadmap/rag/feat-532-rag-legacy-service-credential-retirement.md` — remaining retirement.
4. `docs/roadmap/rag/feat-610-rag-static-bearer-retirement.md` — completed cutoff and acceptance limits.

## Grep These

`runbook`, `health`, `revocation`, `source`, `retirement`.

## What To Build

Create an operator handover checklist naming primary/backup owners and escalation
routes for consumer support, health, source review, indexing, evaluation, capacity
and rights incidents. Link current runbooks rather than copying commands or secrets.
Include change approval, normal PR deployment, recovery boundaries and evidence
locations; reconcile stale legacy instructions against feat-532/610 dispositions.

Have a second operator perform a local/tabletop consumer incident and source
withdrawal drill from the linked instructions. Record missing access or knowledge
as assigned follow-ups. Maintain an explicit accepted-open-items register so
handover does not falsely close retirement, quality investigations or future pilots.

## Constraints

Preserve the separate RAG service/database and consumer-neutral retrieval contract.
This roadmap authorizes no source import, production mutation, credential handling,
deployment or purchase. Future execution needs its own bounded scope and authority.
Dates and durations are planning placeholders, not delivery commitments.

## Verification

Named owners acknowledge duties; the second operator completes both drills without
unwritten guidance. All operational links resolve, open work has an owner and
next action, and evidence distinguishes simulated checks from live observations.
A pending source pilot or retirement may remain open with an explicit disposition;
this ticket does not reopen historical migration acceptance.
