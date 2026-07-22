---
title: "Releasing an async single-flight slot — three hazards, and when the try/finally slot-reservation law does not apply"
date: "2026-07-22"
category: design-patterns
module: apps/mastra
problem_type: design_pattern
component: service_object
severity: high
root_cause: async_timing
resolution_type: code_fix
applies_when:
  - "Concurrent callers share one in-flight promise stored on a mutable slot (single-flight / stampede coalescing over a TTL cache, memo map, or connection warm-up)"
  - "The guarded body can settle SYNCHRONOUSLY on some paths (cached short-circuit, early return, injected fake in tests), so a body-internal finally can run before the slot assignment lands"
  - "The module advertises a never-throws / typed-result contract, so a rejecting shared promise would both wedge the slot and rethrow at every joiner's await"
  - "You are about to apply the in-memory-slot-reservation law and need to check whether the reservation is assigned BEFORE or AFTER the guarded body starts"
symptoms:
  - "Slot wedged on an already-settled promise for the process lifetime — every later caller awaits a stale flight and the cache never refetches until restart"
  - "A fulfillment-only `void flight.then(release)` silently drops the rejection path, so the release never runs AND the derived promise rejects unhandled"
  - "A sync statement placed before the guarded `try` (a config clamp reading a caller-supplied getter, `encodeURIComponent` throwing URIError on a lone surrogate) escapes the guard and breaks the module's no-throw contract"
  - "The catch block itself throws, because it re-reads the same caller-supplied config and injected clock that the try block was guarding"
related_components:
  - assistant
  - testing_framework
tags:
  - single-flight
  - promise-rejection
  - async-timing
  - unhandled-rejection
  - try-finally
  - no-throw-contract
  - cache-stampede
  - mastra
---

# Shared-promise single-flight slots: release on both settlement paths, and keep nothing before the guarded `try`

## Context

`apps/mastra/src/services/langfuse-prompt-client.ts` (on unmerged PR #1621, branch
`feat/langfuse-prompt-helper` — this file is **not** on `main`) is a two-layer managed-prompt
resolver. Layer 1 (`fetchLangfusePrompt`) does one HTTP call to Langfuse and returns a discriminated
result; its documented contract is that it **never throws and never rejects**. Layer 2
(`getManagedPrompt`) owns a per-`(name, resolvedLabel)` cache entry with a TTL, a failure cooldown,
stale-serving, and a compiled-in fallback, and it exposes the same never-throws contract to callers —
Mastra agents resolving system prompts at request time.

Concurrency on that cache is handled by a **single-flight slot**: an `inFlight?: Promise<void>` field
on the cache entry (`langfuse-prompt-client.ts:476-489`). The first caller to find an entry Empty or
Expired creates the refetch promise and parks it in the slot; concurrent callers find the slot
occupied and simply `await` it rather than issuing their own fetch. When the flight settles, the slot
must be cleared so a later expiry can refetch. If the slot is never cleared, the entry is wedged on a
settled promise — permanently, because nothing else ever writes that field.

The interesting part is how the release ended up where it did. It took three positions:

