---
title: "Lifecycle protection keyed to a transient marker dies with the marker — key to durable identity instead"
date: "2026-08-19"
category: design-patterns
module: apps/chat
problem_type: design_pattern
component: service_object
severity: high
applies_when:
  - "A guard or protection condition is implemented by checking membership in a transient bookkeeping marker (a Set, a flag) rather than the durable identity of the thing being protected"
  - "A separate, later-firing lifecycle rule legitimately clears that same marker as part of its own normal operation, not as an error path"
  - 'Two settled lifecycle rules are implemented against ONE shared piece of state, and a design doc or plan promises a property (e.g. "cached, cannot repeat") that depends on both rules holding at once'
  - "Writing or reviewing tests for a stateful client store (session, cache, adoption list) where every existing fixture exercises each lifecycle rule in isolation rather than in sequence"
  - "Deciding whether dropping a record from a collection also needs to preserve a smaller sentinel/tombstone recording its terminal outcome"
tags:
  - lifecycle-protection
  - transient-marker
  - durable-identity
  - state-management
  - deep-link
  - shared-state-invariant
  - replay
  - apps-chat
related_components:
  - apps/chat/src/lib/conversation-session.ts
  - apps/chat/src/lib/conversation-session.adopt.test.ts
  - docs/plans/2026-08-18-2122-feat-chat-per-conversation-urls-plan.md
---

# Key a lifecycle protection to the durable identity, not to the marker another rule clears

## Context

`apps/chat/src/lib/conversation-session.ts` is the framework-agnostic conversation store
(feat-281): one `createConversationSession(deps)` owning every conversation machine behind a
`subscribe`/`getSnapshot` surface, with no React imports. feat-209 (per-conversation `/c/<id>`
URLs) taught it **deep-link adoption** — construction can seed a server thread id
(`deps.initialConversationId`), and `adoptConversation(id)` adopts an id at runtime, which is what
the popstate handler in `apps/chat/src/lib/use-conversation-url.ts:96-101` calls on every Back/Forward step.

An adopted row is a bare server-origin placeholder — `seedAdoptedConversation`
(`conversation-session.ts:206-215`) mints `{ id, title: "", messages: [], origin: "server",
serverPersisted: true, replay: "idle" }` — and the session tracks which ids are adopted in a
session-internal `adoptedIds` Set (`:320-324`), never as a `Conversation` field.

The plan's KTD3 (`docs/plans/2026-08-18-2122-feat-chat-per-conversation-urls-plan.md:97`) settled
three lifecycle rules over that marker:

1. `revertToClientOnly()` (feat-241's silent mid-session access-denial revert, which deletes
   message-less server rows) **exempts** adopted rows and flips them to replay `"not_available"`
   instead — "a mid-flight access denial on a deep link resolves to the unavailable state, never a
   silently vacated pane."
2. A **deselected** adopted row whose replay resolved `"not_available"` is **dropped** from the
   list — it was never proven part of the user's history, and feat-247 offers no delete affordance
   to clear it.
3. The marker **clears** when a hydration page lists the id (`:550-553`) — a listed row is proven
   history, so it becomes a permanent row.

All three rules are correct. Each was implemented correctly in isolation. KTD3 has since taken
**three** corrections, and every one of them lives at an **intersection** of two rules, not inside
any one of them:

| Correction                                                        | Rules that collided | Amendment                               |
| ----------------------------------------------------------------- | ------------------- | --------------------------------------- |
| Rule 1's flip would let rule 2 discard a replay-proven transcript | 1 × 2               | plan `:98` (2026-08-18, implementation) |
| Rule 3 clearing the marker strips rule 1's protection             | 1 × 3               | plan `:99` (2026-08-19, code review)    |
| Rule 2's drop deletes the only record that the id is dead         | 2 × re-adoption     | plan `:99` (2026-08-19, code review)    |

The last two are the subject of this doc: this arc’s Tier-2 code-review findings #7 and #8 (numbering from that run’s report), both raised by the
adversarial reviewer, both independently validator-confirmed, both P2 at confidence 75, both fixed
in the **uncommitted feat-209 working tree as of 2026-08-19, no PR yet**.

## Guidance

### 1. Key a protection to the durable identity of the thing protected

Before writing a guard, ask: **who owns the lifetime of the state this guard reads?** If the answer
is "another rule," the guard is conditional on that rule not having fired — which is not a
protection, it is a race with a legitimate transition.

