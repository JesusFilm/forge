---
title: "Turn association when re-deriving per-turn data from a message store — the store decides how a turn is split, and your boundary must not trust the projection"
date: "2026-08-05"
category: "architecture-patterns"
module: "apps/mastra (src/mastra/ai-chat-history-route.ts, src/mastra/agents/seeker-turn-projection.ts) + apps/chat (src/lib/history-client.ts) — feat-329 chat replay persistence"
problem_type: "architecture_pattern"
component: "service_object"
severity: "high"
related_components:
  - "apps/mastra/src/mastra/ai-chat-history-route.ts"
  - "apps/mastra/src/mastra/agents/seeker-turn-projection.ts"
  - "apps/mastra/src/mastra/ai-chat-history-replay-attachments.test.ts"
  - "apps/mastra/src/mastra/ai-chat-history-route.test.ts"
  - "apps/chat/src/lib/history-client.ts"
applies_when:
  - "Re-deriving per-TURN data (attachments, citations, tool output) at read time from rows a message store persisted, rather than persisting a compact record at write time"
  - "The store may split one logical turn across several message rows, and the client drops some of them"
  - "A projection can REJECT a row, and downstream logic keys off the projected shape rather than the stored one"
  - "A real-store round-trip test exists and is being treated as strictly stronger evidence than its mocked siblings"
tags:
  - "message-store"
  - "turn-association"
  - "replay"
  - "projection"
  - "mastra"
  - "mocked-vs-real"
  - "attribution"
---

# Turn association when re-deriving per-turn data from a message store

## Context

feat-329 made the chat app's featured video and cited sources survive a thread
reload. The design choice was to **re-derive** them at replay time from the tool
parts the store already persisted, rather than writing a compact record at send
time.

That choice is usually the right one — it needs no new write path and no
migration for threads that already exist. But it moves one decision out of your
code and into the store: **which row of a turn holds what**. Three problems came
out of that: the first was a hazard the plan designed against up front, and the
other two were real bugs review had to catch.

## Guidance

### 1. Define the turn, then attach to the turn — never per row

The store **may** put a turn's tool parts on their own **tool-only assistant
message** carrying no text, and the replay client drops empty-text messages
(they would render as an empty bubble). So attaching per row loses the
attachment on exactly the turns that have one.

State the epistemic status honestly, because it is easy to over-read: the split
is a **defensive assumption inherited from the plan, not an observed fact**. The
one real round trip this arc ran (`memory` backend, @mastra/core 1.55.0 /
@mastra/memory 1.24.0, 2026-08-04) put the whole turn — tool parts _and_ reply
text — on ONE message. Designing for the split costs nothing and fails safe;
assuming it away would silently drop attachments the day a version starts
splitting.

Pool a turn's chunks and attach to the turn's **last text-bearing assistant
message**:

```ts
// A turn = the run of assistant rows since the last non-assistant row.
// Pool every chunk in the run; attach to the run's last text-bearing message.
// A run with no text-bearing message drops its attachments — nothing the user
// sees can carry them.
```

### 2. The turn BOUNDARY must not trust the projection either

The subtler half. Boundary detection originally read the **projected** role:

```ts
if (entries[i].message?.role === "user") {
  closeRun(i)
  runStart = i + 1
}
```

`projectStoredMessage` returns `null` for a malformed row (missing/empty id, or
a role outside `user|assistant`). A rejected user row is therefore `null` here,
the boundary never fires, two turns merge, and **turn N's video and citations
land on turn N+1's answer** — a message that never produced them.

Reading the stored role fixes that row, but the first fix was still wrong in a
way worth recording: it closed only on the literal `"user"`.

```ts
if (entries[i].storedRole === "user") { … }   // still too narrow
```

That allowlists **one** value out of a role space that also holds
`system` and `signal` (both fixture-covered and known to come back from the
store) — plus, in principle, `tool` — and rows whose role is corrupt, absent, or
non-string. Every other value silently merged two turns. Close on the
complement instead:

```ts
if (entries[i].storedRole !== "assistant") {
  closeRun(i)
  runStart = i + 1
}
```

**A run continues only across stored-assistant rows.** This fails in the safe
direction: a turn that loses its carrier **drops** its attachment instead of
misattributing it. For a surface that renders citations, misattribution is the
worse failure — a replayed ungrounded answer rendering someone else's sources is
a correctness claim about provenance, not a cosmetic glitch.

Stated as a rule: **when a boundary predicate selects rows out of an
open-ended, externally-owned vocabulary, write it as "continue only on the
value I understand," not "break only on the values I listed."**

