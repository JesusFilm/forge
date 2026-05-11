---
title: "Admin Experience AI Chat — Four Provider Channels"
status: ready-for-planning
date: 2026-05-11
---

# Admin Experience AI Chat — Four Provider Channels

## Summary

Expand the Experience AI Chat provider selector from one implicit binding
(OpenRouter free for quality-draft, Codex CLI for chat-turn) to **four
explicit channels**: `openrouter`, `ollama`, `codex`, `claude-code`. The
editor picks a channel from a single dropdown in the chat composer; the
selection routes both flows (quality-draft generation and chat-turn
mutation envelope) through the same provider. The motivation is to use
the editor's existing paid CLI subscriptions (Codex, Claude Code) as
first-class peers rather than relying on free OpenRouter quota or
needing to wait for one provider's rate-limit to lift.

This brainstorm supersedes the scope of the in-flight Ollama provider
plan (`docs/plans/2026-05-11-002-…ollama-provider-channel-plan.md`).
That plan's U1–U3 (the shared `ChatProvider` type and the Ollama HTTP
adapter) ship as-is and ground the new design; U4–U8 are redesigned to
cover all four channels in a single PR.

---

## Problem Frame

Today the chat surface has two flow-bound providers wired implicitly
under a single nominal choice:

- Quality-draft generation calls OpenRouter free-tier models
  (`generateOpenRouterFreeStructuredOutput`).
- Chat-turn mutation envelope spawns the local `codex` CLI
  (`runCodexChat`), gated by `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK`.

The editor has no way to swap either half. OpenRouter free has limited
quota and shifting model availability; the editor already pays for a
Codex subscription and a Claude Code subscription, so the free tier is
the bottleneck rather than the right baseline. Adding Ollama (current
in-flight work) gives editors a local channel for free; adding Codex
and Claude Code as first-class peers lets editors lean on capacity
they have already paid for, side-by-side bench-test model quality
across providers, and route around individual provider outages without
a redeploy.

The motivation is operational and cost-driven, not architectural
purity. We are not migrating away from any provider — we are widening
the set of channels the same editor can pick from turn-to-turn.

---

## Requirements

- R1. The chat composer exposes a single provider dropdown with four
  options: `openrouter`, `ollama`, `codex`, `claude-code`. Default is
  `openrouter` so behavior is unchanged for editors who ignore the
  selector.
- R2. The selected channel drives **both flows** uniformly:
  quality-draft generation (`inBriefMode && wantsBriefGeneration`
  branch) and chat-turn mutation envelope (post-brief Codex-spawn
  branch).
- R3. HTTP-API channels (`openrouter`, `ollama`) reach their respective
  endpoints. CLI channels (`codex`, `claude-code`) spawn the local
  binary with stdin/stdout piping, mirroring today's `runCodexChat`
  shape.
- R4. CLI channels use **prompt-engineered JSON output** for
  quality-draft — same trick the existing Codex chat-turn uses for the
  mutation envelope, applied to the `QualityDraftPackageSchema`. Model
  quality determines reliability; the contract is "ask for strict JSON
  and validate."
- R5. Each CLI channel has its own opt-in env gate so production (which
  has no CLI binaries) can refuse to spawn:
  - `EXPERIENCE_AI_ALLOW_CODEX` (renamed from
    `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK` for clarity)
  - `EXPERIENCE_AI_ALLOW_CLAUDE_CODE`
- R6. Provider errors map to the existing `ChatErrorCode` union — no
  new codes are introduced. The route and UI consume errors uniformly.
- R7. Persisted `ExperienceChatMessage.providerKind` reflects the
  channel actually used:
  - `openrouter-free` (quality-draft only; existing Codex chat-turn
    keeps `codex` until R8)
  - `ollama-gemma4`
  - `codex` (existing — now used for quality-draft too when picked)
  - `claude-code`
  - `brief` (unchanged — record-keeping path)
- R8. Default-on-omit is `"openrouter"`. Existing tests that assert
  current `providerKind` values keep passing without modification.
- R9. The dropdown's options are visually grouped or labeled to make
  the operational tradeoff visible:
  - "OpenRouter (free, cloud)"
  - "Ollama (local, free)" — model name visible
  - "Codex (paid, local CLI)"
  - "Claude Code (paid, local CLI)"
- R10. CLI options surface a disabled state (or a clear error message
  on attempted send) when the corresponding env gate is off. Avoids
  silent fallbacks the editor doesn't know happened.

---

## Actors

- A1. **Experience editor** — chooses provider per-turn, sees which
  channel was used in chat history, can compare provider output
  side-by-side.
