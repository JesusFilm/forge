---
title: "Wiring a Mastra conversational agent: @mastra/memory API, model-router provider/key, and the catalog-vs-live trap"
date: 2026-06-09
last_refreshed: 2026-06-18
category: integration-issues
module: apps/mastra
problem_type: integration_issue
component: assistant
symptoms:
  - "A model id that type-checks against Mastra's generated provider catalog fails at runtime with an opaque provider error, even though a sibling catalog entry works"
  - "Memory.recall on a never-saved thread throws No thread found with id when resourceId is passed, but returns an empty list when resourceId is omitted"
  - "Setting OPENROUTER_API_KEY has no effect on an existing openai/ model string; the agent still calls OpenAI"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
related_components:
  - apps/admin
tags:
  - mastra
  - mastra-memory
  - model-router
  - openrouter
  - conversational-agent
  - in-memory-store
  - catalog-vs-live
---

# Wiring a Mastra conversational agent: memory, model-router, and the catalog-vs-live trap

## Problem

Standing up the first conversational `Agent` in `apps/mastra` (the feat-198
seeker skeleton) surfaced three non-obvious `@mastra/core` / `@mastra/memory`
contracts that type-check cleanly but behave differently than they read. Each
costs real time the first time you hit it.

## Symptoms

- A model string like `openrouter/google/gemma-4-26b-a4b-it:free` passes
  `tsc` (the model-router id type ends in `| (string & {})`, so **any** string
  compiles — catalog membership buys no compile-time safety) but failed at
  runtime with an opaque `provider returned error` (no detail captured), while
  the sibling `openrouter/google/gemma-4-31b-it:free` worked.
- `memory.recall({ threadId, resourceId })` on a thread that was never saved
  **throws** (`No thread found with id …`) rather than returning an empty result
  — so a cross-thread isolation test that skips thread creation crashes instead
  of failing soft. The throw is gated on `resourceId`: `recall({ threadId })`
  with no `resourceId` returns an empty list instead (see Solution §1).
- Switching the seeker from OpenAI to OpenRouter by only setting
  `OPENROUTER_API_KEY` (leaving the `openai/...` model string) had no effect —
  the agent still tried OpenAI and failed auth.

## What Didn't Work

- **Trusting the typed catalog as proof a model is live.** Mastra's
  `@mastra/core` ships `llm/model/provider-types.generated.d.ts`, a generated
  union of provider/model ids. But that union ends with a `(string & {})` arm, so
  **any** string compiles — a typo or a made-up id passes `tsc` too. Catalog
  membership is therefore not even a compile-time guarantee the id is well-formed,
  let alone that the upstream provider serves it. In the feat-198 smoke,
  `gemma-4-26b-a4b-it:free` (a union member) failed at runtime with an opaque
  `provider returned error` while the sibling `gemma-4-31b-it:free` worked. The
  specific cause of that failure was never captured from logs — catalog-vs-live
  is a plausible explanation but is **not confirmed** for that incident (it could
  equally have been a rate limit, a transient outage, or that `:free` variant
  being temporarily unavailable). What is certain and structural: the catalog is
  a compile-time list, not a liveness check. (A 2026-06-18 re-test of the sibling
  `gemma-4-31b-it:free` — see Prevention — found exactly this intermittent,
  fast-failing `Provider returned error` behavior with successful immediate
  retries, which makes a free-tier rate-limit/capacity cause the most likely
  explanation for the original `26b-a4b` failure too.)
- **Assuming the API key alone selects the provider.** The model-router string's
  **prefix** selects provider + endpoint + which env var holds the key; setting a
  different key does not redirect an existing prefix.
- **Guessing the memory API from admin's persisted setup.** Admin's
  `getMastraMemory()` only ever calls `new Memory({ storage })`; the thread-level
  read/write methods (`saveThread` / `saveMessages` / `recall`) had to be
  verified against the installed `@mastra/memory@1.18.2` dist types — they are
  not `createThread` / `query`.

## Solution

### 1. `@mastra/memory` thread API (verified against 1.18.2)

The methods are `saveThread` / `saveMessages` / `recall` — **not**
`createThread` / `query`. Every thread must be saved before any `resourceId`-scoped
`recall`, and each message carries its own `threadId` / `resourceId` (there is no
top-level `threadId` arg on `saveMessages`). Message content is the v2 shape
`{ format: 2, parts, content }`.

```ts
await memory.saveThread({
  thread: { id, resourceId, title, metadata: {}, createdAt, updatedAt },
})
await memory.saveMessages({
  messages: [
    {
      id,
      role: "user",
      threadId,
      resourceId,
      createdAt,
      content: { format: 2, parts: [{ type: "text", text }], content: text },
    },
  ],
})
const { messages } = await memory.recall({ threadId, resourceId })
```

`recall({ threadId, resourceId })` on a thread that was never `saveThread`'d
**throws** (`No thread found with id …`) — **but only when `resourceId` is
passed.** The ownership check that throws is gated on `resourceId`;
`recall({ threadId })` with no `resourceId` skips that check and returns an empty
list instead (verified against 1.18.2 with a live probe — both paths). So a
cross-thread isolation test that passes `resourceId` (as it should) must
`saveThread` every thread first, or it crashes rather than asserting.

Wire `Memory` over a dedicated `InMemoryStore` as a lazy singleton — the same
`new Memory({ storage })` shape the persisted path uses, so this one module is
the single seam where in-memory later swaps to Postgres/PgVector:

