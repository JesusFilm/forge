---
title: "Fail-closed-by-construction feature-flag gating for a paid or sensitive path"
date: "2026-07-08"
category: "architecture-patterns"
module: "@forge/feature-flags (original exemplar: apps/chat seeker gate, retired by feat-239)"
problem_type: "architecture_pattern"
component: "authentication"
severity: "high"
related_components:
  - "feature-flags"
  - "apps/chat"
  - "launchdarkly"
applies_when:
  - "A LaunchDarkly (or similar) boolean flag decides access to a paid, rate-limited, or otherwise sensitive upstream"
  - "The safe default is DENY and no failure mode may accidentally GRANT"
  - "The gate is awaited on a surface where a throw does not degrade to the safe default — it crashes or fails open (an RSC page, an SSE stream, a middleware)"
tags:
  - "launchdarkly"
  - "feature-flags"
  - "fail-closed"
  - "gating"
  - "authorization"
  - "chat"
  - "sse"
---

# Fail-closed-by-construction feature-flag gating for a paid or sensitive path

## Context

> **Exemplar status (2026-07-08, feat-239):** the feat-233 chat gate this
> learning was written from has since moved off LaunchDarkly — chat's
> membership source is now the `SEEKER_ALLOWED_EMAILS` env CSV, and chat's LD
> client was deleted. The pattern below remains the recipe for any future
> LD-gated paid/sensitive path: pieces 1, 2, and 4 live on in
> `@forge/feature-flags` (`booleanVariationDetail`, ERROR-before-value
> routing, the wrapped construction path — their tests now fixtured on
> `watchPlayerMigration`); pieces 3 and 5 (override withholding, events-off)
> currently have no live consumer instance and stand here as pattern guidance.

feat-233 gated a real AI agent ("seeker") behind a per-user LaunchDarkly
allowlist: allowlisted dogfooders get the agent, everyone else gets a stub.
Each granted turn is a ~90s paid LLM generation on a world-reachable endpoint,
so the gate's one non-negotiable property is **fail closed** — an unreachable
LaunchDarkly, a missing SDK key, an evaluation error, or a thrown client init
must resolve to _deny_, and a leftover override env must stay inert in deployed
builds. None of them may grant.

