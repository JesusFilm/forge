---
title: Seeker Agent Gateway Model Wiring - Plan
type: feat
date: 2026-07-07
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Seeker Agent Gateway Model Wiring - Plan

## Goal Capsule

- **Objective:** The seeker agent (`apps/mastra/src/mastra/agents/seeker-agent.ts`) runs on the self-hosted JesusFilm AI Gateway chat model when opted in via env, keeping the existing free-Gemma OpenRouter chain as fallback. With the flag unset, behavior is unchanged. Revert = unset the flag.
- **Authority:** This plan's Product Contract > `apps/mastra/CLAUDE.md` and root `CLAUDE.md` conventions > this plan's Planning Contract details. Model/provider choice is settled (ce-pov verdict, 2026-07-07) and not up for re-litigation during implementation.
- **Stop conditions:** Stop and surface (don't work around) if the live smoke shows the gateway model failing multi-turn tool calling or citation discipline — that invalidates the premise, and the fix is not more wiring. Stop if `@mastra/core` model-array behavior contradicts the pinned facts below (version drifted).
- **Execution profile:** Single branch `feat/seeker-gateway-model` in the current worktree; small diff (~4 files + docs); pre-commit hooks stay on.

---

## Product Contract

### Summary

Prepend an env-gated JesusFilm AI Gateway chat-model entry to the seeker agent's model fallback array, behind a new optional `AI_GATEWAY_SEEKER_ENABLED` flag plus the existing chat-scoped gateway key. Pin both selection branches with unit tests, prove the gateway path with a live Studio smoke before merge, and update the docs/roadmap trail.

### Problem Frame

The seeker's model chain is two free-tier Gemma 4 OpenRouter models that error intermittently (feat-198 residual; ~5/8 live success on 2026-06-18; OpenRouter caps `:free` models at 20 req/min and 50–1000 req/day). `docs/solutions/integration-issues/mastra-conversational-agent-memory-and-model-router-wiring.md` explicitly deferred a paid/stable model swap. The org's self-hosted gateway (OpenAI-compatible, vLLM-backed, already the production default for embeddings) is infrastructure we control; this work executes the deferred swap as a deliberately reversible trial.

### Requirements

**Model selection behavior**

- R1. When `AI_GATEWAY_CHAT_API_KEY` is set AND `AI_GATEWAY_SEEKER_ENABLED === "true"`, the seeker's model array has three entries: the gateway chat model (`AI_GATEWAY_CHAT_MODEL ?? "coding"`, `maxRetries: 1`) first, then the two existing free-Gemma entries unchanged.
- R2. In every other case (flag unset, flag any other value including `"false"`, or key unset), the model array is exactly today's two-entry Gemma chain — behavior unchanged.
- R3. Gateway requests pin the chat-completions endpoint (`.chat(...)`) and send the Cloudflare-required User-Agent; base URL defaults to the production gateway and honors `AI_GATEWAY_CHAT_BASE_URL`.

**Config posture**

- R4. The new flag is `.optional()` at schema level; zero new required env vars; an unprovisioned environment boots exactly as today.
- R5. Only the exact string `"true"` enables the flag (repo string-boolean convention).

**Quality gates**

- R6. Unit tests pin both selection branches: the disabled branch keeps the existing pinned two-entry array; the enabled branch asserts gateway-first ordering.
- R7. A live pre-merge smoke on the gateway path covers: multi-turn `retrieveAnswer` tool calling, citation discipline, RAG-unavailable degradation, gateway-down failover to Gemma, and one heavy-context turn (the gateway model has a ~32K window).

**Docs and rollout**

- R8. Docs updated in the same change: `apps/mastra/CLAUDE.md` (seeker model paragraph, local-run section, environment table), the deferral note in `docs/solutions/integration-issues/mastra-conversational-agent-memory-and-model-router-wiring.md`, and a new roadmap ticket feat-237 in the ai-chat lane with its hand-maintained README.
- R9. Unsetting `AI_GATEWAY_SEEKER_ENABLED` (or the key) restores R2 behavior with no code change.

### Scope Boundaries

**Not in scope (do not touch)**

- Memory, thread ownership, retention, and the `ai_chat` schema — the model swap does not touch thread/resource keying (verified: seeker memory is storage-only).
- The `/forge-seeker` route contract, budgets, and error vocabulary.
- The experience agents' gateway gating (`AI_GATEWAY_CHAT_ENABLED`) and `providers.ts`.
- No seeker-specific model env var — the shared `AI_GATEWAY_CHAT_MODEL` override suffices, with the coupling made explicit in docs: changing it while the seeker flag is on swaps the seeker's model too (see U3).
- No new failover logging — Mastra's built-in per-model failure log is the observability surface (user-confirmed).

**Deferred to Follow-Up Work**

- Compound the inline gateway-construction pattern into `docs/solutions/` after this lands (it is currently documented only in code comments and CLAUDE.md).
- An explicit seeker-side failover log line/counter, only if dogfood shows the built-in log insufficient.
- An automated real-call gateway smoke in CI (this plan uses a manual pre-merge checklist).
- Deciding the fate of the unused `createJesusFilmProvider()` in `providers.ts` (dead at runtime; kept for its tests and doc value).

**Outside this product's identity**

- Public exposure of the seeker and the guardrail release gate (crisis handling, AI-disclosure) — unchanged by this work; the agent stays Studio-only behind `SEEKER_ROUTE_ENABLED` and the network boundary.

---

## Planning Contract

### Key Technical Decisions

- **KTD1 — Seeker-specific flag, not `AI_GATEWAY_CHAT_ENABLED`.** The existing flag routes the experience chat/draft agents onto the gateway and is off-by-default because the `coding` model fails their strict JSON-envelope contract. Reusing it would couple two surfaces with different risk profiles and destroy independent rollback — the point of this ticket. New flag: `AI_GATEWAY_SEEKER_ENABLED`; the key, base URL, and model vars stay shared.
- **KTD2 — Construct the gateway model inline via the `createRequire` shim; never `import` from `../providers`.** `providers.ts` statically imports `@ai-sdk/*`, and any transitive static import of it from agent files trips the Mastra CLI Rollup bundle trap ("Cannot determine intended module format"). This is why `createJesusFilmProvider()` has zero runtime callers and why `default-chat-agent.ts` and `specialized-agents.ts` (`resolveAgentModel()`) both inline `createRequire(import.meta.url)` + `createOpenAI({...})` with `../gateway-constants` (which is deliberately import-free). Mirror `specialized-agents.ts`'s `resolveAgentModel()` shape, returning an array.
- **KTD3 — Mixed model array (instance + router strings) is supported; prepend, don't replace.** `@mastra/core@1.36.0`'s `ModelWithRetries.model` accepts `MastraModelConfig = LanguageModelV1|V2|V3 | ModelRouterModelId | OpenAICompatibleConfig` per entry (`dist/agent/types.d.ts`), and mastra.ai/models documents AI SDK instances working "anywhere that accepts a provider/model string, including within model router fallbacks." Keeping the Gemma entries behind the gateway makes the enabled path no-regression for thrown failures — any gateway error lands on today's behavior. The hang path (connection accepted, no response) does not throw on its own; it is covered by the per-attempt timeout in KTD9.
- **KTD4 — Pin chat-completions via `.chat(modelId)`.** The bare provider callable defaults to the Responses API, which crashes the gateway's vLLM backend on multi-turn tool conversations (a documented, open vLLM issue class). Shipped precedent: `default-chat-agent.ts:83-90`.
- **KTD5 — Gate requires key AND flag, checked before construction.** The key is shared with the experience opt-in, so key presence alone must never flip the seeker. Constructing the provider only inside the gate also avoids the throw-on-missing-key path. Gate shape mirrors `default-chat-agent.ts:67`.
- **KTD6 — Flag reads go through an exported resolver, `isAiGatewaySeekerEnabled()`.** Matches the established env.ts pattern (`isSeekerRouteEnabled()`, `resolveAiChatMemoryBackend()`); no raw `env.X === "true"` at call sites.
- **KTD7 — `maxRetries: 1` on the gateway entry; failover observability via built-in logs.** Mastra's fallback loop advances on any thrown error (only retryable classes are retried first), and a context-overflow 400 fails over pre-first-token. Failover is silent in the chat UX; Mastra's per-model error log (`Error executing model <modelId>`) through PinoLogger is the dogfood signal — no new logging code.
- **KTD8 — Type cast per established convention.** The provider-returned model needs `as unknown as LanguageModel` (or a justified `eslint-disable @typescript-eslint/no-explicit-any`) inside the array entry due to AI SDK peer-version union drift — same discipline as `default-chat-agent.ts:144-148` and `specialized-agents.ts:74`.
- **KTD9 — Per-attempt timeout on the gateway entry, strictly below the turn budget.** Mastra's fallback loop advances only on a thrown error, the AI SDK's default fetch has no timeout, and Cloudflare's ~100s proxy read timeout exceeds the route's 90s `TIME_BUDGET_MS.chatTurn` — a gateway that accepts connections but hangs would eat the whole turn instead of failing over. The gated construction passes a custom `fetch` wrapped with `AbortSignal.timeout` at a budget strictly below the turn budget (~30s) so a hang throws and fails over to Gemma in-budget. `ModelWithRetries.modelSettings` has no `abortSignal`, so the timeout must live in the provider construction. Follows the repo's outbound-timeout-shorter-than-caller-budget law.

### High-Level Technical Design

Boot-time selection and runtime failover are two separate mechanisms — the gate shapes the array once at module load; Mastra's fallback loop walks it per request.

```mermaid
flowchart TB
  subgraph boot [Module load: buildSeekerModelList]
    G{AI_GATEWAY_CHAT_API_KEY set\nAND isAiGatewaySeekerEnabled()?}
    G -->|yes| A3["[gateway chat model (coding), gemma-4-31b:free, gemma-4-26b:free]"]
    G -->|no| A2["[gemma-4-31b:free, gemma-4-26b:free] (today's array)"]
  end
  subgraph run [Per request: Mastra fallback loop]
    M1[entry 1] -->|any thrown error\nafter per-entry retries| M2[entry 2] -->|same| M3[last entry\nreturns error stream]
  end
  A3 --> run
  A2 --> run
```

Directional guidance: `buildSeekerModelList()` is exported for direct unit testing; the singleton `seekerAgent` consumes it. The gateway entry's construction (createRequire + `createOpenAI` + UA header + `.chat`) lives inside the gated branch only.

### Sources & Research

- Fallback semantics verified in the installed dist: `executeStreamWithFallbackModels` advances on any non-TripWire error; per-entry `maxRetries` retries only retryable (408/429/5xx-class) errors.
- External: mastra.ai/models (mixed-entry fallback arrays, trigger conditions); mastra.ai/blog/model-fallback; vLLM issues #34496/#33089 (Responses API multi-turn tool breakage class); OpenRouter free-tier limits docs.
- Repo patterns: `apps/mastra/src/mastra/agents/specialized-agents.ts` (`resolveAgentModel()` — the closest template), `apps/mastra/src/mastra/agents/default-chat-agent.ts:56-90`, `apps/mastra/src/mastra/gateway-constants.ts`, `apps/mastra/src/config/env.ts:147-158` and `:701-721`.
- Learnings: `docs/solutions/tooling-decisions/mastra-dev-tsx-loader-for-raw-ts-workspace-deps.md` (dev vs Rollup-build asymmetry — verify both paths); `docs/solutions/best-practices/deterministic-mastra-sse-route-testing-stub-model-budget-seam-20260625.md` (never exercise the exported singleton against real providers in tests); `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` (mocked tests prove branch shape; the live smoke proves vLLM accepts multi-turn tool history).

---

## Implementation Units

### U1. Env flag and resolver

- **Goal:** `AI_GATEWAY_SEEKER_ENABLED` exists as optional schema + exported resolver, enabled only on exact `"true"`.
- **Requirements:** R4, R5.
- **Dependencies:** none.
- **Files:** `apps/mastra/src/config/env.ts`, `apps/mastra/src/config/env.test.ts`.
- **Approach:** Schema entry `z.string().optional()` in the `AI_GATEWAY_CHAT_*` block (after `AI_GATEWAY_CHAT_MODEL`, env.ts:147-158); companion raw parse-map/`emptyToUndefined` entry near the other `AI_GATEWAY_CHAT_*` raw entries (~env.ts:408-417); exported `isAiGatewaySeekerEnabled()` resolver mirroring `isSeekerRouteEnabled()` (env.ts:701-710) including its string-boolean doc comment.
- **Patterns to follow:** `SEEKER_ROUTE_ENABLED` schema + resolver + its env.test.ts block (~line 781, dynamic-import-after-env-set style).
- **Test scenarios:**
  - Unset → resolver returns false.
  - `"false"` → false (not JS-truthy).
  - `"TRUE"`/`"1"` → false (exact-match only).
  - `"true"` → true.
  - Schema parse succeeds with the var absent (boot-safety).
- **Verification:** `env.test.ts` green; typecheck clean.

### U2. Gated seeker model list + branch-pinning tests

- **Goal:** Seeker's model array is built by an exported, env-gated `buildSeekerModelList()`; both branches pinned by unit tests.
- **Requirements:** R1, R2, R3, R6, R9.
- **Dependencies:** U1.
- **Files:** `apps/mastra/src/mastra/agents/seeker-agent.ts`, `apps/mastra/src/mastra/agents/seeker-agent.test.ts`.
- **Approach:** Extract the current literal array into `buildSeekerModelList()`. Inside the gate (key AND resolver — KTD5): load `createOpenAI` via `createRequire(import.meta.url)` (KTD2), construct with `apiKey`, `baseURL: env.AI_GATEWAY_CHAT_BASE_URL ?? DEFAULT_AI_GATEWAY_CHAT_BASE_URL`, `name: "jesusfilm"`, and the `AI_GATEWAY_USER_AGENT` header from `../gateway-constants`; prepend `{ model: gateway.chat(env.AI_GATEWAY_CHAT_MODEL ?? "coding"), maxRetries: 1 }` with the KTD8 cast and a comment carrying the `.chat()`/Responses-API rationale (mirror `default-chat-agent.ts:83-88`); the construction passes a timeout-wrapping custom `fetch` per KTD9. Update the existing model comment block (seeker-agent.ts:60-71) to describe both branches. This is the file's first `env` import and first `createRequire` use — both established patterns in this directory.
- **Technical design (directional):** the singleton stays `model: buildSeekerModelList()`; no factory refactor of the agent itself.
- **Patterns to follow:** `specialized-agents.ts:74-116` (`resolveAgentModel()` — gate shape, shim, rationale comment, eslint-disable placement); `multi-step-draft.test.ts:1-24, 394-398` (`vi.hoisted` mockEnv + `enableGateway()` helper) — this introduces env mocking to `seeker-agent.test.ts` for the first time, and the mock MUST be a partial mock: `vi.mock("../../config/env", async (importOriginal) => ({ ...(await importOriginal()), env: mockEnv.env, isAiGatewaySeekerEnabled: () => mockEnv.env.AI_GATEWAY_SEEKER_ENABLED === "true" }))`. A full-module mock crashes the test file at import — `memory.ts` calls `getMastraDatabaseUrl`/`resolveAiChatMemoryBackend` from `config/env` at module load. The overridden resolver's real exact-`"true"` semantics stay pinned by U1's `env.test.ts`.
- **Test scenarios:**
  - Default mock env (nothing set) → exactly today's two-entry array, same order, same `maxRetries` (keeps the existing pinned test, now under an explicit disabled-state mock).
  - Key + flag `"true"` → three entries; entry 0's `model` field is a model instance (not a string) whose `modelId` is `"coding"`; entries 1-2 remain the unchanged `{ model: <Gemma router string>, maxRetries: 1 }` objects, same order.
  - Key + flag `"true"` + `AI_GATEWAY_CHAT_MODEL="custom"` → entry 0's `model` field has `modelId` `"custom"`.
  - Key set, flag unset → two entries (key alone never flips the seeker — KTD5).
  - Flag `"true"`, key unset → two entries, and `buildSeekerModelList()` does not throw.
  - Do not stream/execute the exported singleton against real providers in these tests (per the deterministic-testing learning); assertions stay on array shape and model identity.
- **Execution note:** After wiring, run `pnpm --filter @forge/mastra build` to prove the Rollup bundle path (dev and build resolve modules differently — a green dev boot is not proof), then run the live smoke checklist in the Verification Contract before treating this unit as done.
- **Verification:** Both branches green in `seeker-agent.test.ts`; build succeeds; smoke checklist passes.

### U3. Docs and roadmap trail

- **Goal:** The docs describe the new opt-in path and the roadmap records the work.
- **Requirements:** R8.
- **Dependencies:** U2 (documents its final shape).
- **Files:** `apps/mastra/CLAUDE.md`, `docs/solutions/integration-issues/mastra-conversational-agent-memory-and-model-router-wiring.md`, `docs/roadmap/ai-chat/feat-237-seeker-gateway-model.md` (new), `docs/roadmap/ai-chat/README.md`, `docs/roadmap/ai-chat/feat-198-seeker-agent-skeleton.md`.
- **Approach:** CLAUDE.md: extend the "Seeker agent" model paragraph with the opt-in gateway-first entry and its gating; add the local-run note (setting the key + flag prepends the gateway model); add an `AI_GATEWAY_SEEKER_ENABLED` row to the environment table near `SEEKER_ROUTE_ENABLED`, phrased in its "default-off gate … string-boolean … never required at boot" style (the experience agents' `AI_GATEWAY_CHAT_*` row stays untouched). The new row and the feat-237 ticket must both state that `AI_GATEWAY_CHAT_MODEL` is shared with the experience surface: any change to it while `AI_GATEWAY_SEEKER_ENABLED="true"` requires re-running the R7 smoke checklist before deploy. Solutions doc: update the residual-risk note — the deferred "paid/stable model swap" is now executed as this opt-in. Roadmap: new feat-237 ticket per the ai-chat lane's `CLAUDE.md` (id verified next-available globally; `owner: "jian wei"`; `depends_on: ["feat-198"]` with the reciprocal `blocks` entry on feat-198; agent-optimized body with Problem / Entry Points / Grep These / What To Build / Constraints / Verification); update the lane's hand-maintained README (Feature Index row + status counts + date bump) in the same change; on completion, prepend the `## Resolution` section per lane convention.
- **Test scenarios:** Test expectation: none — docs-only unit.
- **Verification:** Lane README counts match ticket statuses; ticket frontmatter passes the lane conventions (no `lane` field, globally-unique id).

---

## Verification Contract

| Gate                           | Command / procedure                     | Proves                                                                        |
| ------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------- |
| Unit tests                     | `pnpm --filter @forge/mastra test`      | Both selection branches (R1, R2, R6), resolver semantics (R5)                 |
| Types                          | `pnpm --filter @forge/mastra typecheck` | KTD8 cast is scoped, no `any` leakage                                         |
| Lint                           | `pnpm --filter @forge/mastra lint`      | eslint-disable justification convention                                       |
| Bundle safety                  | `pnpm --filter @forge/mastra build`     | KTD2 — the createRequire shim survives the Rollup path, not just dev          |
| Live smoke (manual, pre-merge) | checklist below                         | R3, R7 — vLLM accepts multi-turn tool history; mocked tests cannot prove this |

**Live smoke checklist** (local Studio; `MASTRA_STORAGE_BACKEND=memory pnpm --filter @forge/mastra dev` with `OPENROUTER_API_KEY`, chat-scoped `AI_GATEWAY_CHAT_API_KEY`, `AI_GATEWAY_SEEKER_ENABLED=true`, and the `JESUSFILM_RAG_*` vars; drive `/studio/agents/seekerAgent`):

1. Multi-turn conversation: `retrieveAnswer` fires every turn; answers cite only source names/URLs present in returned passages; a follow-up turn shows thread recall.
2. Degradation: with `JESUSFILM_RAG_*` unset, the agent states it cannot ground an answer (no crash).
3. Failover engagement, both failure classes: (a) restart with `AI_GATEWAY_CHAT_BASE_URL` pointing at a dead port (e.g. `http://127.0.0.1:9`) — the instant refusal fails over to Gemma; (b) point it at a local listener that accepts but never responds (e.g. `nc -l 8099`) — the KTD9 timeout throws and the turn still succeeds via Gemma within the turn budget. The per-model failure log line appears in both.
4. Heavy-context turn: a long question plus fat retrieval results either fits the ~32K window or cleanly fails over to Gemma — no user-visible error either way.
5. Record pass/fail per item in the PR description.

---

## Definition of Done

- U1–U3 complete; all Verification Contract gates green; smoke checklist executed and recorded in the PR.
- With no env changes, deployed behavior is bit-for-bit today's (R2) — proven by the disabled-branch tests.
- Rollout executed: chat-scoped `AI_GATEWAY_CHAT_API_KEY` + `AI_GATEWAY_SEEKER_ENABLED=true` set on the Railway `apps/mastra` internal service (not the gateway service); dogfood via Studio and `/forge-seeker`; failover frequency observed by grepping Railway logs for the built-in per-model failure line with the gateway model id.
- Revert path stands: unsetting the flag restores Gemma-only behavior without a code deploy (R9).
- Roadmap ticket feat-237 moved to complete with its `## Resolution` section; lane README counts updated.
- No dead-end or experimental code left in the diff.