- A2. **Admin operator** — controls per-channel env gates on the
  Railway service; can disable a CLI channel without a redeploy by
  flipping the gate.

---

## Key Flows

- F1. Editor opens the chat panel → dropdown defaults to
  `openrouter` → sends a turn → existing behavior (OpenRouter for
  quality-draft, Codex for chat-turn). **R8 invariant.**
- F2. Editor switches dropdown to `ollama` → sends a turn → Ollama
  serves both flows.
- F3. Editor switches dropdown to `codex` → sends a turn → Codex CLI
  serves both flows (quality-draft uses a new prompt+spawn path; chat-
  turn keeps the existing path).
- F4. Editor switches dropdown to `claude-code` → sends a turn →
  Claude Code CLI serves both flows.
- F5. Editor picks a CLI channel in an env where its gate is off →
  request returns a typed `provider_not_configured` error with a
  message naming the gate to flip. Chat history is unchanged.
- F6. Editor opens chat history → each assistant message shows which
  channel produced it (`providerKind` field on the row).

---

## Acceptance Examples

- AE1. *(covers R1, R2, R8)* With the dropdown at `openrouter`,
  a fresh chat turn produces the same outcome (same `providerKind`
  stamps, same envelope shape) as before this change. Verified by
  re-running every existing chat-service test without modification.
- AE2. *(covers R2, R7)* Picking `ollama`, the persisted assistant
  row stamps `providerKind: "ollama-gemma4"` for both quality-draft
  and chat-turn flows in the same thread.
- AE3. *(covers R3, R4)* Picking `codex` on a quality-draft turn,
  the spawn output is parsed by `QualityDraftPackageSchema` and the
  staged draft renders in the canvas. If the parse fails, the error
  is `provider_validation_failed`, matching the existing OpenRouter
  error path.
- AE4. *(covers R5, R10)* With `EXPERIENCE_AI_ALLOW_CLAUDE_CODE`
  unset, picking `claude-code` returns `provider_not_configured`
  with a message referencing the env name. No CLI spawn is attempted.
- AE5. *(covers R6)* Each provider's failure modes (timeout,
  upstream error, validation failure) map onto the existing
  `ChatErrorCode` literals. The chat panel's error rendering is
  unchanged.
- AE6. *(covers R9)* The dropdown's option labels indicate cost
  posture so editors don't accidentally hammer a paid channel for
  routine work.

---

## Scope Boundaries

### Deferred for later

- Claude API direct integration (HTTP, not CLI) as a fifth channel.
  Useful when production needs Claude-quality output without a local
  CLI; out of scope here because the user's stated motivation is
  paid-subscription CLI access.
- Per-channel rate limiting or quota tracking. The route's single
  Redis bucket continues to cover all providers.
- Auto-fallback (channel A fails → try channel B). The dropdown is
  explicit; failures surface to the editor who can re-send manually.
- Per-channel model picker. Each channel uses its single default
  model (overrideable via env). Avoids dropdown nesting / option
  explosion.
- Streaming JSON validation mid-turn. The chat-turn path keeps the
  existing end-of-stream `safeParse` semantics for all channels.
- Channel health probe surfaced on `/api/health`. CLI binary presence
  detection is non-trivial cross-platform; deferred.

### Outside this product's identity

- "AI chat" is not becoming a multi-tenant playground for arbitrary
  models. Provider channels are a small fixed set with operational
  rationale (paid subscription, local model, free fallback) — adding
  every new vendor as a channel is explicitly out. Future additions
  pass the same bar: meaningful operational distinction, not vendor
  parity.
- The dropdown is not a routing UI for non-chat AI work
  (image generation, embeddings, etc.). Those surfaces have their
  own provider stories.

### Deferred to Follow-Up Work

- Migrating existing `providerKind: "codex"` history rows to a new
  stamping convention (e.g., distinguishing "codex via openrouter
  pick" from "codex via explicit pick"). Today's rows are read-only
  metadata — disambiguation is a future audit concern, not a
  blocker.

---

## Key Decisions

- **Single dropdown, both flows.** Editors think in "what model
  should answer this turn"; splitting the dropdown per-flow doubles
  the cognitive surface without operational benefit. The dropdown
  drives both flows uniformly. Rationale: today's hybrid (OpenRouter
  for QD, Codex for CT under one nominal choice) is an artifact of
  history, not a feature.
