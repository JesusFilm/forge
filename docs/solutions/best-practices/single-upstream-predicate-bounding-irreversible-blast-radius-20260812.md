---
title: Re-check client-side when one dependency-interpreted predicate is the only bound on a cross-subject blast radius
date: 2026-08-12
category: best-practices
problem_type: best_practice
component: destructive-operations
root_cause: one-dependency-interpreted-predicate-bounds-the-blast-radius-and-every-test-double-implements-it-correctly-by-construction
resolution_type: code_fix
severity: high
tags:
  - destructive-cli
  - fail-closed
  - filter-integrity
  - confirm-token
  - vacuous-assertion
  - erasure
related:
  - docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md
  - docs/solutions/tooling-decisions/destructive-embedding-cleanup-cli-safety-contract.md
  - docs/solutions/architecture-patterns/diy-retention-sweep-three-controls-visibility-walled-store.md
---

# Re-check client-side when one dependency-interpreted predicate is the only bound on a cross-subject blast radius

**Scope — this doc carries three rules from one feature (feat-337 per-user
erasure):** verify the single upstream predicate client-side; make the confirm
token pin every axis the operation is parameterized by; and don't let a
negative test assertion be satisfied by the import graph. They share one shape:
_a single control that under-covers a destructive operation._

## Problem

An operation's blast radius is bounded by exactly one predicate you do not own
— a store-side `filter` object, an SDK scope, a provider query param. The code
reads as safe, every test passes, and no test _can_ fail if that predicate
stops working.

feat-337 (per-user erasure) is the worked case. The tool deletes one subject's
Seeker conversation threads, keyed by exact `resourceId`:

```ts
const result = await memory.listThreads({
  filter: { resourceId },
  page,
  perPage: ERASURE_LIST_PAGE_SIZE,
})
for (const thread of result.threads) threadIds.push(thread.id)
// …later: deleteThread(id) for every collected id
```

`filter: { resourceId }` was the _entire_ control between this tool and
deleting another person's conversations.

**What could actually drift — two of three mechanisms survive the type system.**
Worth splitting, because conflating them inflates what the runtime guard buys:

| Drift                                     | Caught by                                                                                                                                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The inner `resourceId` field is renamed   | **Compile error.** The hand-written structural `AiChatErasureMemory` type is assigned from `new Memory(...)` with no cast, and TypeScript's weak-type detection rejects an object with no properties in common. |
| The outer `filter` key is renamed         | Nothing. The argument assigns cleanly and the filter is silently absent.                                                                                                                                        |
| The filter keeps its shape and goes inert | Nothing.                                                                                                                                                                                                        |

So the uncast structural assignment is a real first control — keep it, and
never bridge it through `unknown` — but it covers one drift of three.

**Why no test could catch the other two.** Every store fake in the unit suite
implements the filter as `===`, because that is what the contract says. The
fakes are correct — which is exactly the problem: they encode the assumption
under test, so the assumption cannot be falsified by them. The only
real-contract proof was an opt-in, deliberately-out-of-CI smoke. A CI run could
be fully green while the single runtime control was gone.

### The trigger

> One predicate, **interpreted by a versioned dependency**, is the only bound
> on a **cross-subject** blast radius — and every test double implements that
> predicate correctly by construction.

Three qualifiers, each doing work:

- **Dependency-interpreted.** A store filter object, an SDK scope, a provider
  query param — something whose _meaning_ a version bump can change. Not an
  author-owned predicate evaluated against a stable contract: the same feature's
  break-glass `DELETE FROM ai_chat.mastra_threads WHERE "resourceId" = $1`
  carries no client-side re-check and needs none, because SQL's `=` is not going
  to be reinterpreted by a `pnpm update`.
- **Cross-subject**, not merely irreversible. Irreversibility is an _amplifier
  on severity_, not a precondition. The same predicate on a read path leaks
  instead of deleting, which is why the audit below sweeps every call site
  rather than only the destructive ones.
- **Doubles encode the predicate.** If a test double could plausibly get the
  predicate wrong, your suite is already testing it.

## Solution

**Treat the upstream predicate as a promise, not a proof: re-check it
client-side, and fail closed when the re-check cannot be satisfied.**

```ts
// CHECK 1 — collect-time: each listed row's OWN key must match.
if (thread.resourceId !== undefined && thread.resourceId !== resourceId) {
  mismatchedRows += 1
  continue
}
// The `!== undefined` carve-out is a deliberate DELEGATION to check 2, not a
// softening: this shape cannot distinguish "row omits the key" from "key is
// genuinely absent". A design that cannot implement check 2 must treat an
// absent key as a mismatch here instead.

// …after the drain: any mismatch STOPS the run.
if (mismatchedRows > 0) {
  return { ok: false, reason: "filter_mismatch", rejectedRows: mismatchedRows }
}

// CHECK 2 — per-item, immediately before the destructive call: prove ownership
// from the item's own record.
const owner = await memory.getThreadById({ threadId })
if (owner === null) continue // already gone — benign
// Fails CLOSED: `!==` is true for null and undefined too.
if (owner.resourceId !== resourceId) {
  return {
    kind: "failed",
    stage: "delete",
    reason: "filter_mismatch",
    threadsDeleted,
  }
}
await memory.deleteThread(threadId)
```