"Fail closed" is usually left to **operator discipline** ("remember to set the
default variation to deny"). That is fragile: one config mistake, one uncaught
throw, one leftover env var flips it open. This learning is the set of wiring
choices that make fail-closed a **property of the code on the fallback side** —
so no failure mode (outage, missing key, evaluation error, thrown init) and no
app-side env or build config flips the gate open when LaunchDarkly does not
genuinely answer. It does _not_ cover the flag's own dashboard configuration,
which stays operator-governed by design — see the boundary note under Net
effect. The shared flag foundation this builds on is
`docs/solutions/platform/launchdarkly-feature-flag-foundation-20260527.md`;
this doc is the _gating_ layer on top of it.

## Guidance

Five composable pieces. Each closes one way a naive flag gate leaks open.

### 1. Outcome-preserving evaluation — return `{ value, source }`, not just a boolean

A `booleanVariation` that collapses every failure into a fallback boolean
throws away the distinction between "LaunchDarkly genuinely answered false"
(the user is really untargeted) and "the fallback chain resolved false"
(LaunchDarkly never answered — outage, cold start, missing key). The gate needs
that distinction to log an accurate, operator-actionable outcome and to know a
false is a real deny vs a transient unavailability.

Add a detail variant that returns the provenance alongside the value, and make
the plain boolean delegate through it so existing callers are unchanged:

```ts
export type FeatureFlagVariationSource = "launchdarkly" | "override" | "default"
export type BooleanVariationDetail = { value: boolean; source: FeatureFlagVariationSource }

// booleanVariation becomes a thin wrapper:
async booleanVariation(flag, context) {
  const { value } = await booleanVariationDetail(flag, context)
  return value
}
```

The consumer maps `{ value, source }` to distinct outcome codes
(`granted` / `not_targeted` / `ld_unavailable`), which is what lets an operator
classify a stub report from logs alone.

### 2. Route in-provider ERROR resolutions to the fallback BEFORE the value check (honest attribution)

The SDK's `boolVariationDetail` does **not throw** on an in-LaunchDarkly error
(missing flag, archived flag, client-not-ready, wrong type). It _resolves the
passed default_ and marks the resolution with `reason.kind === "ERROR"`. A plain
`variation()` call, or a detail call that checks the value before the reason,
would stamp `source: "launchdarkly"` on a resolution LaunchDarkly never actually
computed. Branch on the reason first:

```ts
const detail = await client.boolVariationDetail(flag.key, ctx, fallback.value)
if (detail.reason?.kind === "ERROR") return fallback // attribute to fallback, not a fake LD answer
return typeof detail.value === "boolean"
  ? { value: detail.value, source: "launchdarkly" }
  : fallback
```

Branch on `kind === "ERROR"` **alone** — the SDK types `errorKind` as a plain
optional string, so `FLAG_NOT_FOUND` / `MALFORMED_FLAG` / `CLIENT_NOT_READY` /
`WRONG_TYPE` are illustrative, not a closed set to enumerate.

**What this does and does not do.** It does _not_ prevent a grant — that is piece
1's job (the fallback resolves to the fail-closed default, which for this gate is
`false`, so a missing/archived flag denies regardless of the reason/value
ordering). What it prevents is a **mis-attributed outcome**: because the errored
resolution carries the passed default as its value, checking the value first
would report `source: "launchdarkly"` and log `not_targeted` (a real deny) when
the truth is `ld_unavailable` (a transient non-answer). It is also a defensive
guard — should the fallback default ever be misconfigured to `true`, the ordering
keeps the grant attributed to `override`/`default` (which Verification row 4's
override-unset check flags) rather than laundering it as a genuine LD hit.

### 3. Withhold the local override from the deployed client (dev-only)

The shared package consults the flag's env override (`FORGE_*_DEFAULT`) _before_
the default on every failure path, in every environment. That override is a
local-dev affordance — but on a fail-closed gate it is also the one env var that
can only ever _grant_. So the consumer must not expose it to the deployed
client: pass `localEnv` **only** in development.

```ts
localEnv: nodeEnv === "development"
  ? { FORGE_CHAT_SEEKER_DOGFOOD_DEFAULT: overrideEnvValue }
  : {},                                  // deployed builds never see the override
```

This is a deliberate divergence from prior art that passes overrides
unconditionally. It makes "a leftover override in production cannot grant seeker"
a wiring property. (How the build pins this on Next.js: the `nodeEnv ===
"development"` comparison is on a variable, so the dev branch is _not_
dead-code-eliminated — it ships in the production bundle. But its **input** is a
build constant. The consumer's `env` object is parsed from a bare
`process.env.NODE_ENV` read, and Next.js's define plugin substitutes
`process.env.NODE_ENV` → `"production"` at that read site in a production build
(server compiler included). So `nodeEnv === "development"` is always `false` in a
deployed Next build, and a Railway `NODE_ENV=development` service var set at
runtime cannot flip it — the read was already inlined away at build. The
guarantee is therefore **structural on Next.js**; the operational pre-flip check
is defense-in-depth there, and becomes genuinely load-bearing only on a runtime
that does **not** inline `process.env.NODE_ENV` — e.g. a plain-Node consumer of
this package.)

### 4. Wrap the WHOLE client path so the gate never throws — including construction

The gate helper is awaited on surfaces that do not degrade gracefully on a throw:

- an **RSC page** with no `error.tsx` — a throw renders Next's generic error
  page, replacing the whole UI instead of showing the safe stub;
- an **SSE `ReadableStream.start()`** whose body has only a `finally` (no
  `catch`) — a throw closes the stream **frameless**, so the client shows a
  generic failure notice, not the intended stub.

