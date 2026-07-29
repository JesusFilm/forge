---
id: "feat-272"
title: "Seeker Langfuse-managed prompt integration (consume getManagedPrompt)"
owner: "jaco"
priority: "P2"
status: "not-started"
start_date: "2026-08-17"
duration: 3
depends_on:
  - "feat-296"
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
  entirely. There is no technical control over who may do that — see item 6.
  What bounds it is the composition split (item 2), which keeps the
  safety-critical text in code where PR and CI still apply.

**Operational precondition.** No Langfuse project or keys exist anywhere in
this repo or its deploy config yet. Someone must provision **one project,
`forge-mastra`**, in the same Langfuse organisation as `JesusFilm/core`'s
Journeys project, with two key pairs (Railway + local dev) and the seeded smoke
prompt. Environments are distinguished by **labels** (`production` /
`development`), not by separate projects — the plan's KTD8 mandated
per-environment projects and was reversed on 2026-07-28; see the topology
decision in feat-296 and the supersession note beside KTD8 in the plan. This
gates BOTH the first real run of the opt-in smoke and this integration. That
provisioning + safe-env-rollout checklist is tracked in **feat-296** (this
ticket `depends_on` it).

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
   (`forge-mastra-smoke/text-prompt`, label `production`, text type, seeded in
   the `forge-mastra` project; never self-seeds). Must run green before
   integration starts.
5. `apps/mastra/src/config/env.ts` — the `LANGFUSE_*` group,
   `getLangfuseConfig()` (cooldown-≤-TTL clamp), and
   `assertLangfuseBaseUrlAllowedForProduction`.
6. `docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md` — Scope
   Boundaries, Risks and Dependencies, and KTD8 **with its 2026-07-28
   supersession note and its 2026-07-29 amendment** (per-environment projects
   reversed to one project with labels; the protected-`production`-label
   remedy dropped as unavailable and inert — see item 6).

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
   `getManagedPrompt` through a thin dynamic-instructions wrapper:
   `instructions: async () => (await getManagedPrompt({ ... })).text`.
   (Verified against `@mastra/core` `dist/types/dynamic-argument.d.ts`:
   `DynamicArgument<string>` accepts an async **function** returning
   `Promise<string>`, never a bare `Promise` — and `getManagedPrompt` cannot
   be assigned directly, since it takes its own options object and returns a
   `ManagedPromptResult`, not a `string`. The helper never throws, so the
   wrapper needs no error handling.) The fallback is the full current working
   prompt — never a stub. **If you keep the composition split (item 2), land it
   in the same change:** wiring the full prompt first leaves the SAFETY line
   Langfuse-managed and label-movable in the meantime.
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
6. **Know the label-move property — no ceremony required.** Moving the
   `production` label changes agent behaviour with **no PR, CI or deploy**, and
   there is **no technical control** over who may do it: protected labels are a
   Team/Enterprise feature this organisation is not on, and they work by
   blocking `viewer`/`member` while permitting `admin`/`owner`, so they would
   be inert here anyway (feat-296 records the check). This is a real property
   of choosing labels over per-environment projects, and it is the thing to
   revisit if the Langfuse organisation ever admits non-developers — but with
   the current small, all-developer roster it needs no gate or sign-off
   process. The mitigation that actually bites is the composition split in
   item 2: keep the SAFETY line and the `retrieveAnswer`-coupled wording
   code-owned and a label move can only change tone, never the safety
   guardrail or citation discipline.

## Constraints

- The helper stays retrieval-only (plan R4): no prompt create/update/label
  mutation from code, ever. Authoring stays in the Langfuse UI.
- Zero new required env vars; an unconfigured environment must keep serving
  the fallback with no boot impact.
- No `langfuse` / `@langfuse/*` npm packages (plan KTD1) — the hand-rolled
  client carries house invariants the SDK cannot.
- ONE Langfuse project (`forge-mastra`) with **labels** distinguishing
  environments, and two key pairs inside it (Railway + local dev). The plan's
  KTD8 said the opposite; it was reversed on 2026-07-28 — see feat-296's
  topology decision. Do not reintroduce per-environment projects: prompt
  versions and labels are project-scoped with no cross-project copy, so it
  would turn promotion into manual re-authoring.
- Do not add Langfuse tracing here. The helper only reads prompts; tracing is a
  separate mechanism with its own content decision, tracked in
  `docs/roadmap/ai-chat/feat-321-langfuse-tracing.md`.
- Do not weaken the helper's no-throw, leak-control, or cooldown-≤-TTL
  invariants while adding SWR or version pinning.
- Keep the composition split (item 2) — that, not any access-control process,
  is what stops a label move from touching the SAFETY line or citation
  discipline.
- The caller-supplied `fallback` must always be the full working prompt and
  never empty — layer 2 deliberately serves it verbatim with no emptiness
  guard (asymmetric with layer 1's `empty_prompt` rejection). Pin a
  non-empty fallback in the wiring tests. (Review finding #8.)
- Serve-stale means DELETING a managed prompt in Langfuse does not retract
  already-cached text until process restart — layer 2 ignores `retryable`
  and keeps serving stale through non-retryable 404/401 failure windows.
  Decide retraction semantics during wiring: degrade stale-serving after N
  non-retryable cooldown windows, or document label re-pointing as the only
  retraction path. (Review finding #9.)
- Prompt names/labels passed to `getManagedPrompt` must be compile-time
  constants — the default cache has no eviction and logs the raw name per
  failure transition, so request-derived names would grow the Map
  unboundedly and defeat the cooldown discipline. (Review finding #11.)

## Verification

- The opt-in smoke runs green against the provisioned `forge-mastra` project
  using the local-dev key pair (`LANGFUSE_PROMPT_SMOKE_TEST=1`) — proves the
  operational precondition landed before wiring starts.
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
