---
id: "feat-247"
title: "Chat conversation delete"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-09-08"
duration: 2
depends_on:
  - "feat-241"
  - "feat-283"
  - "feat-284"
  - "feat-450"
blocks: []
tags:
  - "web"
  - "ai-pipeline"
---

> **Re-pointed (2026-07-21, Mastra/Seeker architecture-review adjudication):**
> when picked up, this ticket's Mastra route(s) consume the ai-chat lane
> admission module (feat-283) and the thread-ownership read resolver
> (feat-284) instead of mirroring feat-241's hand-rolled read-path patterns —
> the "Expected shape" below predates those modules. Rationale + rulings:
> `docs/handoffs/2026-07-21-mastra-seeker-architecture-review-rulings.md`
> (Sequencing; Rulings 1–2). `depends_on: feat-283, feat-284` added as
> documentation (this lane computes nothing; `blocked` is manual here).

> **Narrowed to delete only (2026-09-02):** rename moved to its own ticket,
> `feat-450` (Chat conversation rename), whose write-route module and proxy
> anatomy this ticket's delete route should join.

## Problem

feat-241 ships view/resume-only server history: signed-in users can list and
continue their persisted Seeker conversations but cannot delete them.
Once history reaches real users (feat-236's public phase), management —
especially deleting a sensitive conversation — becomes expected hygiene.

## Stub — flesh out before starting

Deliberately thin placeholder, not committed work. Brainstorm against this
ticket when it is picked up: hard vs soft delete, confirmation UX, and
interplay with the ai-chat retention purge are all undecided. Expected shape:
ownership-gated write route(s) mirroring feat-241's read-path patterns.
