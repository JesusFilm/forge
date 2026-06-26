---
title: "Mastra agent.stream({memory}) auto-creates the thread; low-level memory.recall() throws — so forwarding a client id as threadId is safe"
date: 2026-06-26
category: architecture-patterns
problem_type: architecture_pattern
component: assistant
severity: medium
module: apps/mastra
applies_when: "Wiring any consumer to a memory-keyed Mastra agent and deciding whether a client-supplied (never-server-created) threadId is safe to forward"
related_components:
  - apps/chat
  - apps/admin
tags:
  - mastra
  - memory
  - agent-stream
  - threads
  - library-contract
  - verify-the-wrapper
---

## Context

feat-204 flagged one technical risk to resolve before wiring a chat client to
the Seeker route: does `agent.stream(prompt, { memory: { thread, resource } })`
**throw** when asked to recall a thread that was never created? The chat client
forwards the browser's `crypto.randomUUID()` conversation id as the `threadId`
without ever calling a create-thread API first, so a throw would mean **every
new conversation's first turn errors**.

The seeker memory tests document that the _low-level_ API throws:
`memory.recall()` on a never-created thread throws `"No thread found with id …"`
(it does not return empty) — see `apps/mastra/src/mastra/memory.test.ts`. The
open question was whether `agent.stream`'s higher-level path hits that same throw.

## Guidance

**`agent.stream({ memory })` auto-creates the thread; it does not call the
throwing low-level `recall()`.** In `@mastra/core@1.36.0`, the agent's stream
memory-prep path does, in effect:

```text
existingThread = await memory.getThreadById({ threadId })
if (existingThread) { use it }
else { memory.createThread({ threadId, resourceId, saveThread: true }) }  // auto-create
```

The thread is created _before_ messages are added or recall runs. So:

- **Forwarding a client-generated `conversationId` as `threadId` is safe** — the
  first turn on a fresh thread creates it, it does not throw.
- **Multi-turn recall works** — the same `threadId` recalls earlier turns.
- **A mid-conversation upstream restart degrades gracefully** — if the store is
  dropped (in-memory store, redeploy), the next turn re-creates the thread (loses
  prior recall, no crash).
- The memory-configured agent still requires a `resource`; the route always
  supplies one (caller's `resourceId` else a constant default), because a
  memory-configured agent throws `AGENT_MEMORY_MISSING_RESOURCE_ID` when a
  `threadId` arrives without a resource.

Verified **live** this session: a first turn on a brand-new conversation id
answered without error; a follow-up referencing it ("when was it first
released?") correctly recalled the prior turn's subject.

## Why This Matters

The generalizable lesson: **do not assume a low-level API's failure mode applies
to the high-level API that wraps it.** The `.d.ts` and the `recall()` test both
point at "throws on uncreated thread," which reads as a hard blocker — but the
`stream()` path guards with `getThreadById → createThread` and never reaches the
throw. Reading the wrapper's actual code path (or running it live) is what
distinguishes a real constraint from a phantom one. Designing around the phantom
here would have meant building thread-creation ownership into the chat proxy for
no reason.

## When to Apply

Any time a consumer wires to a memory-keyed Mastra agent and must decide whether
a client-supplied or never-server-created `threadId` is safe to pass.

**This is undocumented internal behavior, not a public API contract — so semver
does not protect it.** A minor or patch bump can change the `getThreadById →
createThread` guard just as easily as a major one (verified at 1.36.0). Do not
gate re-verification on a major bump only. The durable guard is a regression
test, not vigilance: add a thin live/integration test (the recipe in Examples —
first turn on a never-created thread id must not throw) so any dependency bump
that breaks the auto-create path fails loudly in CI instead of silently erroring
every new conversation's first turn in production.

## Examples

- apps/chat forwards `Conversation.id` (a `crypto.randomUUID`) straight through
  the proxy as the Seeker `threadId`, with no create step — relying on this
  contract. See
  `docs/solutions/architecture-patterns/browser-sse-proxy-to-bearer-gated-internal-sse-20260626.md`.
- The cheap verification when source inspection is ambiguous: run it. Create a
  thread by id, send one turn (must not throw), send a second referencing the
  first (must recall), then restart the store and send a third (must re-create,
  not throw).