> **The `owner === null → continue` branch rests on a premise: this read THROWS
> on a store fault.** That is a pinned `@mastra/*` dist fact, re-verified on
> every bump. Where the equivalent read _returns null_ on failure, an absent
> record is indistinguishable from a fault and the branch must reject, not
> continue — otherwise a store outage produces a run that skips every delete and
> reports success.

### The trust split this rests on

The pair is coherent only because it distrusts one specific capability — the
store's **query-side filtering** — while still trusting **key-addressed reads
and deletes**. That is a defensible split (a filter is an interpreted
abstraction argument; `getThreadById(id)` is a primary-key lookup), but it must
be stated, because it tells you when the pattern has nowhere to stand: **a
dependency exposing only query-scoped operations gives you no independent
footing.** Against a `deleteWhere({ resourceId })` bulk endpoint, check 2 has
nothing to attach to and check 1 bounds nothing, because the same untrusted
predicate still selects what gets destroyed. Convert such an operation to
enumerate-then-delete-by-id first, or the recipe does not apply.

### Which check applies where

Check 1 and check 2 are not belt-and-braces; they cover different paths and
have different cost profiles.

|                                | Check 1 (re-check listed rows)                                                                                                                 | Check 2 (per-item ownership proof) |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Applies to                     | **Every** instance of the trigger                                                                                                              | Per-item destructive calls only    |
| Cost                           | Free (rows already in hand)                                                                                                                    | One extra read per item            |
| Read/preview path              | **The only control** — a preview never reaches check 2, so the blast-radius count an operator reads before confirming depends on check 1 alone | Not reached                        |
| Batched or rate-limited sweeps | Required                                                                                                                                       | Unavailable — see below            |

The in-repo precedent shows the check-1-only instantiation:
`langfuse-trace-retention.ts` never trusts its own `toStartTime` filter, and
re-checks every listed row's own `startTime` against the cutoff. It implements
**check 1 alone**, and correctly so — its delete is a ≤50-id batch under a
per-day quota, so a per-item re-read is both structurally unavailable and
quota-prohibitive. Price check 2 for low-volume, operator-run operations; for
high-volume or rate-limited sweeps, check 1 is the required control and check 2
is optional or absent.

### Disposition: reject or skip?

The precedent above **skips** the offending row (loudly, with a counter) and
keeps sweeping. feat-337 **rejects the whole run**. That is not an
inconsistency — it is the discriminator:

- **Reject and stop** when the operation is one-shot and subject-keyed. Nothing
  runs behind it to catch what was missed, and a store contradicting its own
  filter has also forfeited any claim that the returned set was _complete_ — so
  deleting the subset that did match is a guess about coverage, not a partial
  success.
- **Skip and count** when the operation repeats on a schedule over a whole
  population. A later run re-covers the skipped rows, and skipping is already
  the fail-safe direction. Converting the retention sweep to reject-and-stop
  would let one unparseable timestamp halt retention entirely and silently
  breach the policy — the opposite of the intended effect.

Three further properties, each a deliberate choice:

1. **A rejection is a distinct outcome, not a generic error.**
   `filter_mismatch` / `unreadable_rows` mean "the store contradicted itself —
   stop, do not retry, escalate", which is different guidance from every other
   failure the tool can produce.
2. **A reject-and-do-not-retry guard on a DEADLINED operation must ship with a
   documented manual fallback.** "Escalate to engineering" has no bounded
   completion, while a GDPR erasure runs against a one-month clock. feat-337
   survives this only because the operator runbook carries break-glass paths
   (console bulk-delete, raw SQL); make that companion part of the pattern, not
   an accident of the worked case. Same applies if the fail-closed check turns
   out to be permanently unsatisfiable for some subject.
3. **The GUARD is now CI-testable — the upstream CONTRACT still is not.** A
   fixture whose listing returns another resource's row makes the guard go red
   in ordinary CI. That proves the _conditional_ — if the store contradicts its
   filter, the tool refuses — and says nothing about whether the real filter
   works. **Keep the real-contract smoke; do not retire it once the re-check
   lands.** Believing otherwise is precisely the mocked-vs-real confusion this
   whole family is about.

## A confirm token must pin every axis the operation is parameterized by

The same shape, one layer up: a single control that under-covers a destructive
operation. Here the control is the confirm token, and the gap is not that it is
unchecked but that it attests to less than the operation does.

feat-337 copied `backfill-video-relation-order.ts`'s hash gate — a strong,
correct precedent that pins the **destination**:

```ts
const identity = JSON.stringify({
  protocol, username, host, port, database, params,
})
if (args.execute && args.confirmDatabase !== identity.hash) throw new Error(...)
```

