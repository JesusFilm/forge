---
title: "Serve-stale caching with a fallback: exit on permanent failure, tag every degraded serve, validate every arm"
date: "2026-07-22"
last_updated: "2026-07-22"
category: "design-patterns"
module: "apps/mastra"
problem_type: "design_pattern"
component: "service_object"
severity: "high"
root_cause: "missing_validation"
resolution_type: "documentation_update"
applies_when:
  - "A cache serves last-known-good text on refetch failure (serve-stale / stale-while-error) with a compiled-in fallback beneath it"
  - "A lower layer already classifies failures as permanent vs transient (404 / 401 / parse errors vs timeouts) and a caching layer above consumes that union"
  - "The cached value becomes INSTRUCTIONS or config for something else (agent system prompts, policy, routing rules) rather than display data"
  - "Operators will reasonably expect deleting or unpublishing the upstream record to act as a kill switch"
  - "The design's stated goal includes provenance-driven alerting on sustained degraded serving"
  - "A config/options type documents a cross-field invariant but is also accepted through an injectable seam, or a defaulting chain has more than one rung"
symptoms:
  - "Deleting the prompt upstream never retracts the already-cached text: StaleServing -> StaleServing for the whole process lifetime, so only re-pointing the label or a restart actually retracts"
  - "`retryable: false` is computed for 404 / 401 / parse_error and consumed by nothing — no code path exits serve-stale on a permanent failure"
  - "`entry.text` is assigned only on a successful refetch and no code path ever clears it, so the cache has no eviction-on-permanent-failure edge at all"
  - "A degraded serve is distinguishable from a healthy one only by a `stale` boolean, with no machine-readable cause — undercutting the same module's stated sustained-fallback alerting goal"
  - "An empty or whitespace-only caller-supplied `fallback` reaches the agent verbatim, arriving through the very layer whose `empty_prompt` check exists to prevent an instruction-less agent"
related_components:
  - "assistant"
tags:
  - "serve-stale"
  - "cache-provenance"
  - "permanent-failure-exit"
  - "fallback-contract"
  - "degraded-serve-observability"
  - "retraction"
  - "managed-prompts"
  - "invariant-placement"
  - "mastra"
---

# Serve-stale-with-fallback caches: exit on permanent failure, attribute every degraded serve, validate every arm

## Context

The shape under discussion is a read-through cache with four stacked behaviors:
a TTL, a failure cooldown, serve-stale during that cooldown, and a
caller-supplied compiled-in fallback when there is nothing cached. It is a very
attractive shape. It gives you upstream-outage tolerance without background
timers, bounds your fetch rate under sustained failure, and guarantees the
caller always gets *something* usable. Every one of those properties is real.