`adoptedIds` is _bookkeeping_: it answers "did this row arrive by adoption rather than by
hydration?" Rule 3 owns its lifetime and clears it on a normal, expected, desirable event. Rule 1's
protection is about something else entirely: "is this the pane the user deep-linked into?" That
property is owned by the session's construction-time entry input — the id the module was mounted
with — which never changes for the instance's lifetime. It is NOT owned by the live URL, which
changes on every traversal (and in this codebase `useParams()` never even reflects the shallow
writes — the plan's KTD1). Keying the first question's answer to the second question's state is
the bug.

The fix captures the durable identity once at construction (`:326-329`):

```ts
// The id the user deep-linked into (feat-209, KTD3 rule 1): permanently
// exempt from the revert removal — a hydration-cleared marker must not
// strip rule-1 protection from the row the user landed on.
const deepLinkId = deps.initialConversationId ?? null
```

and reads **both** axes at the guard (`:490-501`) — the marker for "adopted, generally," the id for
"the one pane that must never vanish":

```ts
const isRemovable = (c: Conversation) =>
  c.origin === "server" &&
  c.messages.length === 0 &&
  !adoptedIds.has(c.id) &&
  c.id !== deepLinkId
const toUnavailable = (c: Conversation): Conversation =>
  (adoptedIds.has(c.id) || c.id === deepLinkId) && c.replay !== "loaded"
    ? { ...c, replay: "not_available" }
    : c
```

Note the two clauses are **not** interchangeable spellings of one predicate. `isRemovable`'s
`c.id !== deepLinkId` is unconditional and permanent. `toUnavailable`'s disjunction still carries
the 2026-08-18 amendment's `replay !== "loaded"` guard, because a loaded replay already proved
ownership server-side and flipping it would hand rule 2 a proven transcript to delete. Adding an
axis does not license flattening the guards that already use the old one.

The symmetric bound also holds: a durable key must be no BROADER than the property it protects.
Here the permanence is deliberately broader — after the user moves off the deep-link pane, a
mid-session revert leaves that one row in the rail as a "no longer available" entry while sibling
message-less rows are removed — an accepted stray-row residual, chosen over re-introducing an
activity condition the guard would then have to keep in sync. When you widen a key past the
property, state what the guard does in the states the property no longer covers, as this trade
is stated here. (Bounded sibling residual, named rather than implied: an id adopted at RUNTIME
via popstate carries only the transient marker, never the permanent exemption — its defect-A
ordering window is narrow but not structurally closed.)

### 2. When two settled rules share one piece of state, add an axis — do not weaken a rule

Rule 2's drop was implemented as "remove the marker, remove the row." That is faithful to rule 2 as
written. But the row's _presence_ was also the only thing recording "this id was tried this session
and came back dead," which is what made the replay cache work: replay state lives on the row, so
deleting the row deletes the cache entry.

Two settled rules wanted the same bit of state to mean two things. Neither rule is wrong, and
weakening either one (keep the row → rule 2 gone; never drop the marker → rule 3 gone) is a
regression. The fix is a **second axis**, session-internal like the first (`:331-334`).

Bound the recipe before copying it: add a second axis only when the new fact's CLEAR condition is
genuinely independent of the old one's. When two axes must be cleared at the same site — as
`adoptedIds` and `deadAdoptedIds` are, both at the hydration loop — they are close to one fact
with two values, and a single id-keyed map with a state value (`"adopted" | "dead"`) makes the
coupled clear unrepresentable instead of comment-enforced. This instance kept two Sets because
their OTHER lifecycle answers differ (one is cleared by rule 2's drop, the other written by it),
but that is a judgment at the margin, not a free choice — an axis whose lifetime fully mirrors an
existing one buys nothing except a second contract to keep in sync.

```ts
// Adopted ids whose R2 drop resolved them dead this session (feat-209):
// re-adoption re-seeds the cached "not_available" pane without refetching.
// Survives deactivate() — cache semantics, not fetch-completing state.
const deadAdoptedIds = new Set<string>()
```

**Read the design prose as the test for whether a single piece of state can carry the load.** This
plan's Scope Boundaries (`:73`) had already promised, as an _accepted residual_, that replay fetches
are "session-cached, cannot repeat" and that "back to a known-dead `/c/<id>` re-renders its cached
'no longer available' pane." Those sentences are assertions about runtime behavior, and they were
true right up until rule 2 removed the row that carried the cache. Prose in a scope or
accepted-residual section is an untested claim in exactly the sense the single-flight doc means when
it says a code comment asserting an invariant is untested until a test names it — with the extra
hazard that nobody thinks to grep a _Scope Boundaries_ list for behavioral claims. When the prose and
the implementation disagree, the disagreement is the finding.

**A new axis needs its own answers to every lifecycle question the old one already answered.** Two
of them mattered here:

- _Who clears it?_ The same principle that clears the marker clears the cache, so the hydration loop
  clears both — but that had to be re-derived from the principle, not copied (`:547-553`):

  ```ts
  // A hydration-confirmed row is proven part of the user's history — it
  // stops being "adopted" AND stops counting as session-dead (a listed
  // row is live by definition, feat-209).
  for (const row of result.threads) {
    adoptedIds.delete(row.id)
    deadAdoptedIds.delete(row.id)
  }
  ```

  (The `deadAdoptedIds.delete` is defensive consistency more than a reachable branch: once a page
  lists the id, the row re-enters `conversations` and re-adoption takes the known-id branch, so
  the dead cache would not be read again anyway. Labeling that here keeps a later reader from
  deleting the line as unreachable and silently breaking the principle it encodes.)

- _Does it survive teardown?_ `deactivate()` rolls back "every state only an (aborted) in-flight
  fetch could complete" so the StrictMode `setup → cleanup → setup` cycle re-arms (`:927-940`).
  Deadness is not such a state — it is a settled result — so it must **not** be rolled back, and the
  declaration says so. Deciding an axis's position on the existing teardown contract is part of
  adding it, not a follow-up.

- _What bounds it?_ `deadAdoptedIds` grows one entry per rule-2 drop, is session-scoped, and is
  pruned only by a hydration page listing the id — fine for a browser-session store, a failure
  mode in a longer-lived one. Answer the bound at the declaration site alongside the other three
  questions.

### 3. Test the orderings the rules make possible, not the rules

Both defects survived a green suite in which **every fixture exercised one rule at a time**. That is
the whole failure mode: a per-rule test can only fail if the rule is implemented wrong, and neither
rule was.

Enumerate the interaction, not the rule. For a set of lifecycle rules over shared state, list
EVERY operation that reads or writes that state — the rules that write it, the entry points that
read or re-seed it (construction, `adoptConversation`, selection, teardown) — then for each pair
(A, B) write A-then-B **and** B-then-A, and ask what state B reads that A just changed. A
rules-only pair set would have missed defect B: its collision is rule 2 × RE-ADOPTION, and
re-adoption is an entry point, not a rule. And the pair is a floor, not a cover — both defects
here also turned on a fact outside the pair (hydration merges the listing, never the transcript),
so when the pairwise case does not explain the outcome on its own, name the third participant.

| Ordering the isolated tests already covered                    | The ordering that killed it                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| denial arrives, then hydration (marker still set → row exempt) | **hydration lists the id, then the denial arrives** (marker cleared → row deleted) |
| drop the dead row, then stop (row gone, correct)               | **drop the dead row, then Back into it** (unknown id → refetch)                    |

The three red-first tests now pinning these live in
`apps/chat/src/lib/conversation-session.adopt.test.ts`:

- `it("keeps rule-1 protection after hydration listed the deep link: a later replay denial never vacates the pane", …)` (`:216`)
- `it("re-adopts a session-dead id from cache: replay not_available, never a refetch", …)` (`:286`)
- `it("drops a re-adopted dead row again on the next deselect (R2 still holds)", …)` (`:314`)

The third exists because the second's fix could have been written as "never drop it twice." It pins
that the _other_ rule still holds after the fix — the interaction test's necessary companion.

## Why This Matters

**The vacated pane is the failure rule 1 was written to prevent, reintroduced through rule 3.** The
user opens a bookmarked `/c/<id>`, sees the thread's pane, and — because their session expired
somewhere between the sidebar listing and the transcript fetch — watches the app silently replace it
with an empty "New conversation." No banner, no nudge: feat-241's R16 silence is deliberate, which
is exactly why the _pane_ must stay. The user's only signal is that their conversation is gone. The
whole two-screen denial model exists so that a failed deep link says something instead of nothing.

**The refetch is not a small waste.** `/api/history/thread` is a bearer-authenticated proxy to
Mastra with a [9 s, 10 s] read budget against a small dedicated connection pool. Back/Forward is a
repeatable surface: every pass through a dead entry that has already resolved and been dropped
re-seeds an unknown id and fires another authenticated upstream read, with a guaranteed-identical
`not_available` result — unbounded over a session. (A pass taken while the previous read is still
in flight costs nothing: `dropAbandonedAdopted` only drops a row whose replay already resolved
`not_available`, so the loading row is still present to select.) The plan had already reasoned
about exactly this and recorded "session-cached, cannot repeat" as the reason it was safe.

**A plan whose prose has drifted from its code is worse than a plan with a gap.** Both residual
sentences read as _decisions_ — someone considered rapid traversal and concluded it was bounded. A
future reader budgeting for a public release inherits that conclusion. The correction had to land in
the plan (`:99`) as well as the code, because the prose was load-bearing for work that has not
happened yet.

**And the class is cheap to miss and cheap to catch.** Every one of these was a two-to-six-line
diff. The expensive part was noticing that two correct rules can only both hold in one order.

## When to Apply

- A guard, exemption, or protection reads a **flag, marker Set, or bookkeeping field whose lifetime
  another rule owns**. Ask what the protection is _about_; if that thing has a durable identity
  (a URL id, a route param, a construction-time input, a primary key), key to it and treat the
  marker as an additional, not the sole, axis.
- A **removal/cleanup rule and a caching or memoization property ride the same state** (a row, a map
  entry, an object's presence). Deleting the carrier deletes the cache. Decide explicitly whether
  the cached fact outlives the carrier — and if it does, it needs its own storage.
- A design doc records an **accepted residual, scope boundary, or "cannot happen" note that asserts
  runtime behavior**. Grep those sections for behavioral verbs (`cached`, `cannot`, `re-renders`,
  `exactly once`, `never`), then keep only the sentences that assert behavior the module itself
  PRODUCES and that a later decision would inherit — pin each of those with a test named after
  the sentence. Deliberate non-goals ("back/forward does not restore scroll position") and
  platform facts ("retention is platform-controlled") carry the same verbs and must NOT be
  pinned: a test on a non-goal turns a future improvement red, and a platform fact has no test
  surface. For a produced-behavior claim no unit test can reach (multi-tab, browser-level), name
  the verification channel beside the sentence — browser matrix, verified-by-hand with a date —
  a claim with neither a test nor a channel is the untested-invariant case.
- You are **adding a state axis** to a module that already has a teardown/reset contract
  (StrictMode rollback, `deactivate()`, `reset()`, cache eviction). Answer _who sets it, who clears
  it, does it survive teardown_ at the declaration site, in a comment, before writing the consumer.
- More than two lifecycle rules govern one entity. Beyond two, "each rule is implemented correctly"
  stops predicting "the entity behaves correctly."

## Examples

All citations are `apps/chat/src/lib/conversation-session.ts` in the uncommitted feat-209 working
tree as of 2026-08-19 (no PR yet).

### Defect A — hydration-then-denial, before the fix

```
construction   initialConversationId = DEEP_ID
               → row { origin: "server", messages: [], replay: "idle" }, adoptedIds = { DEEP_ID }
activate()     → startHistoryFirstPage() + maybeStartReplay()  (replay: "loading")
page 0 lands   → mergeServerThreads merges DEEP_ID (still messages: [])
               → adoptedIds.delete(DEEP_ID)          ← rule 3, legitimate and correct
replay lands   → { ok: false, reason: "access" } → revertToClientOnly()   (:609-614)
               → isRemovable(row): server ✓ messages.length === 0 ✓ !adoptedIds.has(id) ✓
               → the ACTIVE deep-link row is filtered out, a fresh local row becomes active
```

The row is message-less at step 3 for an ordinary reason: hydration merges the _listing_ (id, title,
`updatedAt`), never the transcript — the transcript is the replay that is still in flight. So the
window between "hydration cleared the marker" and "replay resolves" is not a narrow race; it is the
normal shape of a deep-link open.

After the fix, `isRemovable`'s `c.id !== deepLinkId` short-circuits the removal and `toUnavailable`
flips `"loading" → "not_available"`, so the pane stays put and renders the "no longer available"
copy. The pinning test asserts the intermediate state too, so it cannot pass for the wrong reason:

```ts
// The page landed first: marker cleared, row merged, still message-less.
expect(session.getSnapshot().activeConversation.replay).toBe("loading")
replayGate.resolve({ ok: false, reason: "access" })
await flush()
const snap = session.getSnapshot()
// The deep-link row survives the revert, active — never a vacated pane.
expect(snap.activeId).toBe(DEEP_ID)
expect(snap.activeConversation.replay).toBe("not_available")
```

### Defect B — drop-then-readopt, before the fix

```
popstate       adoptConversation("srv-dead") → unknown id → seed + maybeStartReplay()  → fetch #1
replay lands   → { ok: false, reason: "not_available" }
user navigates → dropAbandonedAdopted(previousId): adoptedIds.delete + row filtered out  ← rule 2
Back           adoptConversation("srv-dead") → not in conversations, history.phase ≠ "denied"
               → seeds a FRESH row with replay "idle" → maybeStartReplay()               → fetch #2
Forward, Back  → fetch #3, #4, …
```

Nothing in the session remembered the id had already resolved dead, because the row _was_ the
memory. The fix records it on the way out (`:815-829`):

```ts
adoptedIds.delete(row.id)
// Remember the id as session-dead: re-adoption (back into the dead deep
// link) re-seeds the cached "not_available" pane instead of refetching.
deadAdoptedIds.add(row.id)
conversations = conversations.filter((c) => c.id !== row.id)
```

and consumes it on the way back in (`:881-895`) — seeding the terminal state directly and skipping
the replay trigger, so the cache is enforced at both the state and the fetch:

```ts
// A session-dead id re-seeds its cached terminal state — the replay is
// session-cached ("cannot repeat"), so back into a dead deep link
// re-renders the pane without ever re-firing the thread fetch.
const dead = deadAdoptedIds.has(id)
conversations = [
  ...conversations,
  dead
    ? { ...seedAdoptedConversation(id), replay: "not_available" }
    : seedAdoptedConversation(id),
]
activeId = id
draft = ""
dropAbandonedAdopted(previousId)
commit()
if (!dead) maybeStartReplay()
```

The `expect(fetchHistoryThread).toHaveBeenCalledTimes(1)` at the end of the re-adopt test
(`conversation-session.adopt.test.ts:311` — the closing assertion of the same `:286` case Guidance
3 lists) is the assertion the plan's residual sentence should have had from the start.

### The plan amendment

`docs/plans/2026-08-18-2122-feat-chat-per-conversation-urls-plan.md:99`, immediately under KTD3 and
below the earlier `:98` amendment, records both corrections in place rather than rewriting the KTD:

> **Amendment (2026-08-19, code review):** two review-validated corrections to this KTD's mechanics.
> (a) Rule 1's protection is keyed to the DEEP-LINK id itself, not only the adopted marker … (b)
> Rule 2's deselect-drop deleted the deadness cache, so Back into a dropped dead entry re-fetched
> the replay on every traverse, contradicting this plan's own "session-cached, cannot repeat /
> re-renders its cached pane" residual. … Both pinned by session tests.

Keeping the original KTD text intact and stamping a dated amendment beside it is what makes the
"three corrections, all at intersections" pattern legible at all — a silent rewrite would have
erased the evidence that the rules, individually, were right the whole time.

## Related

- `docs/plans/2026-08-18-2122-feat-chat-per-conversation-urls-plan.md` — KTD3 (`:97`), its two dated
  amendments (`:98`, `:99`), and the Scope Boundaries residual (`:73`) whose prose the second
  amendment reconciles.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the META
  home for the test half. The instance this doc adds is the _ordering_ axis: every fixture proved
  its own rule's branch shape, and no fixture could fail unless a rule was wrong, which none was.
- `docs/solutions/design-patterns/async-single-flight-slot-release-hazards.md` and
  `docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md` — the same
  module's other bookkeeping-state discipline, and a useful contrast: those laws are about state
  released **too late or never** (`replayInFlight` at `conversation-session.ts:596-641` satisfies
  the fire-and-forget prescription for the async callback body — the `delete` sits in the body's
  `finally`, with the reservation landing a few synchronous statements earlier). This doc is the
  opposite failure — state cleared **on time, by the right rule**, out from under a guard that had no
  business depending on it. Both docs' "re-derive the invariant against the shape in front of you"
  meta-lesson applies unchanged.
- `docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md` — the
  teardown contract the new `deadAdoptedIds` axis had to be positioned against
  (`conversation-session.ts:917-944`); its feat-281 corollary about a synchronous external store
  rolling back "every state only an aborted in-flight fetch could complete" is the rule that decides
  a new axis survives `deactivate()`.
- `docs/solutions/architecture-patterns/kill-switch-completeness-follows-data-lifetime.md` — nearest
  sibling in shape: a property that holds on one path is silently assumed to hold on another, because
  both read the same state. There the axis is write-path vs read-path; here it is rule vs rule.
