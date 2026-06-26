---
id: "feat-207"
title: "Chat app authentication"
owner: "jian wei"
priority: "P1"
status: "not-started"
start_date: "2026-07-07"
duration: 5
depends_on:
  - "feat-205"
blocks:
  - "feat-209"
tags:
  - "web"
  - "infrastructure"
---

> **Thin stub — not yet investigated.** Needs its own brainstorm/plan before
> implementation. It captures the auth follow-on surfaced during the feat-205
> brainstorm. Read
> `docs/brainstorms/2026-06-25-chat-wire-seeker-route-requirements.md`
> (Key Decisions, Dependencies / Assumptions, Scope Boundaries) first.

## Problem

`apps/chat` has no auth (Intentionally Absent). feat-205 ships Seeker wiring whose
v1 safety boundary is only URL obscurity + a small trusted audience — not an
access gate — and whose `threadId` is the browser's `Conversation.id` forwarded
verbatim (a conscious relaxation safe only while the deployment is non-public and
has no per-conversation URL). Auth is the gate that lets the chat app widen its
audience and harden Seeker access.

## What this unlocks (carried over from the feat-205 brainstorm)

- A real **inbound access gate** on the chat backend (the feat-205 R5 prerequisite
  before any public reachability), replacing obscurity-as-boundary.
- **`resourceId = userId`**, which makes Mastra's thread-owner check fire — turning
  the inert v1 isolation into genuine per-user isolation, and letting feat-205's
  throwaway `threadId` be re-plumbed server-minted + user-bound.
- **Per-user feature-flag targeting** (e.g. LaunchDarkly) so Seeker can be enabled
  for specific users rather than the whole deployment.

## Constraints

- Auth must be built on `apps/auth` (the shared auth app), not a chat-local
  implementation.
- Do not relocate Mastra-side responsibility here.

## Verification

- To be defined in this ticket's own brainstorm/plan.