### 3. A rejected row must not take its chunks with it

A row the projection drops may still be the turn's only copy of the attachment.
Keep rejected rows in the list (as `null`) so their chunks still pool, and drop
them from the output at the end — but only for rows that stay _inside_ a run.
Under rule 2 a non-assistant row closes the run, so its chunks are donated to no
turn at all, which is also correct: a `system` row carrying tool parts must not
attach a video to an adjacent answer that never called a tool.

### 4. Re-derivation multiplies every side effect by history length

A write path logs once per event. A read path that re-derives over history runs
that same code **once per stored turn, on every read** — so a per-event side
effect becomes a burst the first time someone opens an old thread.

Two moves, one per side of the wire:

- **Move logging out of the shared projection.** The module RETURNS its
  rejection reason; each caller decides. The live path emits the operator line
  once per turn; the replay path stays silent, because the same rejection was
  already logged when the turn ran and re-emitting it is stale history.
- **Give the read path an aggregating sink.** The client-side projection takes
  its reject callback as a parameter and the replay caller collapses the whole
  thread into ONE line, counts only, reasons sorted.

This generalizes past logging to anything a re-derivation can accidentally
multiply: metrics, traces, audit events, rate-limit counters, cache warms.

## Why this matters — the inverted mocked-vs-real facet

This is the part that generalizes furthest, and it inverts the usual reading of
`mocked-shape-vs-real-contract-discipline-20260506.md`.

The repo's standing rule is that mocked tests prove BRANCH SHAPE while real
fixtures prove PRODUCTION CONTRACT — so the real fixture is normally the
stronger evidence. Here it is the **weaker** one for the rule that matters most:

- The real-memory round trip pins the stored part shape non-vacuously.
  Falsified by pointing the adapter at `"tool-result"` — the smoke went red.
- But that store puts a whole turn on **one message**, so the smoke **cannot
  distinguish** "attach to this message" from "attach to the turn's last
  text-bearing message." Falsifying the last-text-bearing rule leaves it
  **green** while the mocked split-message fixture goes red.

So the real-contract test must be **labelled in place with what it cannot
prove**, or a future reader will over-read its green. The labels this produced:

```ts
 * TWO SCOPE LIMITS, stated so nobody reads more into this than it proves:
 * 1. This store put the whole turn on ONE assistant message, so the carrier
 *    assertions below CANNOT discriminate "attach to the turn's last
 *    text-bearing message" from "attach to this message" …
 * 2. The backend here is the `memory` InMemoryStore, NOT the `postgres`
 *    backend production runs …
```

**The generalization:** a real-fixture test is only stronger than its mocked
sibling _on the dimensions the real substrate actually varies_. When the real
substrate happens to collapse a dimension — one message per turn, one backend,
one ordering — the mocked fixture is the only coverage of it, and the real
test's green is silent about it. Write that down at the test, not in a review
comment.

## When to apply

Reach for this whenever read-time re-derivation replaces a write-time record:
replaying chat/agent transcripts, rebuilding per-request summaries from event
rows, or projecting anything grouped from a store you do not control.

Do **not** reach for it when the producer can cheaply persist the derived record
at write time — that keeps grouping in code you own, and the plan's own named
fallback for feat-329 was exactly that. The re-derivation path was chosen here
because it needed no migration for existing threads; that convenience is what
buys the three problems above.

## Prevention

- Verify the store's split behavior **before** designing around it — and record
  what you actually saw, **including "it did not split."** feat-329's pre-work
  gate drove a real turn through a real `Memory` and inspected `recall` output:
  it found one message per turn, which is precisely why the split case is
  covered _only_ by a mocked fixture and why that limit is labelled at the real
  test. The same gate surfaced that a tool whose `execute` throws persists its
  error message as a plain **string** result — a production shape the projection
  must tolerate.
- Give the boundary predicate its own fixture per role class, including
  `system`/`signal` and an unreadable role — not just the happy shape.
- Falsify the boundary rule and confirm which suite goes red. If the real-store
  suite stays green, that is not reassurance; it is the scope limit, and it
  belongs in the test's docstring.

## Related learnings

- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — the META home. This entry is the inverted case: the real fixture is weaker
  than the mocked one on the dimension the real substrate collapses.
- `docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md`
  — the same feature's byte-budget corollary; re-derivation is what put
  unbounded upstream strings on a capped wire in the first place.
- `docs/solutions/architecture-patterns/kill-switch-completeness-follows-data-lifetime.md`
  — the other feat-329 learning: a read path over persisted output does not
  inherit the write path's flag posture.
