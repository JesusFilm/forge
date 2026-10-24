---
title: "Mastra agent files construct AI-SDK providers inline via createRequire — never import providers.ts"
date: 2026-07-08
category: conventions
module: apps/mastra
problem_type: convention
component: tooling
severity: high
applies_when:
  - "Adding or changing a model provider (gateway, Google, OpenRouter, Ollama) inside any apps/mastra agent, memory, or workflow file"
  - "Tempted to consolidate the duplicated gateway-construction blocks into a shared helper module"
  - "A new file needs the JesusFilm gateway base URL or User-Agent constants"
tags:
  - mastra
  - rollup
  - createrequire
  - ai-sdk
  - gateway
  - bundle-safety
---

# Mastra agent files construct AI-SDK providers inline via createRequire — never import providers.ts

## Context

The Mastra CLI's Rollup bundle (`pnpm --filter @forge/mastra build`) trips a
"Cannot determine intended module format" error on any module that reaches a
static `@ai-sdk/*` import — directly or transitively. `providers.ts` statically
imports `@ai-sdk/*`, so agent/memory files must never import from it; this is
why `createJesusFilmProvider()` has zero runtime callers (kept for its tests
and doc value). The working pattern was proven in `default-chat-agent.ts`, then
`specialized-agents.ts` (`resolveAgentModel()`), and feat-237 added the third
gateway-chat site (`seeker-agent.ts` — `buildSeekerModelList()`), which
crossed the threshold for capturing the convention as a doc instead of code
comments only. The same shim also ships in two non-chat files (see Examples) —
five files total carry it.

## Guidance

Every provider construction inside a file that the Mastra CLI bundles (agents,
memory, workflows) follows the same shape:

```ts
import { createRequire } from "node:module"

import {
  AI_GATEWAY_USER_AGENT,
  DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
} from "../gateway-constants"

// ESM-compatible require. Provider SDK requires survive the Rollup bundle
// because they target real package names; a static `import` of @ai-sdk/*
// (including transitively via ../providers) trips the module-format trap.
const require = createRequire(import.meta.url)

// ...inside the (env-gated) branch that actually needs the provider:
const { createOpenAI } =
  require("@ai-sdk/openai") as typeof import("@ai-sdk/openai")
const gateway = createOpenAI({
  apiKey: env.AI_GATEWAY_CHAT_API_KEY,
  baseURL: env.AI_GATEWAY_CHAT_BASE_URL ?? DEFAULT_AI_GATEWAY_CHAT_BASE_URL,
  name: "jesusfilm",
  headers: { "User-Agent": AI_GATEWAY_USER_AGENT },
})
const model = gateway.chat(env.AI_GATEWAY_CHAT_MODEL ?? "coding")
```

The load-bearing elements:

- **`createRequire(import.meta.url)` at module scope; `require("@ai-sdk/…")`
  inside the gated branch.** Construction stays behind the env gate so the
  missing-key throw path is unreachable when the feature is off.
- **`../gateway-constants` is the ONLY shared module** — it is deliberately
  import-free (plain string literals) so it is bundle-safe. Do not add imports
  to it; do not move the constants into `providers.ts` or `env.ts`.
- **`.chat(modelId)`, never the bare provider callable.** The bare callable
  defaults to the Responses API in `@ai-sdk/openai` v3, which crashes the
  gateway's vLLM backend on multi-turn tool conversations (`KeyError: 'role'`).
- **The Cloudflare User-Agent header** — the gateway 403s missing/odd UAs.
- **The provider-returned model needs a justified cast** (`as unknown as
MastraModelConfig` from `@mastra/core/llm`, or the older files' commented
  `as any`) — the AI SDK peer-version union drifts across copies.
- **The duplication across these sites is intentional.** Consolidating the
  construction into a shared module would give that module a static `@ai-sdk/*`
  import graph and re-create the trap. Keep the blocks inline and mirror the
  comments.

## Why This Matters

The failure is invisible in dev and fatal at deploy: `mastra dev` resolves
modules through Node/tsx and boots fine, while the Rollup production build is
what fails — so a green local run is not proof. `pnpm --filter @forge/mastra
build` is the gate that actually exercises the bundle path; run it for any
change touching imports in bundled files (dev vs build asymmetry documented in
`../tooling-decisions/mastra-dev-tsx-loader-for-raw-ts-workspace-deps.md`).

## When to Apply

- Any new model-provider wiring in `apps/mastra/src/mastra/` agent, memory, or
  workflow files.
- Any refactor that would add an import to `gateway-constants.ts` or import
  `providers.ts` from a bundled file — stop and keep the inline pattern.
- Reviewing a diff that adds a static `@ai-sdk/*` import outside
  `providers.ts`/test files.

## Examples

The three gateway-CHAT sites to mirror (same pattern, per-surface gating):

- `apps/mastra/src/mastra/agents/default-chat-agent.ts` — gateway gated on
  `AI_GATEWAY_CHAT_ENABLED`, then Google/OpenRouter/Ollama fallbacks.
- `apps/mastra/src/mastra/agents/specialized-agents.ts` (`resolveAgentModel()`)
  — same gate feeding the workflow agents.
- `apps/mastra/src/mastra/agents/seeker-agent.ts` (`buildSeekerModelList()`,
  feat-237) — gated on `AI_GATEWAY_SEEKER_ENABLED` + key, prepends the gateway
  entry ahead of the free-Gemma chain, and adds a timeout-wrapping fetch (see
  the related timeout-envelope learning).

Two more files carry the identical shim for other providers — include them in
any mirror-sweep or consolidation audit:

- `apps/mastra/src/mastra/agents/auto-enrich-agent.ts` — Google provider via
  `require("@ai-sdk/google")`.
- `apps/mastra/src/mastra/memory.ts` — gateway embeddings model via
  `require("@ai-sdk/openai")` inside `buildExperienceChatEmbedder()`.

## Related

- `../tooling-decisions/mastra-dev-tsx-loader-for-raw-ts-workspace-deps.md` —
  the dev-vs-Rollup resolution asymmetry that makes `build` the real gate.
- `../best-practices/mastra-model-entry-timeout-retry-and-stream-abort-pattern.md`
  — the timeout/retry envelope rules for gateway entries in model fallback
  arrays (feat-237's other learning).
- `apps/mastra/src/mastra/gateway-constants.ts` — the import-free shared
  constants module (its header comment carries the bundle-safety rationale).