That precedent's operation is parameterized by _where_ alone: a backfill acts on
the whole catalog. Erasure is parameterized by **where AND whom**. Copying it
verbatim left the subject axis unbound, so a token minted while previewing
`user:alice` still authorized `--execute --resource=user:bob` against the same
databases.

```ts
const identity = JSON.stringify({
  postgres: { protocol, username, host, port, database, params },
  langfuse: { host: langfuseHost }, // host only — see the unbound axis below
  resource: createHash("sha256").update(resourceId).digest("hex"),
})
```

Four things that generalize:

- **Enumerate every parameter, including the ones supplied by credentials and
  environment — not just argv.** The worked example is itself incomplete on
  exactly this point: it pins the Langfuse _host_, but which project a key pair
  resolves to is determined by the credentials, and the local-dev pair addresses
  the same production project as Railway's. That axis stays unbound pending a
  project-identity probe. An axis the token is silent about is an axis that can
  change after confirming — and credential-supplied axes are the easiest to
  miss, because they never appear in the command.
- **Stability is what makes an axis eligible, not "is it a parameter".** This
  design deliberately excludes _counts_: an actively-chatting subject would
  change the count between preview and execute and deadlock the confirm loop. A
  resource key is stable, so that objection does not apply to it. "Never include
  volatile state" and "only include the destination" are different rules, and
  conflating them is what hid the gap.
- **An axis excluded for volatility needs a compensating drift signal.**
  Exclusion from the token must not mean exclusion from the operator's view:
  feat-337 re-reports its execute-time counts, and the runbook says to compare
  them against the preview's.
- **Emit the token on the PREVIEW path only — never echo it from an execute
  run, including its refusal.** This one is load-bearing and easy to get wrong,
  because echoing the token is the _helpful_ thing to do. The token is computed
  from the arguments just supplied, so a refusal that prints it hands the
  operator a valid token for whatever they just typed: `--execute
--resource=user:bob` carrying alice's token would refuse, print bob's token,
  and succeed on the next paste with no preview of bob ever run. Pinning the
  axis would buy one keystroke instead of a forced look at the blast radius.
  (The backfill precedent _does_ echo its hash on refusal and can afford to —
  its token pins a database the operator is not changing between invocations.
  The moment a token pins something the operator varies, echoing defeats it.)

## Don't let a negative assertion be satisfied by the import graph

The third under-covering control from the same feature, this one in a test.

The erasure module must refuse when `DATABASE_URL` is unset rather than fall
through to `getMastraDatabaseUrl()`'s localhost default — the wrong-database
hazard on an irreversible delete. The test asserted:

```ts
expect(getMastraDatabaseUrl).not.toHaveBeenCalled() // vacuous
```

The module never imports `getMastraDatabaseUrl` at all. The negative is
satisfied by the import graph, not by the guard, so **the assertion passes with
the entire refusal deleted.** It reads as the tightest possible check — it names
the exact forbidden fallback — while proving nothing, and unlike most vacuous
tests there is no fixture to widen: it is vacuous by construction, and no input
could make it fail.

```ts
expect(getAiChatStorage).not.toHaveBeenCalled() // non-vacuous: IS imported
```

**Rule:** a `not.toHaveBeenCalled()` is evidence only when the subject _can_
call it — check the import graph first. Prefer asserting the observable effect
(here: no store was constructed) over the absence of a call the code has no way
to make.

This is a worked instance of the repo's mocked-vs-real META law; see
`mocked-shape-vs-real-contract-discipline-20260506.md`, which indexes it.

## Prevention

- **Sweep every call site sharing the predicate, not just the destructive ones.**
  The trigger is cross-subject blast radius; deletion is one consequence. In
  this repo, `ai-chat-history-route.ts` passes the identical
  `filter: { resourceId }` to the identical store and projects rows straight to
  the wire — under the same drift it would return other subjects' thread titles
  to a signed-in caller. That sibling was outside feat-337 PR 1's scope and is
  named here so the next audit starts from the predicate, not from one feature.
- When reviewing a destructive change, find the single predicate bounding its
  blast radius and ask: **if this stopped working, which test goes red?** If the
  honest answer is "the opt-in smoke, maybe", the guard belongs client-side.
- Test doubles that implement an upstream contract correctly are coverage of
  _your_ code given that contract — never of the contract. The concrete test:
  can a version bump change what the predicate MEANS? If yes, re-check it.
- Copying a safety precedent is not the same as applying it. Re-derive which
  axes the _new_ operation is parameterized by, and whether the precedent's
  disposition (reject vs skip, echo vs withhold) still fits.
- Distinguish "this dependency might be buggy" (usually not worth guarding) from
  "this dependency is the only thing standing between an irreversible action and
  the wrong subject" (worth guarding). feat-337's cost was one extra read per
  deleted thread, bounded by a 200-thread-per-resource ceiling, on an
  operator-run tool.