The worked example here is `apps/mastra/src/services/langfuse-prompt-client.ts`
on the **unmerged** branch `feat/langfuse-prompt-helper` (PR #1621, open at time
of writing). **This file is not on `main`** — read it with
`git show origin/feat/langfuse-prompt-helper:apps/mastra/src/services/langfuse-prompt-client.ts`.
All line references below are to that revision. The module is two layers: layer
1 (`fetchLangfusePrompt`) is a single-attempt typed HTTP client over Langfuse's
v2 Prompts API; layer 2 (`getManagedPrompt`) is the cache described above. The
module is unusually well-documented and unusually carefully reasoned — its
header spells out its own state machine, and its slot-leak and leak-control
guards cite prior solution docs. That is precisely what makes it a good example:
**these three gaps are not sloppiness.** Be precise about how much was
deliberate, though, because it is less than it first appears: exactly **one** of
the three (Law 2's) is documented in the module as a conscious choice. For Law 1
the header documents a deliberate *adjacent* decision — not retrying in layer 1 —
which is correct on its own terms and simply never contemplated the separate
question of exiting serve-stale. Law 3 is not addressed anywhere. So the honest
reading is: one considered trade-off, one blind spot created by an adjacent
decision's framing, and one omission. All three are consequences of the shape,
and all three are invisible for as long as the upstream is healthy.

That last point is the whole reason to write this down. Every one of these gaps
requires the upstream to be *both* reachable-in-principle *and* returning
something other than success before it manifests. In development, in CI, and in
the first weeks of production, none of them fire.

## Guidance

Three laws for any cache of this shape.

### Law 1 — branch serve-stale on failure permanence, and define what "give up on stale" means for your domain

A serve-stale cache must distinguish *the upstream is temporarily unreachable*
from *the upstream has answered, definitively, and the answer is that this value
is gone or you may not have it*. Only the first justifies continuing to serve
last-known-good.

Layer 1 already classifies this. It computes `retryable: false` for permanent
conditions and `retryable: true` for transient ones:

- `auth_failed` (401/403) → `retryable: false` (`:238-245`)
- other 4xx incl. 404 → `reason: "rejected"`, `retryable: status >= 500` i.e.
  false (`:256-262`)
- `rate_limited` (429) → `retryable: true` (`:247-255`)
- 5xx → `network_error`, `retryable: true` (`:256-262`)
- `timeout` / `network_error` from a throw → `retryable: true` (`:341-345`)
- `config_missing`, `parse_error`, unencodable-name `rejected` →
  `retryable: false` (`:274-297`, `:306-317`, `:357-398`)

Layer 2 never reads the flag. `refetchManagedPrompt`'s failure branch is a
single unconditional path (`:679-683`):

```ts
// Failure state FIRST, log SECOND: a throwing log sink must still leave a
// coherent cooldown behind so subsequent calls serve from state.
entry.cooldownUntil = now() + cooldownMs
entry.lastFailureReason = result.reason
logPromptFetchFailure(name, resolvedLabel, result, logSink)
```

Every failure class — a 404 for a prompt an operator just deleted, a 401 from a
revoked key pair, a network blip — produces the identical state transition.

**The important nuance: declining to *retry* on `retryable` was correct and
deliberate.** The module header says so at `:50-54`:

> `SINGLE ATTEMPT: one request per call, `AbortSignal.timeout`, no
> retry/backoff. The cached helper layer (layer 2, `getManagedPrompt`, below in
> this module) owns fetch frequency via TTL + failure cooldown; retrying here
> would multiply its refetch attempts. The `retryable` flag stays on the failure
> union for type parity and logging even though no caller retries.`

That reasoning is sound. Layer 2 owns fetch frequency; a retry loop inside layer
1 would multiply attempts underneath the cooldown that is supposed to bound
them. The gap is that a **third** use of the flag was never on the table. The
question "should we retry on this?" and the question "should we keep serving the
old value in the face of this?" are different questions with different answers,
and the retry-or-not framing hides the second one entirely. `retryable` reads as
a retry-policy input, so once you decide not to retry, the flag looks fully
handled.

The consequence is concrete. `entry.text` is written in exactly one place — the
success branch of `refetchManagedPrompt` (`:670-677`) — and no path anywhere in
the module clears it. Combined with the unconditional cooldown, an operator who
deletes the prompt upstream (the instinctive "kill it now" action) gets a
permanent 404, which starts a cooldown, which serves stale, which lapses, which
refetches, which 404s again. The state machine documented at `:426-429` says it
plainly:

```
 *   Expired -> StaleServing: refetch fails (serve stale, start cooldown)
 *   StaleServing -> StaleServing: within cooldown (serve stale, no fetch)
 *   StaleServing -> Fresh: cooldown over, refetch ok
 *   StaleServing -> StaleServing: cooldown over, refetch fails (restart cooldown)
```

There is no arrow out of `StaleServing` except success. The process serves the
deleted text until restart. The only retraction that actually works is
re-pointing the label to a different version — which is a non-obvious operator
move and the opposite of what deletion feels like it should do.

**Decision table.** For any cache of this shape, decide each row explicitly:

| Upstream outcome | Classification | Refetch? | Serve stale? |
|---|---|---|---|
| Timeout / connection error | transient | yes, after cooldown | yes |
| 5xx | transient | yes, after cooldown | yes |
| 429 rate-limited | transient | yes, after cooldown (respect Retry-After if present) | yes |
| 404 / value deleted upstream | **permanent** | yes, after cooldown (it may come back) | **no — after N windows, degrade to fallback** |
| 401/403 auth revoked | **permanent** | yes, after cooldown | **no — credentials revoked is a retraction signal** |
| Parse/validation failure on a 200 | **permanent (upstream content is bad)** | yes | **domain call — the value exists but is unusable** |
| Config missing | permanent, process-scoped | no point | n/a — nothing was ever cached |

"Degrade after N windows" is the cheap version and is usually right: it keeps a
transient misclassification from causing an instant outage, while guaranteeing
the system converges to the compiled-in default within a bounded time. A
stale-age ceiling (`serve stale only while `now - fetchedAt < maxStaleMs`) is
the other reasonable shape. The unacceptable option is the implicit one:
unbounded stale-serving with no exit.

### Law 2 — attach cause to every degraded serve, not just fallback serves

A degraded serve should be self-describing. If a caller (or a span, or an alert)
receives a value, it should be able to answer *why* this value and not the fresh
one — without correlating against logs.

Here, only half the degraded surface carries cause. `buildFallbackResult`
threads the layer-1 reason (`:576-588`):

```ts
function buildFallbackResult(
  fallback: string,
  resolvedLabel: string,
  reason: LangfusePromptFailureReason | undefined,
): ManagedPromptResult {
  const result: ManagedPromptResult = { text: fallback, source: "fallback", resolvedLabel }
  if (reason !== undefined) result.reason = reason
  return result
}
```

`buildManagedResult` does not — its signature has no `reason` parameter at all
(`:560-574`), only a `stale: boolean`:

```ts
function buildManagedResult(
  text: string,
  version: number | undefined,
  resolvedLabel: string,
  stale: boolean,
): ManagedPromptResult {
  const result: ManagedPromptResult = { text, source: "langfuse", resolvedLabel }
  if (version !== undefined) result.version = version
  if (stale) result.stale = true
  return result
}
```

So in `serveFromState`'s cooldown branch (`:611-616`), the stale serve and the
fallback serve are asymmetric even though the entry holds
`lastFailureReason` in both cases (`:482-489`):

```ts
if (entry.cooldownUntil !== undefined && nowMs < entry.cooldownUntil) {
  if (entry.text !== undefined) {
    return buildManagedResult(entry.text, entry.version, resolvedLabel, true)
  }
  return buildFallbackResult(fallback, resolvedLabel, entry.lastFailureReason)
}
```

**This is documented and the reasoning is coherent.** Header, `:440-442`:

> `STALE IS MANAGED TEXT: serving an expired entry during a failure cooldown is
> `source: "langfuse"` + `stale: true` — it IS managed text. Only the fallback
> path carries the machine-readable layer-1 `reason`.`

That is a defensible modelling choice: stale managed text *is* managed text; it
came from the upstream, it has a real `version`, and calling its source
`"fallback"` would be a lie. The `reason` field is scoped to "why are you
serving the compiled-in default", and by that definition a stale serve has no
reason to carry.

The consequence is what to notice. A degraded serve is distinguishable from a
healthy one **only by a boolean, with no cause attached** — and the boolean is
optional-and-absent on the healthy path, so it is easy to not check. That
undercuts the module's own stated goal. The follow-up ticket's silent-divergence
risk names "provenance in the return type" as the designed hook for
sustained-fallback alerting, and its work item 5 defines that alerting as firing
when production serves `source: "fallback"` beyond a threshold. Stale serves are
`source: "langfuse"`. **The alerting design, as specified, does not see them at
all** — and a stale serve is exactly the state you most want paged on, because
under Law 1's gap it can persist indefinitely.

The general law: *degraded* is a property of the serve, not of which text
happened to win. Whatever field carries "why is this degraded" must be populated
on every degraded path, or your alerting will have a blind arm.

### Law 3 — when two arms feed the same sink, validate at the sink or validate both arms; never one

Layer 1 rejects a whitespace-only prompt body outright (`:390-398`):

```ts
if (prompt.trim().length === 0) {
  return { ok: false, reason: "parse_error", retryable: false, status: response.status, detail: "empty_prompt" }
}
```

and the guard states its own justification a few lines above (`:368-370`):

> `Content validation (plan KTD6): the fetched text becomes agent instructions
> verbatim, so anything that is not a usable text prompt is a failure with a
> distinguishing detail — never ok.`

That reasoning applies to the fallback with equal force — the fallback text also
becomes agent instructions verbatim — but the fallback receives no such check.
`buildFallbackResult` (`:576-588`) passes the caller-supplied string through
unexamined, and the input type documents the intent without enforcing it
(`:501`): `/** Compiled-in text served (with `reason`) whenever no managed text exists. */`.

So the failure mode is: a caller wires up a stub or empty-string fallback, the
upstream is momentarily unavailable, and the agent runs with no instructions —
arriving through the very code path built to prevent an instruction-less agent.
The guard exists, it is correct, and it is on the wrong side of the fork.

The generalization is the useful part. Draw the sink (here: "text that becomes
agent instructions"), enumerate every arm that reaches it, and put the invariant
either at the sink itself or on every arm. An invariant enforced on one arm of a
fork is not an invariant; it is a coincidence that holds while that arm is the
common case. This is the same failure shape as the mocked-shape-vs-real-contract
discipline documented elsewhere in `docs/solutions/`: a guard that is never
exercised on the path that actually matters gives the reassurance without the
protection.

#### Law 3 also covers *construction* paths, not just value arms

An "arm" need not be a branch in a data flow. A **construction path** is an arm
too, and the same module supplies two more instances — both about a guarantee
that holds on the intended path and lapses on an available one.

**A factory-only invariant is a suggestion once the type is injectable.**
`LangfuseConfig.promptFailureCooldownMs` carries a doc comment stating the
guarantee outright — *"Clamped to promptCacheTtlMs — the smaller value always
wins"* (`apps/mastra/src/config/env.ts:112`) — and exactly one place enforces it,
the `Math.min(...)` inside `getLangfuseConfig()` (`env.ts:1061-1064`). But
`config` is an injectable parameter, so any hand-built `LangfuseConfig` bypasses
the clamp while still satisfying the type. This is not a theoretical path: in
`langfuse-prompt-client.test.ts` there are **12** spread-and-override
constructions (`{ ...testConfig, ... }`), **48** `config:` sites in total, and
**zero** calls to `getLangfuseConfig()`. The factory that enforces the invariant
is never exercised by the suite at all — so a fully green run carried no signal
about the guarantee its own type comment advertises. Review fixed this by
re-clamping at the point of use (`langfuse-prompt-client.ts:660-663`,
`:694-697`), defensive redundancy that is idempotent for env-derived configs.

**Normalizing one rung of a resolution chain is normalizing none of it.** Env
values pass through an `emptyToUndefined` helper, so an empty
`LANGFUSE_PROMPT_DEFAULT_LABEL` correctly becomes `undefined`. The resolution is
`label ?? config.promptDefaultLabel ?? "production"` (`:751`) — and the
*call-parameter* rung has no equivalent normalization. `""` is not nullish, so it
wins the whole chain: a phantom `""` cache entry is minted and a literal `?label=`
goes on the wire (the wire guard at `:314` tests `!== undefined`, which `""`
passes). The fix shape is `(label?.trim() || undefined) ?? …`. This one was
deferred rather than fixed, there being no live callers.

The audit that catches all four instances is the same: **name the invariant, then
enumerate every path that can produce a value subject to it** — every branch,
every constructor, every rung of every defaulting chain — and ask which of them
enforce it. Prefer making the violation unrepresentable (a branded type, or a
constructor that is the only way to obtain the type) over enforcing it in *n*
places; where that is impractical, enforce idempotently at the point of
consumption, which is the one place all paths converge.

## Why This Matters

Three operator-facing consequences, one per law.

**"I deleted it, why is it still live?"** Deleting the upstream record is the
universal panic action. If your cache treats deletion as an outage, the panic
action does nothing, the operator escalates, and someone eventually discovers
that the real retraction path is something non-obvious (here: re-point the label
to a different version, or restart the process). This is worse than having no
cache, because the operator's mental model — *the upstream is the source of
truth; changing it changes behavior* — is now silently false, and nothing in the
UI says so.

**Silent quality regression nobody pages for.** A stale serve is degraded
service that reports itself as healthy managed text. Nothing pages. Nothing in a
dashboard changes colour. The prompt an operator tuned last week is not the
prompt in production, and the only evidence is a bounded log line at the moment
of the failed refetch — a line you have to already know to look for. Combined
with the Law 1 gap, this is unbounded in time.

**Instruction-less agent.** An empty fallback is not a hypothetical: fallback
text is compiled-in, so it is the thing most likely to be stubbed during wiring
("TODO: paste the real prompt") and least likely to be re-checked, because it
only ever executes when the upstream is down — which by construction is not when
anyone is testing. The blast radius is an agent running with no persona, no
safety line, and no citation contract.

## When to Apply

Any read-through / stale-while-error cache over a **mutable** upstream where the
cached value has correctness consequences:

- managed prompts and agent instructions (this example)
- feature flags and remote config — see the fail-closed-by-construction gate doc
  in `docs/solutions/architecture-patterns/` for the flag-specific companion law
- pricing tables, entitlement and allowlist data
- key/credential material and JWKS documents (where "deleted upstream" is
  literally a revocation)
- schema/registry lookups, routing tables, A/B assignment maps

The tell that you need all three laws: someone upstream can *retract* a value,
and your cache's only defined way to change behavior is a successful fetch of a
*different* value.

Conversely, these laws are much weaker for caches over immutable,
content-addressed upstreams (a blob keyed by hash cannot be retracted into a
different meaning), and for caches whose staleness is bounded by something other
than upstream success.

## Examples

All references: `apps/mastra/src/services/langfuse-prompt-client.ts` on
`origin/feat/langfuse-prompt-helper` (PR #1621, unmerged).

**The ignored classification.** Layer 1 assigns `retryable` at thirteen sites
(`:242`, `:251`, `:259`, `:278`, `:286`, `:294`, `:316`, `:343`, `:345`, `:363`,
`:377`, `:386`, `:394`), and the field is on the public failure type
(`:84-91`). Layer 2's only failure handling (`:679-683`) reads
`result.reason` — never `result.retryable`.

**The missing exit.** `ManagedPromptCacheEntry` (`:482-489`) holds `text`,
`version`, `fetchedAt`, `cooldownUntil`, `lastFailureReason`, `inFlight`. Only
the success branch at `:670-677` writes `entry.text`; nothing clears it. The
header's state machine (`:418-432`) confirms the absence structurally —
`StaleServing` has two self-loops and exactly one exit, `refetch ok`.

**The unattributed stale serve.** `serveFromState` `:611-616` (quoted above),
against `ManagedPromptResult` at `:463-474` where `stale?: boolean` and
`reason?: LangfusePromptFailureReason` are independent optional fields and no
code path sets both.

**The asymmetric guard.** `empty_prompt` at `:390-398` vs `buildFallbackResult`
at `:576-588`. Also note the terminal fallback at `:798-801`, which is a third
site serving caller text unexamined:

```ts
return (
  serveFromState(entry, now(), config, resolvedLabel, fallback) ??
  buildFallbackResult(fallback, resolvedLabel, entry.lastFailureReason)
)
```

### Proposed fix shape — NOT IMPLEMENTED

The code was **not changed**. What follows is a sketch of the shape a fix would
take, offered so the ticket's "decide retraction semantics during wiring" has a
starting point. It is a proposal, not an API that exists.

*Before* (current, `refetchManagedPrompt` failure branch):

```ts
entry.cooldownUntil = now() + cooldownMs
entry.lastFailureReason = result.reason
```

*After* (proposed) — count consecutive permanent failures and drop stale text
once the count crosses a bound:

```ts
entry.cooldownUntil = now() + cooldownMs
entry.lastFailureReason = result.reason
if (result.retryable) {
  entry.permanentFailures = 0
} else {
  entry.permanentFailures = (entry.permanentFailures ?? 0) + 1
  if (entry.permanentFailures >= config.promptStaleRetractAfter) {
    // Upstream has definitively answered N times. Stop asserting the old text.
    entry.text = undefined
    entry.version = undefined
    entry.fetchedAt = undefined
  }
}
```

with a matching success-branch reset (`entry.permanentFailures = 0` alongside
the existing clears at `:675-676`), a `reason` parameter threaded into
`buildManagedResult` so the stale branch at `:613` can pass
`entry.lastFailureReason`, and an emptiness guard at the sink — checked once in
`buildFallbackResult` rather than at each of its call sites, since that is the
single funnel every fallback serve passes through. Any new knob follows the
established rule that opt-in scaffolding env vars are `.optional()` with a
runtime default.

## Disposition — what shipped vs what was deferred

**Nothing in the code changed.** All three findings were written up as
constraints on the follow-up ticket,
`docs/roadmap/ai-chat/feat-272-seeker-langfuse-managed-prompt-integration.md`,
to be resolved during wiring:

- Law 3 landed as an explicit Constraints bullet (review finding #8): *"The
  caller-supplied `fallback` must always be the full working prompt and never
  empty — layer 2 deliberately serves it verbatim with no emptiness guard
  (asymmetric with layer 1's `empty_prompt` rejection). Pin a non-empty fallback
  in the wiring tests."*
- Law 1 landed as an explicit Constraints bullet (review finding #9): *"Serve-stale
  means DELETING a managed prompt in Langfuse does not retract already-cached
  text until process restart — layer 2 ignores `retryable` and keeps serving
  stale through non-retryable 404/401 failure windows. Decide retraction
  semantics during wiring: degrade stale-serving after N non-retryable cooldown
  windows, or document label re-pointing as the only retraction path."*
- Law 2 is carried only indirectly — by the ticket's "silent divergence" risk
  paragraph and work item 5 (sustained-fallback alerting). Note that item 5 as
  written keys on `source: "fallback"`, which is precisely the formulation that
  misses stale serves. Whoever implements it should widen the trigger, or the
  alerting will ship with the blind arm intact.

**This is a legitimate call.** The helper has zero production callers — the
plan's no-wiring gate holds, nothing in `apps/mastra/src/mastra/` imports it —
so none of the three gaps can currently harm anything, and fixing them
speculatively would mean guessing at semantics (how many windows? what stale
ceiling?) that the wiring work will answer properly.

**It is also the risk worth naming.** Deferring converted three code guarantees
into three prose obligations that a future implementer must read and honor. A
guard in `buildFallbackResult` protects every caller forever; a Constraints
bullet protects only the callers whose author read the ticket. The
prose-obligation form is fine when the ticket is the mandatory next step, as it
is here — but it decays the moment the helper is consumed by anyone who arrived
via the module's (excellent) header comment rather than via feat-272.

## Related

- `docs/solutions/design-patterns/async-single-flight-slot-release-hazards.md` — the **concurrency
  axis** of the same module (releasing the single-flight slot). Disjoint from this doc's degradation
  semantics; read both before changing `getManagedPrompt`.
- `docs/solutions/tooling-decisions/langfuse-prompt-api-contract-and-sdk-rejection.md` — the
  **vendor-contract axis** of the same module, including which SDK semantics were adopted. Note that
  the "fallback-with-provenance" semantic it records as adopted is, per Law 2 here, adopted on the
  *fallback arm only* — the stale arm carries no cause.
- `docs/solutions/performance-issues/swr-cache-failure-backoff-manager-20260331.md` — the structural
  sibling in `apps/manager`, covering the **inverse** failure (retry storm during a transient
  outage). Its "should model three states explicitly: fresh, stale, and stale-after-failure" rule is
  only partly sufficient against Law 1: it too never clears the cached value and its cooldown is
  retryability-blind — but unlike the Langfuse cache it *does* implement a Law 1 exit, a stale-age
  ceiling (`maxStaleMs`, `apps/manager/src/lib/swr-cache.ts:63` and `:70-74`, which throws rather
  than serving stale past the ceiling). Age-based and permanence-based exits are complementary, not
  substitutes: a ceiling bounds how long a wrong value survives, while retryability decides whether
  it should have survived at all.
- `docs/solutions/architecture-patterns/fail-closed-by-construction-feature-flag-gate-20260708.md` —
  the same principle solved correctly in another domain. Its `booleanVariationDetail` returns
  `{ value, source }` so `ld_unavailable` is distinguishable from `not_targeted` — exactly Law 2,
  and exactly what the stale arm here lacks. Note the polarity differs (fail-closed there,
  serve-last-known-good here), so the shapes rhyme rather than transfer wholesale.
- `docs/solutions/runtime-errors/silent-semantic-search-degradation-missing-openrouter-key-20260415.md`
  — why graceful degradation must still emit a signal.
- `docs/roadmap/ai-chat/feat-272-seeker-langfuse-managed-prompt-integration.md` — the consuming
  ticket carrying all three gaps as constraints. Like the client, it exists **only** on
  `origin/feat/langfuse-prompt-helper`, not on `main`.
- PR #1621 (`feat/langfuse-prompt-helper`) — open and unmerged as of 2026-07-22; source of every code
  citation here. All three gaps were recorded as constraints on the follow-up ticket rather than
  fixed in code, justified by zero production callers.
