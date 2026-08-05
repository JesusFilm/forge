---
title: "Kill-switch completeness follows data lifetime — a flag that gates production does not gate replay of what it already produced"
date: "2026-08-05"
category: "architecture-patterns"
module: "apps/mastra (src/mastra/ai-chat-history-route.ts, src/mastra/agents/seeker-agent.ts, src/config/env.ts) — the SEEKER_VIDEO_ENABLED flag across feat-327 (send) and feat-329 (replay)"
problem_type: "architecture_pattern"
component: "service_object"
severity: "medium"
related_components:
  - "apps/mastra/src/mastra/ai-chat-history-route.ts"
  - "apps/mastra/src/mastra/agents/seeker-agent.ts"
  - "apps/mastra/src/config/env.ts"
  - "apps/mastra/src/mastra/agents/seeker-route.ts"
applies_when:
  - "Adding a READ or REPLAY path over output a feature flag previously gated only at write time"
  - "A flag's inertness depends on a mechanism (unregistered tools, an unmounted component) rather than on an explicit check"
  - "Deciding what a rollback of a persisted-output feature actually retracts"
  - "Documenting the levers an operator has during an incident involving already-stored content"
tags:
  - "kill-switch"
  - "feature-flag"
  - "rollback"
  - "replay"
  - "data-lifetime"
  - "mastra"
---

# Kill-switch completeness follows data lifetime

## Context

`SEEKER_VIDEO_ENABLED` gates the Seeker agent's ability to feature a video in a
chat turn. With the flag off, feat-327's send path is **byte-identical** to its
pre-feature self **in resolved prompt, resolved tool set, and per-turn
behavior** — one measured exception, the global tool-registry footprint — and
the reason is worth stating precisely: the flag
unregisters the `searchVideos` / `featureVideo` tools, so the route has **no
chunks to resolve**. The route itself reads no flag. Inertness is a
_consequence of the mechanism_, not an explicit check — and that is exactly what
does not survive being copied to a second path.

feat-329 added a **replay** path that re-derives the same attachment from tool
parts already persisted in the store. Those chunks do not disappear when the
tools are unregistered. So the same flag that makes the send path inert leaves
the replay path fully functional: flipping it off stops new videos and leaves
every already-stored one rendering on reload.

## Guidance

**A kill switch reaches only as far as the data it governs is short-lived.**
The moment a feature's output outlives the request that produced it, the flag
governs _production_, not _presence_ — and any path that reads persisted output
must have its flag posture **re-derived**, never inherited.

Ask three questions when adding a read path over flagged output:

1. **Why is the flag inert on the existing path?** If the answer is a mechanism
   (unregistered tools, an unmounted component, an absent client) rather than an
   explicit conditional, that mechanism almost certainly does not exist on the
   new path.
2. **What does the operator actually get when they flip it?** Write the answer
   down as levers, not intent — "stops new X, leaves stored X rendering" is a
   different operational promise from "turns X off."
3. **Which incident classes need the stored output to stop rendering?** Bad
   catalog data, a dead-link class, or a takedown request all demand visual
   retraction; a cost or quality rollback does not. That distinction decides
   whether the read path needs its own gate.

## The decision this repo made (2026-08-05, PR #1836)

Ruled and settled, so it can be cited rather than re-litigated:

- **The replay path is NOT gated on `SEEKER_VIDEO_ENABLED`.** The
  documented-partial semantics are accepted. No `getVideoEnabled` seam was
  built on the replay route.
- **The levers that do exist**, in escalation order: `SEEKER_VIDEO_ENABLED=false`
  stops new declarations; `SEEKER_ROUTE_ENABLED=false` retracts everything by
  darkening the whole ai-chat lane (sends **and** history); purging the affected
  threads removes the stored rows (the per-resource deletion runbook lives in
  `apps/mastra/CLAUDE.md`).
- **Named revisit triggers:** widening the audience beyond the dogfood roster
  (the feat-236 era), or any incident class that requires visual retraction of
  already-featured videos.
- **Cited sources were never gated by this flag on any path** — the asymmetry is
  deliberate, not an oversight, and matters when reasoning about what a video
  rollback does and does not touch.

## Why this matters

The failure this prevents is not a bug in code; it is a **wrong belief held by
an operator during an incident**. A rollback runbook that says "set the flag to
false to restore pre-feature behavior" is a promise. If the read path keeps
serving, the operator flips the flag, sees the feature still on a reopened
thread, and does not know whether the deploy landed, whether they used the wrong
variable, or whether something worse is happening — at exactly the moment that
uncertainty is most expensive.

The prose fix was therefore treated as load-bearing, not cosmetic. The plan's
rollback step previously read "restores byte-identical pre-arc behavior"; it now
reads "for new turns," with a dated amendment naming the real retraction levers,
and `apps/mastra/CLAUDE.md` carries the same statement beside the replay
contract.

## When to apply

Apply on any feature where output is persisted and later re-read: agent
transcripts, generated media, cached recommendations, denormalized summaries.

Do **not** over-apply it into "every flag must gate every read." Historical
fidelity is often the _correct_ behavior — a user reopening a thread generally
should see what they saw. The rule is that the choice must be **made and
written down**, not inherited by accident from a mechanism that only ever
applied to the write path.

## Related learnings

- `docs/solutions/architecture-patterns/fail-closed-enforcement-point-follows-rollback-capability.md`
  — the same family of reasoning one level up: _where_ to enforce follows your
  rollback capability; _what a flag retracts_ follows your data lifetime. Both
  say the flag's meaning is a property of the surrounding system, not of the
  flag.
- `docs/solutions/architecture-patterns/turn-association-when-re-deriving-from-a-message-store.md`
  — the sibling feat-329 learning; re-derivation at read time is precisely what
  created a second path for this flag to fail to cover.
- `docs/solutions/workflow-issues/removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md`
  — the same instinct applied to teardown: write the removal/retraction recipe
  while the map is fresh.
