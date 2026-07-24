---
id: "feat-303"
title: "Langfuse managed-prompt retrieval helper (retroactive record)"
owner: "jaco"
priority: "P2"
status: "complete"
start_date: "2026-07-20"
duration: 3
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "infrastructure"
---

> **Retroactive ticket — documentation only.** The work described here shipped
> before this file existed. It is written solely so the ai-chat lane's roadmap
> and README record the arc that [PR #1621](https://github.com/JesusFilm/forge/pull/1621)
> landed; it never briefed anyone and never will. It deliberately carries **no**
> `## Entry Points`, `## Grep These`, `## What To Build`, `## Constraints`, or
> `## Verification` sections — those exist to direct future implementation, and
> there is none to direct. The authoritative brief for this work is the plan
> document cited in the Resolution below, which is where the requirements,
> key technical decisions, implementation units, and verification contract
> actually live. Read that, not this.

## Resolution

**Shipped:** 2026-07-23 via [PR #1621](https://github.com/JesusFilm/forge/pull/1621)
(`feat(mastra): add Langfuse managed-prompt retrieval helper`).

**Authoritative brief.** `docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md`
— the `ce-unified-plan/v1` document this arc was built from (Product Contract
R1–R12, Key Technical Decisions KTD1–KTD8, implementation units U1–U5,
Verification Contract, Definition of Done). This ticket does not restate it.

**What landed.** A standalone, retrieval-only Langfuse prompt-management helper
in `apps/mastra`, two layers in one module
(`src/services/langfuse-prompt-client.ts`): `fetchLangfusePrompt` — a
single-attempt, no-throw result-union client over
`GET /api/public/v2/prompts/{name}` carrying the house client invariants (HTTP
Basic auth from the Langfuse key pair, production https + host allowlist,
`redirect: "error"`, byte-capped body reads on both success and error paths,
leak control) — and `getManagedPrompt` — a TTL cache with failure cooldown,
serve-stale, single-flight, and a caller-supplied fallback, returning provenance
(`source: "langfuse" | "fallback"`, version, resolved label, stale, reason) as
part of the return type rather than as a log side-effect. Supporting changes: the
all-optional `LANGFUSE_*` env group with `getLangfuseConfig()` and the
`assertLangfuseBaseUrlAllowedForProduction` boot guard in `src/config/env.ts`; a
1,587-line mocked suite covering every failure reason/detail and every
cache-state-machine edge, including a seeker-agent-scenario block; and a
`describe.skipIf`-gated real-credential smoke
(`langfuse-prompt-client.smoke.test.ts`) that never runs in CI and never
self-seeds.

**Deliberately unwired.** Nothing consumes the helper. Not wiring it was an
explicit stop condition of the plan, not an omission — the seeker agent's system
prompt remains the inline `instructions` array in
`src/mastra/agents/seeker-agent.ts`, and the plan's no-wiring gate
(`grep -r "langfuse" apps/mastra/src/mastra/` returning no hits) still holds on
`main`. No `langfuse` / `@langfuse/*` package entered any manifest (KTD1: the SDK
cannot carry the house invariants). Every `LANGFUSE_*` var is optional with a
runtime fallback, so an environment with none set boots normally and serves the
compiled-in fallback with reason `config_missing`.

**Why it exists.** This repository is public. The seeker's tuned prompt text must
not live in it, and prompt iteration should not require a PR, CI, and a deploy.
The helper is the retrieval mechanism for moving that text into Langfuse —
proven trustworthy standalone (never a boot dependency, never a hard failure on
the chat path, never a secrets or prompt-body leak) before anything depends on
it.

**Compound docs.** Created:
`docs/solutions/design-patterns/async-single-flight-slot-release-hazards.md`,
`docs/solutions/design-patterns/serve-stale-cache-permanent-failure-exit-and-degraded-serve-provenance.md`,
`docs/solutions/tooling-decisions/langfuse-prompt-api-contract-and-sdk-rejection.md`,
`docs/solutions/workflow-issues/deferred-verification-belongs-in-consuming-ticket-entry-conditions.md`.
Extended: `docs/solutions/conventions/single-service-http-client-result-union-convention.md`.
Operator/agent docs: the `LANGFUSE_*` env-table rows and the "Langfuse prompt
management" section in `apps/mastra/CLAUDE.md`, an ownership bullet in
`apps/mastra/AGENTS.md`, and a managed-prompt entry in `CONCEPTS.md`.

**Residual risk / follow-ups.** Two tracked tickets carry everything deferred:

- **feat-296** — the operational precondition: decide Langfuse hosting posture
  (Cloud region vs self-hosted), create per-environment projects and key pairs,
  seed the smoke prompt, and set the env vars in the safe order
  (`LANGFUSE_ALLOWED_HOSTS` before `LANGFUSE_BASE_URL` — the latter is the only
  Langfuse-driven boot throw).
- **feat-272** — the integration: seeker wiring and the prompt-composition split
  (SAFETY line and tool-coupled citation wording stay code-owned),
  stale-while-revalidate, explicit version pinning, sustained-fallback alerting
  and span stamping, and the Langfuse workspace access-control review.

Two risks named in the plan remain live and unmitigated by this arc because
nothing consumes the helper yet — **silent divergence** (production serving the
fallback while operators assume the tuned prompt is live; provenance and the
`event=prompt_fetch_failed` transition log are the designed hooks, but no
sustained-fallback alerting exists) and **governance shift** (once anything
consumes the helper, moving a Langfuse label becomes an unreviewed production
behavior change that bypasses PR review and CI). Both are carried by feat-272.

**Process note.** This arc merged without a lane ticket, so no README row, no
`Code PR` link, and no `## Resolution` recorded it at the time — the gap this
file closes. The lane's convention (`docs/roadmap/ai-chat/CLAUDE.md`) is that a
ticket flips to `complete` inside the feature PR itself; for plan-driven work
that starts outside the roadmap, the ticket has to be created before the code PR
merges for that to be possible.

## Problem

Written retroactively for the historical record; see the plan for the real
framing.

The seeker chat agent's system prompt was — and still is — an inline string
array in `apps/mastra/src/mastra/agents/seeker-agent.ts`. That is acceptable
while the prompt is a placeholder, but this repository is public-facing, so once
the team begins tuning and optimizing the prompt the tuned text cannot live
here. Langfuse provides prompt versioning, labeled rollout and rollback without
a deploy, and access-controlled storage. Before any agent could depend on it,
the retrieval mechanism had to exist standalone and be proven trustworthy:
never a boot dependency, never a hard failure on the chat path, never a secrets
or prompt-body leak.
