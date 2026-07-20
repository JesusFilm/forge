---
id: "feat-272"
title: "Seeker Langfuse-managed prompt integration (consume getManagedPrompt)"
owner: "jaco"
priority: "P2"
status: "not-started"
start_date: "2026-08-17"
duration: 3
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

The Langfuse prompt-retrieval helper shipped standalone (plan
`docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md`, U1–U4):
`apps/mastra/src/services/langfuse-prompt-client.ts` — `fetchLangfusePrompt`
(no-throw result-union fetch of a named, label-resolved text prompt) +
`getManagedPrompt` (TTL cache, failure cooldown, serve-stale, single-flight,
caller-supplied fallback with provenance). Nothing consumes it: the seeker
agent's system prompt is still the inline string in `seeker-agent.ts`, in this
public repo — and the whole reason the helper exists is that tuned prompt text
must not live here.

The helper shipped OUTSIDE this roadmap (a plan-driven arc with no lane
ticket), so this ticket has no `depends_on` — there is no ticket to depend on.
It is the tracked carrier for the plan's deferred Scope Boundaries plus the
two risks the plan explicitly routed here:

- **Silent divergence.** Once wired, production can serve the compiled-in
  fallback while operators assume the tuned prompt is live. Provenance in the
  return type and the `event=prompt_fetch_failed` transition log are the
  designed hooks; sustained-fallback alerting does not exist yet.
- **Governance shift.** Once anything consumes the helper, moving a Langfuse
  label (e.g. re-pointing `production` to a different version) becomes an
  unreviewed production behavior change that bypasses PR review and CI
  entirely. That must be bounded by access control before consumption is
  enabled.

**Operational precondition (from the plan's Open Questions — decide before
starting).** Langfuse hosting posture and ownership are undecided: no Langfuse
account, project, or keys exist anywhere in this repo or its deploy config.
Someone must decide Langfuse Cloud (EU vs US region — keys and base URLs are
region-bound) vs self-hosted, and own provisioning the per-environment
projects, key pairs, and the seeded smoke prompt. This gates BOTH the first
real run of the opt-in smoke and this integration.

## Entry Points — Read These First

1. `apps/mastra/src/services/langfuse-prompt-client.ts` — the two-layer
   helper; the module header documents the cache state machine and the
   no-throw/leak-control contract this ticket must not weaken.
2. `apps/mastra/src/mastra/agents/seeker-agent.ts` — the inline
   `instructions` array (SAFETY line, citation discipline, guardrail
   attach-point breadcrumb) that becomes the fallback and the code-owned half
   of the composition split.
3. `apps/mastra/src/services/langfuse-prompt-client.test.ts` — the
   `getManagedPrompt seeker scenario (agent-instructions shape)` block: pins
   that the fallback is the FULL working prompt and that the helper does no
   composition. Re-pin these expectations deliberately when the composition
   split lands.
4. `apps/mastra/src/services/langfuse-prompt-client.smoke.test.ts` — the
   header documents the one-time smoke seeding convention
   (`forge-mastra-smoke/text-prompt`, label `production`, text type, dev
   project; never self-seeds). Must run green before integration starts.
5. `apps/mastra/src/config/env.ts` — the `LANGFUSE_*` group,
   `getLangfuseConfig()` (cooldown-≤-TTL clamp), and
   `assertLangfuseBaseUrlAllowedForProduction`.
6. `docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md` — Scope
   Boundaries, KTD8 (per-environment projects, protected label), and Risks
   and Dependencies.

## Grep These

- `getManagedPrompt` / `fetchLangfusePrompt` — the helper surface.
- `event=prompt_fetch_failed` — the failure log line alerting hooks onto.
- `SEEKER_INLINE_INSTRUCTIONS` — the scenario test's fallback fixture (a
  deliberate duplicated copy of the agent's inline text, never an import).
- `redactPromptBodies` — the existing span processor that prompt-version
  stamping must coexist with.
- `LANGFUSE_PROMPT_DEFAULT_LABEL` — the env rung of label resolution.

## What To Build

The deferred items from the plan's Scope Boundaries, in rough order:

1. **Seeker wiring.** Back the seeker agent's `instructions` with
   `getManagedPrompt` as a dynamic-instructions function (verified in the
   plan: `@mastra/core` `DynamicArgument<string>` accepts `Promise<string>`,
   and the helper never throws). The fallback is the full current working
   prompt — never a stub.
2. **The composition decision.** Keep the SAFETY line and the tool-coupled
   citation wording CODE-OWNED (they are coupled to `retrieveAnswer`'s
   contract and the deferred guardrail gate) while Langfuse owns only the
   tunable persona portion. The helper deliberately does no composition — the
   composition seam lives in the agent/consumer. The current scenario test
   pins full-prompt-as-fallback; re-pin it to the composed shape.
3. **Stale-while-revalidate.** Replace the blocking single-attempt refetch on
   TTL expiry with a background refresh — serve current text immediately,
   refresh out of band. Mind the helper's deliberate "no background work"
   invariant (nothing may keep the process or test runner alive today);
   whatever mechanism lands must not leak timers or wedge vitest.
4. **Explicit `version` pinning parameter.** Additive input alongside
   `label`; provenance already records the served version, so this is a
   fetch-input change, not a result-shape change.
5. **Sustained-fallback alerting + span stamping.** Metrics/alerting when
   production serves `source: "fallback"` beyond a threshold (the
   silent-divergence risk), and stamp the served prompt version/source into
   Mastra observability spans — compatible with `redactPromptBodies` (never
   prompt bodies).
6. **Langfuse workspace access-control review**, folded into the ai-chat
   lane's guardrail release gate (the deferred "Full persona + safety
   guardrails" gate in `apps/mastra/CLAUDE.md`): who may move the
   `production` label, the protected-label posture per project (plan KTD8),
   and the per-environment project/key provisioning from the operational
   precondition. Consumption stays off until this review passes.

## Constraints

- The helper stays retrieval-only (plan R4): no prompt create/update/label
  mutation from code, ever. Authoring stays in the Langfuse UI.
- Zero new required env vars; an unconfigured environment must keep serving
  the fallback with no boot impact.
- No `langfuse` / `@langfuse/*` npm packages (plan KTD1) — the hand-rolled
  client carries house invariants the SDK cannot.
- Per-environment Langfuse PROJECTS with separate key pairs (plan KTD8) —
  never labels-within-one-project: a leaked dev key must not read tuned prod
  prompt text.
- Do not weaken the helper's no-throw, leak-control, or cooldown-≤-TTL
  invariants while adding SWR or version pinning.
- Do not enable production consumption before the access-control review
  (item 6): an unreviewed label move must not be able to change production
  agent behavior.

## Verification

- The opt-in smoke runs green against the provisioned dev project
  (`LANGFUSE_PROMPT_SMOKE_TEST=1` + dev keys) — proves the operational
  precondition landed before wiring starts.
- The plan's no-wiring grep gate inverts:
  `grep -r "langfuse" apps/mastra/src/mastra/` now hits exactly the intended
  seeker wiring and nothing else.
- Seeker scenario tests re-pinned to the composed shape; full suite green:
  `pnpm --filter @forge/mastra test`, `typecheck`, `lint`.
- Studio check: a seeker turn serves the Langfuse-managed persona when
  configured; with `LANGFUSE_*` unset the agent serves the byte-identical
  code-owned prompt (`source: "fallback"`).
- Sustained-fallback alerting fires in a rehearsed outage drill; spans carry
  prompt version/source without prompt bodies.
