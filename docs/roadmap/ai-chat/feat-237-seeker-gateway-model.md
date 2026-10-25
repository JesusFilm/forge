---
id: "feat-237"
title: "Seeker agent JesusFilm gateway model (opt-in primary)"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-07-07"
duration: 2
depends_on:
  - "feat-198"
blocks:
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Resolution

**Shipped:** 2026-07-08 via [PR #1491](https://github.com/JesusFilm/forge/pull/1491) (`feat(mastra): seeker agent JesusFilm gateway model opt-in (feat-237)`).

**What landed.** The env-gated opt-in as briefed, with two review-driven deviations from the plan: the gateway entry ships `maxRetries: 0` (not R1's `1` — the installed `@mastra/core` retries ANY non-APICallError, including the KTD9 timeout abort, so a hang would have burned two windows; the Gemma chain is the retry), and the per-attempt fetch timeout is `55_000` (not ~30s — the pre-merge live smoke measured healthy gateway turns up to 27.3s on routine questions, too close to a 30s whole-stream cap). The KTD8 cast landed as `as unknown as MastraModelConfig` (no `any`). Live smoke: multi-turn grounding/citations/recall, RAG-unavailable degradation, dead-port and hang failover mechanics (single timeout window verified), and heavy-context all passed on the real gateway; the "Gemma then answers" leg was unverifiable at test time because both free Gemma models were 429 rate-limited upstream at OpenRouter — itself a live demonstration of the fragility this ticket addresses.

**Compound docs.** `docs/solutions/best-practices/mastra-model-entry-timeout-retry-and-stream-abort-pattern.md` (retry-classification + whole-stream-abort facts, mechanism-test pattern, repro recipes) and `docs/solutions/conventions/mastra-inline-gateway-construction-createrequire.md` (the plan's deferred follow-up).

**Residual risk / follow-ups.** Two behaviors confirmed by repro but unverified in production, flagged for dogfood attention (not blockers — the flag is default-off and revert is unsetting it): (1) a mid-stream gateway failure leaks already-streamed partial tokens into the reply before Gemma re-generates into the same turn — watch for concatenated answers; (2) the 55s whole-stream cap would cut a healthy gateway answer still streaming at the deadline — unlikely at ~2x observed headroom, but watch turn durations. Repro recipes for both live in the timeout-envelope solutions doc. Rollout is operator work: chat-scoped `AI_GATEWAY_CHAT_API_KEY` + `AI_GATEWAY_SEEKER_ENABLED=true` on the Railway `apps/mastra` service (the key currently exists only on admin's service); failover frequency observable via the built-in `Error executing model coding` log line.

## Problem

The seeker agent's model chain is two free-tier Gemma 4 OpenRouter models that error intermittently (feat-198 residual; ~5/8 live success on 2026-06-18; OpenRouter caps `:free` models at 20 req/min and 50–1000 req/day). The paid/stable model swap was explicitly deferred in `docs/solutions/integration-issues/mastra-conversational-agent-memory-and-model-router-wiring.md`. This ticket executes that deferral as a deliberately reversible trial: when opted in via env, the self-hosted JesusFilm AI Gateway chat model (OpenAI-compatible, vLLM-backed, already the production default for content embeddings) becomes the seeker's primary model, with the two Gemma entries retained as fallbacks in the same Mastra model array. Flag unset → behavior byte-identical to today; revert = unset the flag.

Implementation authority: `docs/plans/2026-07-07-004-feat-seeker-gateway-model-plan.md` (implementation-ready unified plan, doc-reviewed) — where it and this ticket differ, the plan wins.

## Entry Points — Read These First

1. `docs/plans/2026-07-07-004-feat-seeker-gateway-model-plan.md` — Goal Capsule, KTD1–KTD9, U1–U3, Verification Contract (incl. the live smoke checklist).
2. `apps/mastra/src/mastra/agents/seeker-agent.ts` (~lines 60-75) — the current two-entry model array this ticket gates; the file is currently env-free.
3. `apps/mastra/src/mastra/agents/specialized-agents.ts` (`resolveAgentModel()`, ~lines 74-116) — the pattern template: env gate + `createRequire` shim + inline `createOpenAI` construction. Do NOT import from `../providers` (Mastra CLI Rollup bundle trap — `createJesusFilmProvider()` has zero runtime callers for exactly this reason).
4. `apps/mastra/src/mastra/agents/default-chat-agent.ts` (~lines 56-90) — gate shape (`AI_GATEWAY_CHAT_API_KEY` AND flag `=== "true"`) and the `.chat()` chat-completions pin (bare callable → Responses API → crashes the gateway's vLLM on multi-turn tool conversations).
5. `apps/mastra/src/config/env.ts` (~lines 147-158, 701-721) — the `AI_GATEWAY_CHAT_*` optional block where `AI_GATEWAY_SEEKER_ENABLED` lands, and the `isSeekerRouteEnabled()` resolver shape the new `isAiGatewaySeekerEnabled()` mirrors.
6. `apps/mastra/src/mastra/gateway-constants.ts` — import-free Cloudflare User-Agent + default base URL for the construction.

## Grep These

- `AI_GATEWAY_CHAT_API_KEY` — every existing gate site and the env-mock test patterns (`multi-step-draft.test.ts` `enableGateway()`).
- `resolveAgentModel` — the gated-construction template.
- `model: \[` under `apps/mastra/src` — the seeker's array is the only model array in the app.
- `isSeekerRouteEnabled` — resolver + `env.test.ts` test shape to mirror for the new flag.

## What To Build

1. `AI_GATEWAY_SEEKER_ENABLED` (`z.string().optional()`) + exported `isAiGatewaySeekerEnabled()` resolver in `env.ts` (exact-`"true"` string-boolean) — plan U1.
2. Exported `buildSeekerModelList()` in `seeker-agent.ts`: gated on key AND resolver, prepends the gateway entry (`createRequire` + `createOpenAI` + UA header + `.chat(env.AI_GATEWAY_CHAT_MODEL ?? "coding")` + timeout-wrapping custom `fetch` per plan KTD9, `maxRetries: 1`) to the unchanged two-entry Gemma array — plan U2.
3. Unit tests pinning BOTH branches with a partial env mock (`importOriginal` spread — a full mock crashes at module load via `memory.ts`) — plan U2 test scenarios.
4. Docs: `apps/mastra/CLAUDE.md` (seeker model paragraph, local-run, env table row noting the shared `AI_GATEWAY_CHAT_MODEL` coupling), the deferral note in the solutions doc, this ticket + lane README — plan U3.

## Constraints

- Zero new required env vars; unset flag → today's behavior, proven by the disabled-branch tests.
- `.chat()` only — never the bare provider callable (vLLM Responses-API multi-turn tool crash).
- No import of `../providers` from the agent file (Rollup bundle trap).
- Do not touch memory/thread/retention wiring, the `/forge-seeker` route contract, or the experience agents' gateway gating (`AI_GATEWAY_CHAT_ENABLED` stays theirs).
- `AI_GATEWAY_CHAT_MODEL` is shared with the experience surface: changing it while `AI_GATEWAY_SEEKER_ENABLED="true"` requires re-running the plan's R7 smoke checklist before deploy.
- Accepted risk: mid-stream gateway failures (post-first-token) are outside the failover mechanism — the fallback loop has already committed to its stream.

## Verification

- `pnpm --filter @forge/mastra test` — both selection branches + resolver semantics green.
- `pnpm --filter @forge/mastra typecheck && pnpm --filter @forge/mastra lint && pnpm --filter @forge/mastra build` — the build proves the createRequire shim survives the Rollup path.
- Live smoke checklist from the plan's Verification Contract (local Studio, chat-scoped key): multi-turn `retrieveAnswer` tool calling, citation discipline, RAG-unavailable degradation, failover on BOTH dead-port and hanging-listener gateway failures, one heavy-context turn. Record results in the PR.
- Rollout: chat-scoped `AI_GATEWAY_CHAT_API_KEY` + `AI_GATEWAY_SEEKER_ENABLED=true` on the Railway `apps/mastra` service; dogfood via Studio + `/forge-seeker`; grep Railway logs for the per-model failure line with the gateway model id to observe failover frequency.