So the flag client's contract must be _never throws; always resolves to the
fallback_. The easy-to-miss gap is **client construction/init**, which sits
_before_ the evaluation try/catch — every other failure (init timeout, eval
throw, non-boolean) is wrapped, but a synchronous throw from `getClient()` /
`init()` escapes. Wrap it too, and check the init-failure cooldown _before_
construction so a persistently-throwing init backs off instead of re-attempting
every request:

```ts
if (!sdkKey) return fallback
const retryAt = initFailureRetryAt.get(sdkKey)
if (retryAt && Date.now() < retryAt) return fallback   // cooldown BEFORE construction
let client
try { client = getClient(sdkKey, options) }            // construction can throw — catch it
catch (error) { armCooldown(sdkKey); warn(...); return fallback }
```

Because the client contract is now "never throws," the gate helper itself needs
**no** try/catch — adding one there would invent an unspecified branch. Fix the
throw at the single chokepoint (the shared client), which fixes it for every
caller at once. This stance is only as strong as the contract: it holds while the
package's construction-throw and init-failure tests pin "never throws" — and that
contract was already violated once (construction sat outside the try), so treat
those tests as load-bearing, not incidental. If the chokepoint ever loses that
coverage, the awaiting surfaces need their own guard again.

### 5. Disable analytics events so the gate never ships identity to the vendor

The evaluation context keys on the user's normalized email (individual
targeting needs the key to match the target). To keep that PII out of the
vendor's analytics, pass `sendEvents: false` on the client — that is the option
that suppresses shipping evaluation contexts. (`diagnosticOptOut: true` is worth
pairing but does a different job: it silences the SDK's own health/diagnostic
pings, not context data.) Targeting sync is unaffected (events are telemetry
only).

The trade-off compounds: events-off empties not just the dashboard's evaluation
counts but its **Contexts list**, so an operator can't pick a target from a
seen-contexts autocomplete — each individual target must be hand-typed as the
_exact_ normalized email (trimmed, lowercased), and a typo denies silently as
`not_targeted`. Because the log line carries the opaque `sub`, not the evaluated
key, it can't reveal the mistyped email either. So a new target is verified the
only way left: send a message and confirm an `outcome=granted source=launchdarkly`
line appears.

### Net effect

An unreachable LaunchDarkly, a missing key, an eval error, a thrown init, an
archived flag, or a leftover override env each resolve to the fallback = **deny**.
On the _fallback side_, fail-closed is a property of the wiring, not of
remembering to configure it.

**Boundary — the one grant surface the code cannot close.** A genuine LD answer
is trusted by construction: a non-ERROR resolution returns `source: "launchdarkly"`
and the consumer maps `value === true → granted`. So the flag's own dashboard
configuration — the off-variation set to on, a fallthrough or targeting rule, a
percentage rollout, or a caller-supplied `defaultValues` entry that flips the
package fallback to `true` — grants every verified signed-in user, and none of
the five pieces prevent that. That surface is exactly the _operator discipline_
this pattern otherwise replaces, so it needs its own control: the launch
invariant of **zero targeting rules** confirmed at every edit, plus **targeting-
write access restricted to a named operator group**. The pattern makes the
fallback structural; the dashboard stays operator-governed by design.

## Why This Matters

Three ways a naive gate goes wrong on a paid/public surface — a silent grant, a
loud crash instead of a safe stub, and a mislabeled outcome:

- An unconditional override means a Railway env var left set (or copied from a
  dev template) grants everyone — this is the real silent-grant path, and
  withholding the override (piece 3) is what closes it.
- An uncaught `init()` throw doesn't just fail — on the RSC/SSE surfaces it
  _crashes instead of degrading_: the page renders Next's error page, the stream
  closes frameless, and neither shows the safe stub. It does not grant, but it
  denies loudly and badly rather than quietly falling back to the stub.