1. **The plan prescribed** reserve/release in `try/finally` around the entire refetch body, citing
   this repo's existing law,
   `docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md` ("the `try`
   MUST be the first statement of the cb body"). That law was written for Next's `after()`
   fire-and-forget dispatch, where the callback body *is* the unit of work and nobody holds a handle
   to it.

2. **The implementer rejected the prescription** for this shape, correctly. A `finally` **inside the
   refetch body** can run *before* the reservation assignment `entry.inFlight = flight` has even
   executed — if the body settles synchronously (an early-return path, an injected `fetchImpl` that
   resolves immediately, a sync throw), the `finally` fires during the `refetchManagedPrompt(...)`
   call expression, deletes a slot that is still `undefined`, and *then* the assignment lands and
   wedges the entry on an already-settled promise. That is the exact failure the guard exists to
   prevent, reintroduced by following the guard's letter. The implementer shipped the release riding
   the flight promise from the caller's side instead, with an identity check so a stale release can
   never clear a *newer* flight.

3. **Code review caught the remaining hole.** The shipped release was
   `void flight.then(release)` — fulfillment-only. That single omission is a *double* failure, not a
   single one, and it survived a fully green suite (48 tests in `langfuse-prompt-client.test.ts`,
   plus 3 in the smoke file, all passing at review time) while the
   code comment beside it asserted the opposite of the truth: it claimed the flight was
   "structurally non-rejecting, and `.then` cannot manufacture an unhandled-rejection edge." The
   existing slot-leak test only threw from *inside* the guarded `try`, so it could not reach the
   edge. And the rejection was constructible at the time, because the cooldown `Math.min(...)` over
   a **caller-supplied** `config` was the first statement of the refetch body — outside the `try`.

The final shipped form is `void flight.then(release, release)` plus a joiner-side
`try { await entry.inFlight } catch {}`, together with a sweep that moved every synchronous prologue
statement inside its guard. The bug was caught in review before merge; it never ran in production.

The meta-lesson is worth stating on its own: **the diff cited the institutional slot-leak law in a
provenance comment and still violated it.** Citing a law reads as compliance to both the author and
the reviewer — the citation is the thing that makes the region *look* already-audited. It is not
compliance. Re-derive the law's invariant against the actual shape in front of you.

## Guidance

### First, identify which slot shape you have

The two shapes look alike (reserve in-memory state, release when work completes) and take **opposite**
prescriptions. Get this right before applying either.

**Shape A — fire-and-forget dispatch (`after()`, queue push, detached worker).** Nobody retains a
handle to the work. The callback body is the only place that can observe its own completion.
Prescription: the existing law — `try` as the **first statement of the callback body**, release in
`finally`. See `docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md`.

**Shape B — shared-promise single-flight.** The reserved state *is a promise handle* that other
callers `await`. The reservation is an assignment in the **caller**, and the work is a function whose
return value gets assigned. Prescription: the release must **not** live in the work body's `finally`
— it must ride the promise from the caller's side, after the assignment. A body-internal `finally`
races the assignment and loses whenever the body settles synchronously.

The discriminator is simple: *does anyone else hold or await the reserved value?* If yes, Shape B.

### Shape B requires three independent defenses

All three. Each catches a class the others miss.

**(a) Identity-checked release.** The release closure captures the specific flight it was registered
for and clears the slot only if that flight is still the occupant:

```ts
const release = () => {
  if (entry.inFlight === flight) entry.inFlight = undefined
}
```

Without the identity check, a late release from an old flight can clear a newer one, letting a second
fetch start while the first is still in progress — the single-flight guarantee silently degrades to
a thundering herd under exactly the load it exists to handle.

**(b) The release must be registered on BOTH settlement paths.** `void flight.then(release, release)`,
never `void flight.then(release)`. Do this **even when the flight is designed never to reject** —
especially then. The "designed never to reject" argument is precisely what makes the omission
invisible; the design is an invariant of code that will be edited by someone who has not read this
comment.

Whether `.finally(release)` is the better spelling depends on **which promise occupies the slot** —
this is a topology rule, not a style preference:

| Slot holds | Correct release | Why |
| --- | --- | --- |
| the **raw** flight, release on a side channel | `void flight.then(release, release)` | `.then(release, release)` returns a *fulfilled* promise, so `void`-ing it is safe and self-terminating. `void flight.finally(release)` would **re-throw** the flight's rejection onto an unhandled derived promise — reintroducing the exact bug being fixed. |
| the **derived** promise, returned to joiners | `slot = work().finally(release)` | The derived promise *is* what callers await, so its re-rejection is handled by them. Settle-agnostic by construction and unbreakable by an arity mistake. |

`apps/manager/src/lib/swr-cache.ts:51-55` is the in-repo instance of the second row:

```ts
if (refreshPromise) return refreshPromise
refreshPromise = doRefresh().finally(() => {
  refreshPromise = null
})
return refreshPromise
```

Note it correctly has **no identity check** — it returns the existing promise rather than minting a
competing flight, so its slot is not replaceable mid-flight and defense (a) does not apply. Copy the
identity check only when a newer flight can legitimately replace an older one; cargo-culting it into
the swr-cache shape adds a branch that can never be false.

**(c) A joiner-side catch.** Every `await` on the shared slot must be defensive:

```ts
try {
  await entry.inFlight
} catch {
  // Defensive floor: a rejecting flight must not rethrow into callers.
}
```

The joiners did not create the flight and cannot reason about its failure modes. If the surface
advertises a never-throws contract, this catch is what makes that contract true for *joiners* rather
than only for the leader. Fall through to re-deriving from settled entry state plus a terminal
fallback, so the catch is not just a swallow but a route to a defined outcome.

### The sync-prologue rule

**Any synchronous statement placed before the guarded `try` is outside the guard.** This is the
general form of the existing law's insight, and it applies to *every* guarded region, not just slot
callbacks. Audit the prologue for throw sources — and note that the realistic ones are not exotic:

- **Caller-supplied config reads.** A property getter on an injected object can throw. Anything
  reading `config.*`, `input.*`, or an injected `now()` belongs inside the guard. In this file the
  cooldown clamp was moved to be the first statement *inside* the `try`
  (`langfuse-prompt-client.ts:653-663`).
- **Encoding and parsing primitives that throw on hostile-but-reachable input.**
  `encodeURIComponent` throws `URIError` on malformed UTF-16 — a lone surrogate, which a caller
  produces trivially by truncating a name on a UTF-16 index (slicing an emoji in half). `JSON.parse`,
  `new URL(...)`, `decodeURIComponent`, and `BigInt(...)` are the same family.
- **Structured logging.** `JSON.stringify` over a payload with a circular reference or a throwing
  `toJSON`.

Corollary for the failure path: **if a `catch` block re-reads the same inputs that could have thrown
into it, it needs its own nested `try`.** A catch that can itself throw is not a guard. In this file
the defensive catch re-reads `config` and the injected `now()` — the exact plausible throw sources
that landed control there — so the whole bookkeeping block sits in a nested `try`, and the bounded
breadcrumb log inside it sits in yet another (`langfuse-prompt-client.ts:684-717`). The nesting looks
paranoid until you notice that the alternative is a rejecting flight, which is failure mode (b) all
over again.

Two smaller rules from the same region, worth carrying:

- **Write failure state BEFORE logging it.** `entry.cooldownUntil` / `entry.lastFailureReason` are
  assigned, *then* `logPromptFetchFailure(...)` runs (`langfuse-prompt-client.ts:679-683`). A throwing
  log sink then still leaves a coherent state behind for subsequent callers.
- **Never log the caught VALUE on a defensive path.** It is arbitrary and can embed request or body
  fragments. Log an enum-only breadcrumb — one line per *new* cooldown window, not per call — so the
  defensive path is bounded but never fully silent.

### Test discipline

A green suite proved nothing here, because the tests exercised the wrong throw sites.

- The existing slot-leak test threw from **inside** the guarded `try`. That path was always safe.
  You need a test that makes the flight **reject**, or — better, since the design says it can't — a
  test that throws from each **prologue** position: a throwing `config` property getter, a name
  `encodeURIComponent` cannot encode, a throwing injected `now()`.
- Assert **three things**, not one: the call resolves to the fallback; **no unhandled rejection
  fires**; and a *subsequent* call on the same key still refetches (proving the entry is not wedged).
  The wedge is invisible to any single-call assertion.
- Treat a code comment asserting an invariant as an **untested claim** until a test names it. The
  comment here said the flight "cannot manufacture an unhandled-rejection edge" and was wrong in a
  way no reviewer could see without constructing the edge by hand.

## Why This Matters

The three defenses map to three distinct production failures.

**Permanent wedge until process restart.** If the release never runs, `entry.inFlight` holds a
settled promise forever. The `if (!entry.inFlight)` guard at `langfuse-prompt-client.ts:765` is
therefore never true again for that key, so no future call ever refetches. Worse, if the settled
promise is *rejected*, every later `getManagedPrompt` for that key rethrows at
`await entry.inFlight` — an entry that was merely stale becomes an entry that actively throws, and
it stays that way for the life of the Node process. In a long-lived Mastra process serving every
agent, that is one prompt name permanently broken until someone redeploys, with no self-healing TTL
to hide it.

**Unhandled rejection.** `void flight.then(release)` produces a derived promise with no rejection
handler. Under Node's default `unhandledRejection` behavior that terminates the process — meaning a
single malformed prompt name could take down the shared process that runs *every* agent and workflow,
not just the caller that supplied it.

**Silent, unobservable fallback.** The `encodeURIComponent` case is the mildest failure and the
hardest to diagnose. Sitting outside layer 1's `try`, it made layer 1 **reject** in violation of its
documented never-throws contract. Layer 2's defensive catch then swallowed it — no log line, no
`lastFailureReason`, no `reason` on the served result. The caller silently got compiled-in fallback
text with strictly *less* observability than every other failure mode in the system, including plain
network timeouts. A prompt silently reverting to its fallback is a quality regression nobody gets
paged for; it shows up weeks later as "the agent's answers got worse."

Note also that the wedge and the unhandled rejection are the *same omission*. That is what makes
fulfillment-only `.then` worse than it looks: it does not degrade, it compounds.

## When to Apply

Apply the Shape B rules whenever:

- An in-memory map, class field, or module-level variable holds a **promise** that more than one code
  path awaits — request coalescing, single-flight caches, lazy-init memoization, connection or client
  bootstrapping, "only one refresh at a time" token renewal.
- The reserved value is assigned from a function call, so the reservation lands *after* the function
  body starts executing.
- The surrounding surface advertises a never-throws / never-rejects contract.

Apply the **sync-prologue rule** far more broadly — to any `try` block whose purpose is to guarantee
an outcome (release a slot, honor a never-throws contract, always classify a failure). Ask: what runs
before this `try`, and can any of it throw? Then ask the same of the `catch`.

Do **not** move the release out of the work body for Shape A. Fire-and-forget dispatch keeps the
existing law's prescription unchanged.

## Examples

All citations are `apps/mastra/src/services/langfuse-prompt-client.ts` on unmerged PR #1621.

### Reservation and release — the shipped form (`:765-792`)

```ts
if (!entry.inFlight) {
  const flight = refetchManagedPrompt(entry, {
    name,
    resolvedLabel,
    config,
    fetchImpl,
    now,
    logSink,
  })
  entry.inFlight = flight
  // Release on BOTH settlement paths (identity-checked). The flight is
  // designed never to reject, but a fulfillment-only `.then` would turn any
  // slip into the worst outcome: the release never runs (entry wedged on a
  // settled-rejected promise until process restart) AND the derived promise
  // rejects unhandled. Registering the same release as the rejection
  // handler closes both.
  const release = () => {
    if (entry.inFlight === flight) entry.inFlight = undefined
  }
  void flight.then(release, release)
}
try {
  await entry.inFlight
} catch {
  // Defensive floor for the never-rejects contract: a rejecting flight must
  // not rethrow into callers — fall through to serve from entry state or
  // the terminal fallback below.
}
```

Two wrong forms this replaced:

```ts
// WRONG (the plan's prescription, Shape A applied to Shape B):
// release inside refetchManagedPrompt's own `finally`. If the body settles
// synchronously, the finally runs BEFORE `entry.inFlight = flight` lands —
// it deletes an undefined slot, then the assignment wedges the entry on an
// already-settled promise.

// WRONG (shipped, caught in review): fulfillment-only.
void flight.then(release)
// A rejecting flight now (1) never releases — entry wedged, every later
// caller rethrows at `await entry.inFlight` — and (2) leaves an unhandled
// rejection on the derived promise.
```

Note the joiner-side `catch` is deliberately paired with re-deriving the answer from settled state
rather than returning early (`:794-801`): both leader and joiners call
`serveFromState(...) ?? buildFallbackResult(...)` with their **own** fallback, so a swallowed
rejection still produces a defined, provenance-tagged result.

### The refetch body: guard placement (`:629-663`)

The body's own doc comment records why the release is *not* here — the provenance note that made the
region look audited:

```ts
/**
 * SLOT-LEAK GUARD (docs/solutions/best-practices/
 * in-memory-slot-reservation-fire-and-forget-20260506.md): the ENTIRE body
 * sits inside try/catch, so ANY unexpected synchronous throw — the injected
 * log sink is the realistic one — degrades to cooldown/fallback state instead
 * of rejecting the shared flight promise. The slot RELEASE deliberately does
 * not live here: it rides the flight promise in `getManagedPrompt` with an
 * identity check, so it can neither run before the reservation lands (a
 * sync-settling body would otherwise clear the slot first and then wedge the
 * entry on a settled promise) nor clear a newer flight.
 */
async function refetchManagedPrompt(
  entry: ManagedPromptCacheEntry,
  { name, resolvedLabel, config, fetchImpl, now, logSink }: ManagedPromptRefetchArgs,
): Promise<void> {
  try {
    // ... (elided: the "Effective cooldown ≤ TTL" provenance note)
    // Computed INSIDE the try: config is caller-supplied, so even a
    // throwing property getter must degrade to the catch below, not reject
    // the shared flight promise before the guard starts.
    const cooldownMs = Math.min(
      config.promptFailureCooldownMs,
      config.promptCacheTtlMs,
    )
    const result = await fetchLangfusePrompt({ name, label: resolvedLabel, config, fetchImpl }) // ... (call reflowed onto one line)
    ...
```

Before the fix, that `Math.min` over caller-supplied `config` was the **first statement of the
function**, above the `try`. (It was itself introduced by the preceding review round, which added the
re-clamp — so this is a hazard a fix created, not a pre-existing one.) It was the throw source that
made the flight's rejection constructible and
turned the fulfillment-only `.then` from a theoretical omission into a reachable double failure.

### The total catch with its own nested try (`:684-717`)

```ts
} catch {
  // Never log the thrown VALUE: it is arbitrary and could embed anything
  // (leak control). ... The bookkeeping below re-reads the caller-supplied
  // `config` and `now` — the plausible throw sources that landed us here — so
  // it sits in its OWN try: this catch must be total, because a rejecting
  // flight would wedge `entry.inFlight` and rethrow at every joiner's await.
  try {
    const cooldownMs = Math.min(config.promptFailureCooldownMs, config.promptCacheTtlMs)
    if (entry.cooldownUntil === undefined || entry.cooldownUntil <= now()) {
      entry.cooldownUntil = now() + cooldownMs
      try {
        logSink(
          `[langfuse] event=prompt_refetch_unexpected_error name=${name} label=${resolvedLabel}`,
        )
      } catch {
        // A throwing sink must not escape the defensive catch.
      }
    }
  } catch {
    // Even the defensive bookkeeping threw (hostile config getter or
    // throwing now()). Leave the entry untouched — the flight still settles
    // fulfilled and callers land on getManagedPrompt's terminal fallback.
  }
}
```

The breadcrumb is enum-only, carries no caught value, and is emitted once per **new** cooldown window
— bounded, but never fully silent.

### The `encodeURIComponent` prologue fix, layer 1 (`:299-317`)

```ts
// encodeURIComponent: Langfuse prompt names may contain `/` (folder-scoped),
// which must land in the path as `%2F`, not as a route separator. It THROWS
// URIError on malformed UTF-16 (a lone surrogate in the name), so the whole
// URL build sits in its own try to keep the never-throws contract: an
// unencodable name is a permanent CALLER error, returned as non-retryable
// `rejected` — it must not ride the timeout/network classification, and
// neither the name nor the error is echoed into the result (leak control).
let url: URL
try {
  url = endpoint(config.baseUrl, `api/public/v2/prompts/${encodeURIComponent(name)}`) // ... (reflowed)
  // Pass-through only: label resolution/defaulting is layer 2's job.
  if (label !== undefined) url.searchParams.set("label", label)
} catch {
  return { ok: false, reason: "rejected", retryable: false }
}
```

Before the fix the URL build sat above the fetch's `try`, so layer 1 rejected instead of returning a
classified result. Three details in the fixed form are load-bearing: the guard wraps the **whole**
URL build (not just the `encodeURIComponent` call — `endpoint()` and `searchParams.set` can throw
too); the failure is classified `retryable: false` so it cannot enter the retry/cooldown path a
transient network error would; and neither the name nor the error text is echoed into the result.

### The slot field (`:476-489`)

```ts
/**
 * Per-(name, resolvedLabel) cache state. `text`/`version`/`fetchedAt` hold the
 * last successful fetch (Fresh/Expired/StaleServing); `cooldownUntil` +
 * `lastFailureReason` are the failure state (StaleServing/NegativeCached);
 * `inFlight` is the single-flight slot shared by concurrent callers.
 */
type ManagedPromptCacheEntry = {
  text?: string
  version?: number
  fetchedAt?: number
  cooldownUntil?: number
  lastFailureReason?: LangfusePromptFailureReason
  inFlight?: Promise<void>
}
```

`inFlight?: Promise<void>` — a promise other callers await — is the type-level signal that this is
Shape B and the caller-side release rules apply.

## Related

- `docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md` — the law
  this doc scopes. It is correct for Shape A (fire-and-forget dispatch) and its sync-prologue insight
  generalizes to every guarded region; its `try`-as-first-statement *prescription* does not survive
  the move to Shape B. Its "this is not specific to `after()`" generalization is what the plan
  followed into the wrong fix, so that doc wants a scope-boundary note naming the precondition
  (does the reservation land before or after the guarded body starts?).
- `docs/solutions/performance-issues/swr-cache-failure-backoff-manager-20260331.md` — nearest prior
  art by shape: a shared-promise single-flight TTL cache with failure cooldown in `apps/manager`, and
  the source of the correct-alternative-topology example above.
- `docs/solutions/best-practices/settle-orphaned-companion-promise-streaming-early-exit-20260625.md`
  — closest sibling in `apps/mastra`; same early-exit-cleanup-in-async-callbacks family.
- `docs/solutions/conventions/single-service-http-client-result-union-convention.md` — the governing
  convention for `apps/mastra/src/services/*`, where the never-throws contract this doc defends is
  defined.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the META
  home for the test-discipline half: each of the three hazards needs a test that only that hazard can
  fail, and a green suite over the wrong throw sites proved nothing here.
- `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md` and
  `docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md` — the TIME and
  SIZE axes of the same resource-bounding family; a shared flight must obey both.
- PR #1621 (`feat/langfuse-prompt-helper`) — open and unmerged as of 2026-07-22; the source of every
  code citation in this doc.
