---
title: "Synchronous-guard double-submit and ref-drift races: code-review false positives"
date: "2026-06-15"
category: best-practices
module: cross-cutting
problem_type: best_practice
component: frontend_stimulus
severity: low
applies_when:
  - "A reviewer flags a double-submit race in a synchronous React handler (RN or web)"
  - "A reviewer flags a ref drifting from the state it mirrors (incl. under StrictMode)"
  - "Running a default-apply code review (e.g. ce-code-review) on a synchronous submit/guard handler"
related_components:
  - apps/chat
  - apps/web
  - apps/mobile
tags:
  - react
  - concurrency
  - code-review
  - false-positive
  - run-to-completion
  - strict-mode
---

## Context

A `/ce-code-review` of a web React handler (`apps/chat`, PR #1276) flagged two
concurrency findings — a "double-submit" race and a "ref drifts from state"
race — that direct verification proved are non-bugs **for today's synchronous
code**. A reliability reviewer rated them P1/P2; reading the actual mechanism
downgraded both to report-only.

These are the same _class_ of false positive as the RN Animated / React-18
unmount findings in
`docs/solutions/best-practices/rn-animated-react18-cleanup-review-false-positives-20260615.md`
— a reviewer matching a pattern to a generic mental model that doesn't hold for
this mechanism — but the mechanism here is **JS event-loop run-to-completion**,
not native-driver lifecycle, so it lives in its own doc. The shared discipline
is "verify the mechanism before applying a leak/cleanup/race finding."

> **These dismissals are time-bound, not permanent.** Run-to-completion safety
> holds only while the guarded body stays synchronous. Per `apps/chat/CLAUDE.md`,
> the canonical example (`use-conversations.ts` `send()`) is slated to flip to
> the **async** case when the real Mastra agent call lands — at which point the
> double-submit race becomes real and the default flips back to Apply. Do not
> cite Rule A's non-bug verdict as a permanent design fact; re-verify each case
> as the feature evolves.

## Guidance

### Rule A — For synchronous double-submit / ref-drift findings: apply the cheap guard; verify the mechanism before calling it a non-bug

> **Operational default, up front:** _apply the guard._ You may downgrade the
> finding's **severity** to report-only once you have verified the mechanism —
> but dismissing a finding as a non-bug requires enumerating every callee in the
> guard→lock span and asserting each is synchronous (no transitive
> `await`/`.then`/`throw`). **If you cannot enumerate them, default to applying
> the finding, not dismissing it** (see the suspension-free-span check below).
> "It looked synchronous" is not enumeration.

When a reviewer flags one of these on a synchronous handler, the default is
**apply the defensive guard and move on** — it is a few lines, it is harmless
today, and it survives the flip to async (below). Do not litigate the mechanism
just to _dismiss_ the finding. Understanding _why_ the race is not live today is
still worth it, because that reasoning is exactly what changes the instant the
body gains an async step — but it is a reason to document, not to skip the guard.

Two recurring false-positives, both explained (not blanket-cleared) by the
"verify the mechanism" discipline:

- **"Two submits both pass the guard before either sets the lock."** When the
  guard-check and the lock-write live in the **same synchronous function body
  with no `await` / `.then` / `yield` between them**, JS run-to-completion
  guarantees the first call finishes — and writes the lock — before the second
  begins. They cannot interleave, so the double-submit window does not exist.
- **"A ref drifts from the state it mirrors (incl. under StrictMode)."** A ref
  whose value is written at **every** site that updates the state it mirrors
  cannot diverge from that state — the two are always written together. (Don't
  hang this on StrictMode's hook-reset internals; they're easy to mis-state —
  StrictMode's simulated remount preserves both `useState` and `useRef`, it does
  not reset them. The robust argument is simply that no writer touches one
  without the other, which is why the real check is enumerating the writers,
  below.)

Both dismissals are **bounded, not blanket**, and the bounds are exactly where
the finding becomes real:

- The run-to-completion guarantee **evaporates the instant the running call
  yields between the guard and the lock-write** — an `await`, a `.then`/Promise
  chain, or any async function call in that span. (A bare `queueMicrotask` does
  _not_ yield the running body, so it is not the trigger — the synchronous body
  still completes first.) **A synchronous `throw` before the lock-write breaks it
  too**: the lock never gets written, so the next caller passes the guard. Wrap
  guard+write in `try/finally`, or write the lock before any fallible call.
  Re-verify the moment the function gains an async step (e.g. when a stub seam is
  swapped for a real network call).
- The no-drift claim holds only for the **current** set of writers; a new code
  path that updates the state but forgets the ref reintroduces the drift.
- These are a list of **specific false-positive classes, not a reachability
  checklist** — they do not clear genuine async interleaving, event-handler
  reentrancy, or concurrent React (`useTransition`/Suspense). To dismiss on the
  run-to-completion ground you must be able to **enumerate every function called
  between the guard and the lock-write and assert each is synchronous** (no
  transitive `await`/`.then`/`throw`) — "I read it and it looked synchronous" is
  not a sufficient rationale. The span you are certifying is _suspension-free_ in
  the JS event-loop sense (no `await`/microtask/yield) — unrelated to React
  **Suspense**. When you cannot enumerate the callees, **default to applying the
  finding** (cross-ref `ce-code-review-tier-2-mandatory-before-push`:
  reliability/correctness at P2+ conf ≥75 biases to Apply) — the cost of a
  shipped concurrency bug exceeds a few defensive lines.

## Why This Matters

These synchronous guarantees are **narrow and shrinking**: run-to-completion
safety is the exception in async UI, and codebases like `apps/chat` are heading
toward streaming and a real agent call. So the cost asymmetry runs the _opposite_
way from the RN Animated / React-18 unmount false positives — a missed
async-interleaving bug is expensive and hard to reproduce in prod, while the
defensive guard is a few lines. That is why these dismissals are bounded and
default to Apply when the suspension-free span can't be enumerated.

## When to Apply

- Reviewing a synchronous React handler (RN or web, e.g. `apps/chat`) where a
  reviewer flags a double-submit window or a ref/state drift under StrictMode —
  confirm the suspension-free span before dismissing.
- Any default-apply code review pass — read the mechanism, not just the pattern.

## Examples

### Synchronous guard + ref-mirror (no race) vs the same after an `await` (race is real)

```tsx
// NO RACE — the guard-check and the lock-write are in one synchronous body with
// no await between them, so call B always sees the key call A wrote; a second
// submit into the same target is a no-op. (apps/chat use-conversations.ts send())
// SAFE ONLY for today's synchronous stub: per apps/chat/CLAUDE.md this exact file
// is slated to flip to the RACE case below when the real (async) Mastra call
// lands. Do NOT cite it as a permanent non-bug.
function send(text: string) {
  const trimmed = text.trim()
  const targetId = activeIdRef.current
  if (!trimmed || timersRef.current.has(targetId)) return // guard (empty-input + per-target lock; timersRef is a Map keyed by conversation id)
  // ...synchronous setState scheduling...
  startTimer(targetId, setTimeout(reply, DELAY)) // lock written before send() returns
}

// RACE IS REAL — an await now sits between the guard and the lock-write, so two
// callers can both pass the guard before either writes. (Same per-target guard
// concept as above — the lock container is irrelevant: the safe example above
// uses a Map, this one a Set, and the race comes purely from the await.)
async function send(text: string) {
  const targetId = activeIdRef.current
  if (inFlight.has(targetId)) return // guard
  await maybeValidate(text) // ← suspension point: the run-to-completion guarantee is gone
  inFlight.add(targetId) // lock written too late — B already passed the guard
}
```

## Related

- `docs/solutions/best-practices/rn-animated-react18-cleanup-review-false-positives-20260615.md`
  — the sibling false-positive class for RN Animated cleanup and React-18
  setState-after-unmount; same "verify the mechanism" discipline, different
  (native-driver / unmount) mechanism.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — the same "verify the mechanism, don't accept the pattern at face value"
  discipline.