- `variation()` (or value-before-reason) _mis-attributes_ a missing/archived
  flag rather than granting it: the SDK returns the passed default on an
  in-provider error, so the value is still the fail-closed `false` (it denies),
  but the outcome is logged as `not_targeted` — a real deny — hiding the
  `ld_unavailable` truth an operator needs. (It would become a _grant_ only if
  the fallback default were misconfigured to `true`; the false default, not the
  ordering, is what prevents that.)

Each is a config- or deploy-time mistake that "test it in staging" won't catch,
because the wrong state only appears under a specific misconfiguration. Making
the safe outcome structural removes the reliance on nobody ever making that
mistake.

The `{value:true, reason:ERROR}` attribution test is also a worked instance of
the mocked-shape-vs-real-contract discipline
(`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`):
the ERROR-before-value branch is only _proven_ by a test where the errored
resolution carries `value: true`, because a `value: false` test passes whether
the reason check runs before or after the value check — delete the branch and it
stays green. Note the shape is deliberately defensive: the SDK returns the
_passed default_ on an ERROR, so it only ever yields `value: true` on an ERROR
when the default passed in is `true` — which a false-default gate never does in
production. The test exercises the guard, not a production path.

## When to Apply

- A boolean flag gates a paid, rate-limited, or sensitive upstream and the safe
  default is deny.
- The evaluation runs on a surface where a throw does not degrade to a safe
  default — it crashes or fails open (RSC page, SSE/stream handler, request
  middleware, edge function).
- You are adding a new consumer to a shared flag package whose override-fallback
  behavior was designed for a benign UI toggle (fail-_open_ is fine there) — the
  gate's threat model is the opposite, so the override handling must change.

Do **not** copy the benign-toggle prior art (unconditional override, plain
`booleanVariation`, no construction guard) onto a gate — that prior art is
correct for its own fail-open use case and wrong for this one.

## Examples

**Outcome mapping in the consumer** — `evaluateFlagDetail` is the gate helper's
injected evaluator, defaulting to the package's `booleanVariationDetail`:

```ts
const { value, source } = await evaluateFlagDetail(context)
const outcome = value
  ? "granted"
  : source === "launchdarkly"
    ? "not_targeted" // LD really answered false
    : "ld_unavailable" // fallback chain resolved false
```

**Branch-unique test for the ERROR-before-value ordering (attribution guard):**

```ts
it("routes an in-LD ERROR resolution to fallback even when its value is true", async () => {
  const ldClient = {
    /* ... */
    boolVariationDetail: async () => ({
      value: true,
      reason: { kind: "ERROR", errorKind: "FLAG_NOT_FOUND" },
    }),
  }
  await expect(client.booleanVariationDetail(flag, ctx)).resolves.toEqual({
    value: false,
    source: "default",
  }) // NOT { value: true, source: "launchdarkly" }
})
```

**Construction-throw test (proves the never-throw contract holds through init):**

```ts
it("falls back and arms the cooldown when client construction throws", async () => {
  const initClient = vi.fn(() => {
    throw new Error("init exploded")
  })
  // Must resolve, never throw: the gate surfaces await this without a catch.
  await expect(client.booleanVariationDetail(flag, ctx)).resolves.toEqual({
    value: true,
    source: "override",
  })
  await expect(client.booleanVariationDetail(flag, ctx)).resolves.toEqual({
    value: true,
    source: "override",
  })
  expect(initClient).toHaveBeenCalledOnce() // cooldown short-circuits the second call
})
```

## Related

- `docs/solutions/platform/launchdarkly-feature-flag-foundation-20260527.md` — the shared flag package (registry + client + env-override fallback) this gating layer extends.
- `docs/solutions/architecture-patterns/browser-sse-proxy-to-bearer-gated-internal-sse-20260626.md` — the SSE proxy surface the gate protects; deny emits one terminal `error` frame the client maps to the stub.
- `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md` — why the gate's new env vars are `.optional()` (boots-clean).
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the branch-unique-test discipline the ERROR-before-value ordering test instantiates.
- Plan: `docs/plans/2026-07-03-002-feat-chat-seeker-ld-flag-plan.md` (KTD3–KTD5, KTD8).