```ts
import { Memory } from "@mastra/memory"
import { InMemoryStore } from "@mastra/core/storage"

let cached: Memory | null = null
export function getSeekerMemory(): Memory {
  if (cached === null) {
    cached = new Memory({
      storage: new InMemoryStore({ id: "seeker-memory-storage" }),
    })
  }
  return cached
}
```

This mirrors `apps/admin/src/mastra/memory.ts` **by copying, never importing** —
`apps/mastra` must not import `apps/admin` (architecture rule + a real tsx/ESM
cross-package-boundary load-time crash).

### 2. Model-router prefix selects provider, endpoint, AND key

A bare model string is `<provider>/<model>`. The **prefix** drives which
provider API is called and which env var supplies the key:

- `openai/gpt-...` → OpenAI's API, reads `OPENAI_API_KEY`.
- `openrouter/<vendor>/<model>` → Mastra's built-in `openrouter` provider, which
  auto-reads `OPENROUTER_API_KEY` (its `apiKeyEnvVar` in Mastra's bundled runtime
  provider registry — not the generated `.d.ts`, which holds only the model-id
  union).

Switching providers therefore changes **two things**, not one: the prefix AND
the model id (OpenRouter's catalog is vendor-namespaced, e.g.
`openrouter/openai/gpt-4.1-mini`, `openrouter/google/gemma-4-31b-it:free`).
Setting `OPENROUTER_API_KEY` while leaving an `openai/...` string does nothing —
the prefix still routes to OpenAI. No new SDK dependency or provider object is
needed for the built-in providers.

### 3. Catalog membership ≠ live availability

A model id passing `tsc` proves almost nothing about the model: the model-router
id type ends in `| (string & {})`, so any string compiles — it does not even
confirm catalog membership, let alone that the upstream provider serves the model
on your account. Confirm with one live call (a Studio turn or a direct request)
before treating a model as wired. This is a domain instance of the
mocked-shape-vs-real-contract discipline: the type is the BRANCH SHAPE; the live
provider response is the PRODUCTION CONTRACT.

## Why This Works

- Mastra's model router is a thin gateway: the provider prefix is the routing
  key, and each provider entry declares its own `apiKeyEnvVar`. The router never
  infers the provider from "whichever key happens to be set."
- `@mastra/memory`'s `recall` validates thread ownership before reading **only
  when `resourceId` is supplied** — that ownership check is what throws on an
  unknown thread. Called without `resourceId`, there is no ownership check, so an
  unknown thread reads back as an empty set rather than throwing.
- The generated provider catalog is built from provider model lists at
  package-build time; it can include ids an account/region cannot actually call,
  so it is a compile-time convenience, not a liveness oracle.

## Prevention

- **Verify a model id with one live call before relying on it.** `tsc` green is
  not "the model works." Tool-calling support and reliability vary by model and
  are not guaranteed — verify per model with a live run. The free
  `gemma-4-31b-it:free` model IS live and DOES invoke `retrieveAnswer`: a
  2026-06-18 re-test (8 mixed Studio-UI + `generate`-API turns) succeeded on
  ~5/8, producing correctly source-cited answers over the real RAG path. The
  failures returned `Provider returned error` and **fast-failed in 3-5 s vs
  12-25 s for successes**, clustered after rapid bursts, and the same prompt
  succeeded on immediate retry — a free-tier rate-limit/capacity signature, not
  a missing or malformed model. The agent's "call retrieveAnswer again on each
  new turn — an earlier failure does not mean retrieval is down" instruction
  absorbs this within a conversation, so it is a production-promotion concern,
  not a skeleton defect. For production (sustained, reliable tool-calling),
  prefer a paid/stable model with documented tool support (e.g.
  `openrouter/openai/gpt-4.1-mini`). **Executed as an opt-in (feat-237,
  2026-07-08):** the deferred model swap now exists — `buildSeekerModelList()`
  in `seeker-agent.ts` prepends the self-hosted JesusFilm gateway chat model
  (`AI_GATEWAY_CHAT_MODEL ?? "coding"`) when `AI_GATEWAY_CHAT_API_KEY` is set
  AND `AI_GATEWAY_SEEKER_ENABLED="true"`, keeping this free-Gemma chain as the
  failover; unsetting the flag restores Gemma-only behavior with no code
  change.
- **When changing providers, change the prefix AND the model id together**, and
  confirm the matching `<PROVIDER>_API_KEY` is present. Adding an opt-in
  provider key as `.optional()` keeps it from becoming a boot precondition.
- **In memory tests, `saveThread` every thread before any `recall`**, and assert
  exact counts + message identity (not `length >= 1`) so the isolation assertion
  is non-vacuous — a no-op memory layer must fail it.
- **Copy admin's Memory shape, never import `apps/admin`.** See the cross-package
  import crash doc below.

## Related Issues

- `mastra-studio-api-auth-guard.md` — registering an agent exposes it on the
  built-in `/api/agents/*` surface; containment is the gateway/network layer,
  not custom-route absence.
- `../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the
  catalog-vs-live trap is a worked instance of this meta-pattern.
- `../runtime-errors/tsx-esm-named-export-resolution-across-workspace-package-boundary-20260508.md`
  — why `apps/mastra` copies admin's Memory wiring instead of importing it.
- `../architecture-patterns/mastra-seed-baseline-portability-pattern.md` — the
  established copy-not-import convention for the two Mastra setups.
- `../runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`
  — why opt-in provider keys must be `.optional()`.
- Plan: `../../plans/2026-06-08-003-feat-seeker-agent-skeleton-plan.md`.
