---
id: "feat-209"
title: "Per-conversation URLs + sidebar history"
owner: "jian wei"
priority: "P2"
status: "blocked"
start_date: "2026-07-15"
duration: 3
depends_on:
  - "feat-207"
  - "feat-208"
blocks: []
tags:
  - "web"
---

> **Thin stub — not yet investigated.** Needs its own brainstorm/plan before
> implementation. It captures the deep-linking follow-on surfaced during the
> feat-205 brainstorm. Read
> `docs/brainstorms/2026-06-25-chat-wire-seeker-route-requirements.md`
> (Scope Boundaries, Dependencies / Assumptions) first.

## Problem

Conversations are client-only and have no URL, so they can't be deep-linked,
restored on refresh, or shared — and there's no sidebar of past conversations like
Claude/ChatGPT/Gemini. A per-conversation URL is only meaningful once there's a
durable store to restore from and an identity to scope conversations to.

## What this unlocks (carried over from the feat-205 brainstorm)

- **Deep-linkable, restorable conversations** (`/c/<id>`-style routing) that survive
  refresh and can be reopened.
- A **sidebar of the signed-in user's past conversations**, read from durable
  per-user threads.

## Constraints

- **Depends on both** feat-207 (auth → `resourceId = userId` so conversations are
  owned and listable per user) and feat-208 (durable threads to restore from). A URL
  without persistence is a link to nothing; a per-user sidebar without auth has no
  owner to scope to.
- Adding a URL that carries the `threadId` before auth would place the memory key in
  a shareable link — this is exactly the feat-205 tripwire, so URLs must not ship
  ahead of auth.

## Verification

- To be defined in this ticket's own brainstorm/plan.
