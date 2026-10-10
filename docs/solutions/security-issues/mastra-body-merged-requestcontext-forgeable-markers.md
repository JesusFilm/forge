---
title: "Mastra's built-in API merges caller-supplied requestContext — context values are forgeable; route internal behavior on per-process tokens"
date: "2026-08-05"
category: "security-issues"
module: "apps/mastra"
problem_type: "security_issue"
component: "api"
severity: "high"
resolution_type: "code_fix"
symptoms:
  - "A behavior keyed on a RequestContext value (e.g. an observability configSelector) can be triggered by any caller of Mastra's code-unauthenticated /api/agents/* surface by posting that key/value in the request body"
  - "No error or log — the forged value is indistinguishable from a legitimately stamped one at the point of use"
root_cause: "Mastra's server handlers merge the request BODY's `requestContext` object into the run's RequestContext for non-reserved keys (verified at @mastra/server 1.55.0, the version apps/mastra resolves via mastra 1.21.0 -> @mastra/deployer; behavior unchanged since 1.36.0: mergeBodyRequestContext copies any key absent from RESERVED_CONTEXT_KEYS), and the built-in /api/agents/* routes carry no code-level authentication — so every non-reserved context key is caller-controlled input on that surface, not trusted server state."
related_components:
  - "apps/mastra/src/mastra/langfuse-tracing.ts"
  - "apps/mastra/src/mastra/agents/seeker-route.ts"
related:
  - "docs/solutions/best-practices/order-sensitive-registry-config-structural-enforcement.md"
  - "docs/solutions/tooling-decisions/langfuse-vs-mastra-native-management-layer-20260805.md"
tags:
  - "mastra"
  - "requestcontext"
  - "forgeable-input"
  - "capability-token"
  - "feat-321"
---

# Mastra RequestContext values are caller-forgeable on the built-in API — internal routing markers must be unguessable per-process tokens

## Problem

feat-321's first implementation routed seeker traces to the raw
(un-redacted) Langfuse observability config via a RequestContext marker whose
VALUE was the config's name (`"langfuse-seeker"`). Because Mastra's built-in
`/api/agents/*` surface merges body-supplied `requestContext` keys into the
run context, any caller who could reach the Mastra port could post
`{"requestContext": {"tracingConfig": "langfuse-seeker"}}` on ANY agent and
opt that agent's trace into raw export — widening a deliberately
seeker-scoped raw-content decision to every agent on the instance.

## Symptoms

None observable — that is the finding. A forged marker selects the raw
config exactly as a legitimate stamp does; the only containment was the
Railway network boundary in front of the Mastra port.

## What Didn't Work

- **Treating the context value as trusted server state.** The marker was
  designed for one internal call site (the `/forge-seeker` route), but
  nothing binds a RequestContext key to its intended writer — the body-merge
  path makes the same key writable by callers. Reserved keys are protected;
  application keys are not.
- **Relying on the selector's registry check alone.** The selector only
  honored names of REGISTERED configs, which prevents selecting arbitrary
  configs — but the sensitive config's name is guessable (it's in the
  source), so registry membership is no defense once tracing is enabled.

## Solution

Make the marker's VALUE an unguessable per-process capability token instead
of a meaningful name (`apps/mastra/src/mastra/langfuse-tracing.ts`):

    export const LANGFUSE_SEEKER_TRACING_MARKER = randomUUID()

    export const selectObservabilityConfig: ConfigSelector = (options, availableConfigs) => {
      const requested = options.requestContext?.get(TRACING_CONFIG_CONTEXT_KEY)
      if (
        requested === LANGFUSE_SEEKER_TRACING_MARKER &&
        availableConfigs.has(LANGFUSE_SEEKER_TRACING_CONFIG_NAME)
      ) {
        return LANGFUSE_SEEKER_TRACING_CONFIG_NAME
      }
      return undefined
    }

The token is minted at module load and only code that imports the module
(today: the seeker route's `buildSeekerTracingCallOptions`) can stamp it. A
forged body value cannot guess a UUID, so a stamped-but-forged run falls
through to the redacted default config. A test pins the forgery case:
stamping the config's NAME must select nothing.

> **[CORRECTED 2026-08-06]** This section previously claimed the token is
> never serialized to any response. That is false — the capability holds for a
> different reason. The marker DOES appear in exported span records:
> `@mastra/observability` copies the run's full RequestContext onto every span
> and carries it in the span's export shape (verified at 1.16.3), and Mastra's
> built-in `/api/observability/traces*` read routes serve stored spans back —
> effectively unauthenticated in this deployment, since `apps/mastra`'s
> `index.ts` configures no server auth provider (`@mastra/server`'s
> `coreAuthMiddleware` enforces only when `mastra.getServer()?.auth` supplies
> an `authenticateToken`). Note also that `redactPromptBodies`-style span
> processors blank `input`/`output` ONLY — they never strip `requestContext`.
>
> What actually keeps the capability safe is that the **LIVE marker is never
> persisted anywhere readable**, and the two windows are mutually exclusive:
> with tracing ENABLED, marked seeker spans export to Langfuse ONLY and the
> `@mastra/langfuse` 1.4.6 converter references `requestContext` nowhere, so
> the marker never reaches Langfuse either; with tracing DISABLED, marked
> spans do land in the local store and are readable on those routes, but the
> marker then selects nothing (the raw config is not registered), and enabling
> tracing takes a redeploy that mints a fresh marker.

## Why This Works

The fix converts an ambient name into a capability: possession of the value
now proves the stamp came from in-process code, which is exactly the trust
boundary the routing decision needed. The registry check stays as the second
axis (tracing disabled → the marker matches no registered config → default),
so both failure directions are closed independently — and, per the correction
above, that same registry check is what makes the marker's presence in stored
spans harmless, since it is only ever readable in the configuration where it
selects nothing.

## Prevention

- **Treat every non-reserved RequestContext key as caller-controlled input**
  on any Mastra deployment whose built-in API is reachable — the body-merge
  is the documented-by-dist behavior, not a bug. Never branch
  security-relevant or data-egress behavior on a context value a caller
  could write, unless the value is unguessable.
- **Per-process `randomUUID()` tokens are the cheap idiom** for
  "in-process code only" markers: no key management, no config, rotated
  free on every boot. Their scope limit is also their contract — they do
  not survive multi-replica or cross-process flows (fine for `apps/mastra`,
  which runs one replica by standing invariant; revisit if that changes).
- **Do not assume a context marker stays in-process — check every sink.**
  A RequestContext value rides along into span records and out through
  whatever exporters and read routes the deployment has (see the 2026-08-06
  correction above). Before relying on such a token, enumerate where spans
  land and who can read them; the safety argument must be "the live value is
  never readable", not "the value never leaves". Concretely for feat-321: any
  future local storage exporter added to the `langfuse-seeker` config MUST
  strip `span.requestContext` before writing — a redacting wrapper that only
  blanks `input`/`output` will not do it, and would make the live marker
  readable on the code-unauthenticated observability read routes.
- **Verify the merge behavior on `@mastra/*` bumps** if any marker pattern
  is load-bearing: the body-merge lives in @mastra/server's agent handlers
  (`mergeBodyRequestContext`; key names checked against
  `RESERVED_CONTEXT_KEYS`), verified at @mastra/server 1.55.0 during the
  feat-321 review (and unchanged from 1.36.0).
- **Test the forgery, not just the feature**: the discriminating test stamps
  the guessable value an attacker WOULD send and asserts it selects nothing
  (`apps/mastra/src/mastra/langfuse-tracing.test.ts`, "rejects a forged
  marker carrying the config NAME").