- **CLI channels do prompt-engineered JSON.** The chat-turn Codex
  path already proves this works (it produces a strict JSON envelope
  on every successful turn). Quality-draft uses a more complex
  package shape, but the same approach applies. Model behavior
  determines reliability; we surface validation errors as
  `provider_validation_failed` and let the editor retry or switch
  channels.
- **Per-channel env gates, renamed for clarity.** The legacy
  `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK` becomes
  `EXPERIENCE_AI_ALLOW_CODEX` (it's no longer "fallback when
  OpenRouter is missing" — it's the gate for picking Codex
  explicitly). Add `EXPERIENCE_AI_ALLOW_CLAUDE_CODE`. Backward-compat
  shim reads the old name for one release window.
- **CLI channels are local-dev primary.** Railway containers don't
  ship the `codex` or `claude` binaries. Production with
  `provider="codex"` returns `provider_not_configured`. We accept
  this — the operational story is "editors run admin locally for
  CLI-backed turns, run it through Railway for OpenRouter/Ollama
  turns." Documenting clearly is more valuable than building an
  installer.
- **Default stays `openrouter` for R8 backward compat.** Every
  existing test that asserts current `providerKind` keeps passing
  without modification. The default-on-omit path is the regression
  guard.
- **Build on the in-flight Ollama work.** U1 (shared `ChatProvider`
  type) and U2/U3 (Ollama adapter) already shipped on the branch.
  The 4-channel plan widens the `ChatProvider` union, adds two CLI
  adapters mirroring the Ollama shape, and replaces U4–U8 with a
  uniform routing layer that handles all four channels.

---

## Dependencies / Assumptions

- A1. Codex CLI and Claude Code CLI are installable on the editor's
  local machine. We don't bundle them; we depend on the editor
  having already installed them as part of using their respective
  subscriptions.
- A2. Both CLIs accept a stdin prompt and emit a JSON envelope on
  stdout when prompted for one. Verified for Codex (the current
  chat-turn path already does this). **Unverified for Claude Code
  CLI** — the planning phase must confirm or pivot to the Anthropic
  SDK direct API as the implementation route. If pivoting, the
  channel becomes `claude-api` (HTTP) rather than `claude-code` (CLI)
  in name and behavior; the dropdown label can stay "Claude Code" if
  the editor experience is equivalent.
- A3. Subscription-based CLI usage doesn't rate-limit in a way that
  shows up as failure on the editor's normal cadence. If it does,
  the editor sees `provider_unavailable` and can switch channels.
- A4. The `ExperienceChatMessage.providerKind` Prisma column accepts
  any string (it does — verified earlier in planning). No DB
  migration needed to add `claude-code` and re-use the existing
  `codex` value.

---

## Outstanding Questions

### Deferred to Planning

- Exact CLI invocation shape for Claude Code (binary name, args,
  prompt-input mode). Verify against the actual installed CLI before
  writing the adapter. If the CLI doesn't support stdin-based
  one-shot JSON output, pivot to the Anthropic SDK as the
  implementation path (per A2).
- Should the dropdown be `<select>` (native, no extra deps) or a
  richer combobox? Today's composer uses native checkbox/textarea;
  the in-flight Ollama plan picked native `<select>`. Stay with
  native unless planning surfaces a reason to upgrade.
- Should we expose a "compare across channels" mode (send the same
  prompt to multiple channels, see outputs side-by-side)? Out of
  scope for this brainstorm — flag for future, since the dropdown
  abstraction makes it implementable.

---

## Success Criteria

- The chat composer's dropdown lists exactly four options and the
  default is `openrouter`. Every existing chat test passes without
  modification.
- An editor can switch to any channel mid-thread; the next turn uses
  the new provider; the chat history row stamps the right
  `providerKind`.
- Picking a CLI channel in an env without the binary surfaces a
  clean typed error and does NOT spawn anything.
- The OpenRouter-free quota outage scenario is solvable in seconds
  by an editor switching to `ollama`, `codex`, or `claude-code` —
  no admin redeploy required.

---

## Sources & References

- In-flight Ollama plan:
  `docs/plans/2026-05-11-002-feat-admin-experience-ai-chat-ollama-provider-channel-plan.md`
- Existing Codex chat-turn path:
  `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`
  (lines ~250–460 `runCodexChat`, ~668–846 chat-turn branch)
- Existing OpenRouter quality-draft:
  `apps/admin/src/services/experience-ai/experience-ai-openrouter-free.ts`
- Ollama adapter (already shipped in U1–U3):
  `apps/admin/src/services/experience-ai/experience-ai-ollama.ts`
- Shared provider type:
  `apps/admin/src/services/experience-ai/experience-ai-chat-provider.ts`
