---
id: "feat-205"
title: "Wire chat app to the Seeker Mastra route"
owner: "jian wei"
priority: "P1"
status: "not-started"
start_date: "2026-06-27"
duration: 3
depends_on:
  - "feat-204"
blocks: []
tags:
  - "web"
  - "ai-pipeline"
---

> **Thin stub — not yet investigated.** This ticket needs its own brainstorm/plan
> before implementation. It exists to capture the follow-on to feat-204 and the
> consuming-app responsibilities surfaced during that brainstorm so they aren't
> lost. Read
> `docs/brainstorms/2026-06-24-expose-seeker-agent-mastra-route-requirements.md`
> (especially its Scope Boundaries) first.

## Problem

feat-204 exposes `seekerAgent` over an internal, bearer-gated SSE route
(`POST /forge-seeker`). The chat app (`apps/chat`) still talks only to its stub
agent. This wires `apps/chat` to call the Seeker route so devs/product can
dogfood Seeker end-to-end — internally, behind a feature flag, without crossing
the production release gates.

## What this work must get right (carried over from the feat-204 brainstorm)

These are load-bearing, not optional polish:

1. **Server-side bearer / proxy.** The chat backend holds `MASTRA_SERVICE_API_KEYS`
   and proxies browser requests to `/forge-seeker`. The service bearer must never
   reach the browser. (Mirrors how admin proxies `/forge-experience-chat`.)
2. **Server-minted, ownership-checked `threadId`.** Generate the `threadId`
   server-side (e.g. a UUID at "new conversation", bound to the user/session,
   ownership re-checked on reuse). Do **not** forward browser-supplied
   `threadId`s — otherwise a user can supply or enumerate another session's
   `threadId` and read its conversation (the route treats `threadId` opaquely and
   cannot prevent this).
3. **Default-off feature flag gating Seeker vs. the stub agent.** This is the
   enforcement point for the crisis-gate boundary — Seeker must be reachable only
   by allowlisted dev/product users until the safety/crisis guardrails ship. Not
   cosmetic: it is what keeps vulnerable users away from an unguarded agent.
4. **Optional `resourceId`.** May be omitted pre-auth; pass the authenticated
   user id here once chat auth lands (no route-side change needed).

## Constraints

- Internal dogfooding only — do not widen Seeker's audience beyond the gated
  allowlist until the guardrail release gate is met.
- Do not relocate any Mastra-side responsibility here; this ticket is purely the
  chat-side consumer.

## Verification

- To be defined in this ticket's own brainstorm/plan.
