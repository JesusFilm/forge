---
title: "feat: Admin Experience AI Chat — Ollama Provider Channel"
type: feat
status: active
date: 2026-05-11
---

# feat: Admin Experience AI Chat — Ollama Provider Channel

## Summary

Add an Ollama-backed AI provider channel (default model `gemma4:e4b`, talking to
the local Ollama server already in use for embeddings) alongside the existing
OpenRouter-free + Codex providers in the Experience AI Chat. Editors pick the
provider from a dropdown in the chat composer; the choice flows from UI → SSE
route → `streamChatTurn` and routes both the quality-draft generation path and
the chat-turn (mutation envelope) path to either OpenRouter or Ollama. Codex
stays available as today's behavior and is unaffected by the new selector.

---

## Problem Frame

Today the chat service has exactly one option per flow: quality-draft goes to
OpenRouter free-tier models; the chat-turn (mutation envelope) goes to Codex via
`spawn`. Editors who want to test a local Ollama model (cost-free, deterministic
across sessions, runs offline) have no way to do so. Operations also has no
fallback channel when OpenRouter is rate-limited or unreachable. Adding Ollama
as a first-class peer — selectable per turn — gives editors a side-by-side
quality bench and gives ops a runtime escape hatch without redeploys.

---

## Requirements

- R1. Add a UI dropdown to the chat composer that lets the editor pick a
  provider channel before sending a turn. Default value is `openrouter` so the
  current behavior is unchanged for anyone who ignores the selector.
- R2. The selected provider is sent on every `POST /api/experience-chat/stream`
  request and is honored by `streamChatTurn` for both flows:
  - Quality-draft generation (the `inBriefMode && wantsBriefGeneration` branch
    in `experience-ai-chat.service.ts` line ~566).
  - Chat-turn mutation envelope (the post-brief branch using Codex spawn
    at line ~668-846).
- R3. Implement an Ollama provider service that mirrors the existing
  `experience-ai-openrouter-free.ts` contract — structured-JSON output for
  quality-draft, NDJSON streaming for chat-turn, typed errors, timeout, abort.
- R4. Model default is `gemma4:e4b` and base URL reuses the existing
  `OLLAMA_BASE_URL` env. Both are overrideable via env without code changes.
- R5. Errors map onto the existing `ChatErrorCode` union (no new error codes);
  the route handler and UI keep their current error-rendering paths.
- R6. The provider stamp on persisted `ExperienceChatMessage` rows reflects the
  channel actually used (`"openrouter-free" | "ollama-gemma4" | "codex" |
"brief"`) so chat history can be audited per provider.
- R7. Tests cover: provider routing in the chat service for each flow, the
  Ollama adapter (mocked `fetch`), the stream-route Zod parsing of the new
  field, the stream client passing the new field, and the composer dropdown
  state.
- R8. Default behavior is byte-identical for callers that omit the `provider`
  field — protects every existing test that asserts `providerKind:
"openrouter-free"` or `providerKind: "codex"`.

---

## Scope Boundaries

- Codex stays as today. The dropdown exposes only `openrouter` and `ollama`;
  Codex remains the implicit default for the chat-turn path on
  `provider="openrouter"` (Codex IS the chat-turn provider when OpenRouter is
  selected — quality-draft uses OpenRouter, chat-turn uses Codex). The
  selector swaps both halves at once.
- No automatic fallback. If Ollama fails, the user sees the error and can
  re-send with OpenRouter selected. Adding cross-provider retry is a separate
  decision.
- No model picker inside the Ollama channel. The single model is
  `OLLAMA_CHAT_MODEL ?? "gemma4:e4b"`; per-turn model override is deferred.
- No streaming-quality-draft. The quality-draft path stays a single
  `await`+validate (not token-by-token) for both providers. The chat-turn path
  keeps the per-line token streaming behavior, ported from Codex's stdout
  shape to Ollama's NDJSON shape.
- Auth/permission gating is unchanged. The dropdown is purely client-side and
  cannot bypass `hasPermission("write:experiences")` enforced in the route.

### Deferred to Follow-Up Work

- Per-channel rate limits / per-model token budgets — currently the route
  shares one Redis bucket across providers.
- Telemetry dashboard panel comparing provider usage and error rates.
- Ollama health probe surfaced under `/api/health` (today only embeddings
  reach Ollama; adding chat means the dependency surface widens).
- "Auto-fallback" mode that retries the other channel on provider failure.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/services/experience-ai/experience-ai-openrouter-free.ts` —
  reference shape for a structured-output provider: timeout via
  `AbortController`, multi-model fallback loop, typed
  `OpenRouterFreeProviderError` discriminated by `code`, attempts log,
  `parseProviderJson` strips markdown fences.
- `apps/admin/src/services/ollama-embedding.service.ts` — reference for
  reaching the local Ollama HTTP API (`new URL("api/embed", base)`,
  `AbortSignal.timeout`, zod-validated response). Ollama's chat endpoint at
  `/api/chat` follows the same conventions.
- `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts` — the
  flow split (`inBriefMode` quality-draft branch vs the codex-spawn chat-turn
  branch) and the `providerKind` stamp on the persisted assistant message.
- `apps/admin/src/services/experience-ai/experience-ai-quality-draft.ts` —
  current single-provider quality-draft entry point with
  `QualityExperienceDraftError`.
- `apps/admin/src/app/api/experience-chat/stream/route.ts` — Zod-validated
  request body, SSE encoding, abort plumbing.
- `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
  (line ~772 composer markup) — where the new dropdown lives, beside the
  existing `confirmAcrossLocales` checkbox.
- `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-stream-client.ts`
  — the `StreamChatRequestBody` type that needs the new field.

### Institutional Learnings

- Outbound timeout discipline (root `CLAUDE.md`): any non-`AbortSignal`-aware
  HTTP client needs `Promise.race` + typed `TimeoutError`. Ollama supports
  `AbortSignal` natively via `fetch`, so the simpler pattern from
  `ollama-embedding.service.ts` (`signal: AbortSignal.timeout(N)`) applies.
- Streaming abort plumbing pattern is already in place: the route hands
  `request.signal` to `streamChatTurn` → propagates to provider call. Reuse —
  do not invent a parallel cancellation channel.
- "Default behavior is byte-identical when caller omits the new field"
  invariant — same shape as the hybrid-search `mode` arg in
  `apps/admin/src/services/hybrid-search.service.ts`. Lock in with a
  regression-style test where `provider` is omitted and the result matches
  the existing OpenRouter+Codex stamps exactly.

### External References

- Ollama HTTP API — `POST /api/chat` accepts `{model, messages, stream,
format, options}` and returns either a JSON object (when `stream: false`)
  or NDJSON stream of `{message: {content}, done}` chunks. `format: "json"`
  forces JSON-mode output. Docs:
  <https://github.com/ollama/ollama/blob/main/docs/api.md>.

---

## Key Technical Decisions

- **Discriminated `ChatProvider` type at one source of truth.** Define
  `type ChatProvider = "openrouter" | "ollama"` once and import it through
  service, route, client, and panel. Avoid string-literal drift between
  layers (the kind of bug that turns into a silent fallback to default).
- **Single model per provider, env-overridable.** `OLLAMA_CHAT_MODEL` env
  var defaults to `gemma4:e4b`. Mirrors the
  `OPENROUTER_EXPERIENCE_CHAT_MODEL[S]` pattern but without the CSV fallback
  ladder — Ollama is a local install, so multi-model fallback adds
  complexity without operational benefit.
- **Quality-draft uses Ollama's non-stream `/api/chat` with `format: "json"`.**
  Mirrors OpenRouter's `response_format: json_schema` semantics. Validate
  with the existing `QualityDraftPackageSchema`, surface validation errors
  as the existing `provider_validation_failed` code.
- **Chat-turn streaming uses Ollama's NDJSON `/api/chat` with `stream:
true`.** Buffer-and-line-split (same logic as Codex stdout), yield each
  delta as `token_delta`, parse the accumulated content as JSON envelope at
  end-of-stream. Reuse the same `ChatMutationEnvelopeSchema` validation
  step and the same envelope-rejection error codes.
- **The dropdown swaps BOTH flows at once.** Editor sees one selector, not
  two — flow split is an implementation detail. Per the requirements
  (R2): `provider="ollama"` means BOTH quality-draft AND chat-turn use
  Ollama; `provider="openrouter"` means quality-draft uses OpenRouter and
  chat-turn keeps Codex (today's behavior).
- **`providerKind` enum value for Ollama is `"ollama-gemma4"`.** Follows the
  precedent of `"openrouter-free"` (provider+tier slug rather than bare
  vendor name); leaves room for a future `"ollama-other"` channel without
  collision. Schema for `ExperienceChatMessage.providerKind` is `String`
  in Prisma — no migration needed.
- **No new error codes.** Ollama provider errors map to existing
  `ChatErrorCode` literals (`provider_not_configured`,
  `provider_unavailable`, `provider_timeout`, `provider_validation_failed`,
  `provider_rate_limited` — the last not used by Ollama since it has no
  rate limiter, but the union stays uniform).
- **Default-on-omit is `"openrouter"`.** The Zod body in the route makes
  `provider` optional; missing/null/empty/unknown all coerce to
  `"openrouter"` to preserve existing behavior. The chat service
  normalizes the input at the entry point so every internal branch can
  trust a closed-set value.
- **`EXPERIENCE_AI_ALLOW_CODEX_FALLBACK` only gates the
  `provider="openrouter"` chat-turn path.** Ollama chat-turn never spawns
  Codex, so the gate is irrelevant on the Ollama branch and shouldn't
  block a perfectly valid Ollama turn just because Codex is off in this
  env. Lift the gate inside the chat-turn branch, after we know which
  provider was selected.

---

## Open Questions

### Resolved During Planning

- Where does the dropdown live? — Beside the existing
  `confirmAcrossLocales` checkbox in the chat composer (clear visual
  grouping of pre-send toggles).
- Codex stays as today? — Yes. `provider="openrouter"` keeps Codex for
  chat-turn; only `provider="ollama"` swaps both halves.
- Does Ollama get a multi-model fallback ladder? — No. One model per
  channel, env-overridable.
- Does the route reject unknown `provider` values? — No. Unknown coerces
  to `"openrouter"` with a single structured log line, matching the
  hybrid-search `mode` discipline (graceful, observable, never throws).

### Deferred to Implementation

- Exact JSON-schema format Ollama prefers for `format`. Ollama supports
  `format: "json"` (loose) and `format: { ... }` (JSON schema-shaped).
  Try the schema-shaped variant first; fall back to `format: "json"` +
  a `QualityDraftPackageSchema.safeParse` retry if Ollama's
  schema-coercion isn't tight enough on `gemma4:e4b`.
- The exact NDJSON parsing boundary (Ollama sometimes emits partial
  JSON when the connection breaks mid-chunk). Reuse the readline-buffered
  pattern from `runCodexChat` if NDJSON-parse-as-you-go proves flaky.
- Whether to mock Ollama in tests with a local NDJSON fixture or to gate
  the real-Ollama tests behind a `OLLAMA_INTEGRATION=1` env. Default
  position: all tests mock; add one optional integration test that runs
  only when the env is set.

---

## Implementation Units

### U1. Env + shared `ChatProvider` type

**Goal:** Land the env var and the discriminated provider type that every
downstream layer imports.

**Requirements:** R4, R8

**Dependencies:** None

**Files:**

- Modify: `apps/admin/src/config/env.ts` — add `OLLAMA_CHAT_MODEL` (optional,
  default `"gemma4:e4b"`).
- Modify: `apps/admin/.env.example` — document the new env beside the existing
  Ollama section.
- Create: `apps/admin/src/services/experience-ai/experience-ai-chat-provider.ts`
  — exports `ChatProvider` type, `normalizeChatProvider(raw): ChatProvider`
  helper, and `DEFAULT_CHAT_PROVIDER` constant.
- Test: `apps/admin/src/services/experience-ai/experience-ai-chat-provider.test.ts`

**Approach:**

- `ChatProvider = "openrouter" | "ollama"` (closed union, no `as const`
  array — keep the type the source of truth).
- `normalizeChatProvider(raw: unknown): ChatProvider` accepts anything,
  trims, lowercases, returns the matched literal or `DEFAULT_CHAT_PROVIDER`
  on miss. Emits one structured warning log on unknown so ops can spot
  client-side drift.
- Env var `OLLAMA_CHAT_MODEL` follows the existing pattern in `env.ts`
  (zod `z.string().min(1).optional()` + `emptyToUndefined` in the runtime
  block).

**Patterns to follow:**

- `apps/admin/src/services/hybrid-search.service.ts` `normalizeMode`
  (graceful unknown-handling + sanitized log).

**Test scenarios:**

- Happy path: `normalizeChatProvider("openrouter")` → `"openrouter"`;
  `normalizeChatProvider("ollama")` → `"ollama"`.
- Edge case: `normalizeChatProvider(undefined)` → `DEFAULT_CHAT_PROVIDER`.
- Edge case: `normalizeChatProvider("OLLAMA")` → `"ollama"` (case-insens).
- Edge case: `normalizeChatProvider("   ollama  ")` → `"ollama"` (trimmed).
- Error path: `normalizeChatProvider("gpt5")` → default + log line is
  emitted (assert the log mock captured the sanitized form).
- Edge case: `normalizeChatProvider(null)` → default.

**Verification:**

- `env.OLLAMA_CHAT_MODEL` is reachable in service code with the documented
  default. Importing `ChatProvider` from the new module produces a
  closed-set type.

---

### U2. Ollama provider adapter (quality-draft mode)

**Goal:** Implement a structured-output Ollama client analogous to
`generateOpenRouterFreeStructuredOutput`. Used by the quality-draft path.

**Requirements:** R3, R4, R5

**Dependencies:** U1

**Files:**

- Create: `apps/admin/src/services/experience-ai/experience-ai-ollama.ts` —
  exports `generateOllamaStructuredOutput<T>(...)`, `OllamaProviderError`
  (typed code union mirroring `OpenRouterFreeProviderError`), and
  `OllamaProviderAttempt` (single-attempt only — no ladder).
- Test: `apps/admin/src/services/experience-ai/experience-ai-ollama.test.ts`

**Approach:**

- POST to `${OLLAMA_BASE_URL}/api/chat` with `{model: env.OLLAMA_CHAT_MODEL
?? "gemma4:e4b", messages, stream: false, format: "json", options:
{temperature, num_predict}}`.
- Timeout: `AbortSignal.timeout(60_000)` — Ollama on a local GPU can take
  longer than OpenRouter's 45 s ceiling for a fresh load.
- Parse: `response.message.content` is a string; pipe through
  `stripMarkdownFence` (factor out from openrouter-free) and `JSON.parse`
  → `validate(payload)`.
- Error mapping:
  - `fetch` throws `AbortError` → `OllamaProviderError("timeout", ...)`.
  - Non-2xx → `OllamaProviderError("upstream_error", ...)`.
  - Parse / validate throw → `OllamaProviderError("validation_error", ...)`.
  - Missing base URL (env unset) → `OllamaProviderError("missing_provider",
...)`.
- Single attempt, no ladder — `attempts` array is a single-element list for
  shape parity with the OpenRouter adapter.

**Patterns to follow:**

- `apps/admin/src/services/experience-ai/experience-ai-openrouter-free.ts` —
  error class shape, `parseProviderJson`, attempt log shape.
- `apps/admin/src/services/ollama-embedding.service.ts` — URL construction
  with trailing-slash normalization, `AbortSignal.timeout`, zod-validated
  response.

**Test scenarios:**

- Happy path: mocked `fetch` returns `{message:{content:"{\"x\":1}"}}` →
  `validate` is called with `{x:1}`, result has `payload`, `model`,
  `usedModel`, single-entry `attempts`.
- Edge case: content is fenced (` ```json … ``` `) → fence is stripped
  before parse.
- Edge case: content is a JSON-encoded string-of-JSON (Ollama sometimes
  double-encodes) → second `JSON.parse` recovers the object.
- Error path: `fetch` throws `AbortError` → `OllamaProviderError` with
  `code: "timeout"`.
- Error path: response is 500 → `OllamaProviderError` with
  `code: "upstream_error"` and `attempts[0].reason` includes the status.
- Error path: `validate` throws → `OllamaProviderError` with
  `code: "validation_error"`.
- Error path: `env.OLLAMA_BASE_URL` is unset → `OllamaProviderError` with
  `code: "missing_provider"`. (Note: today `OLLAMA_BASE_URL` is optional
  and falls back to `"http://localhost:11434"` in the embedding service.
  Decide whether the adapter treats that fallback as "configured" — plan
  position: yes, the fallback counts as configured to match embedding
  service behavior. Document this explicitly in the adapter.)
- Edge case: `signal` from caller is forwarded — abort it mid-flight and
  assert the fetch promise rejects with `AbortError`.

**Verification:**

- Adapter is invokable from a unit test with a stubbed `fetch` and returns
  the expected shape. Real-Ollama integration test (optional, gated by
  `OLLAMA_INTEGRATION=1`) round-trips a tiny `{x: number}` JSON output.

---

### U3. Ollama streaming adapter (chat-turn mode)

**Goal:** Implement an NDJSON-streaming Ollama client analogous to
`runCodexChat`. Used by the chat-turn path.

**Requirements:** R3, R4, R5

**Dependencies:** U1

**Files:**

- Modify: `apps/admin/src/services/experience-ai/experience-ai-ollama.ts` —
  add `runOllamaChat({prompt, abortSignal, onToken}): Promise<OllamaRunResult>`
  with the same `{kind: "envelope" | "error"}` discriminated return as
  `CodexRunResult` (export the type so the chat service can union them).
- Modify: `apps/admin/src/services/experience-ai/experience-ai-ollama.test.ts`
  — add streaming-shape tests.

**Approach:**

- POST to `/api/chat` with `{model, messages: [{role: "user", content:
prompt}], stream: true, format: "json"}`.
- Read `response.body` as a `ReadableStream` → decode UTF-8 → split on `\n`
  → for each non-empty line `JSON.parse` to `{message: {content?}, done?}`:
  - If `message.content` is a non-empty string, append to accumulator
    AND `onToken(content)` for the SSE token-delta stream.
  - If `done === true`, the next stable state is reached — try to
    `JSON.parse(accumulated)` and resolve with
    `{kind: "envelope", raw: ...}`.
- Idle timeout: 120 s (parity with `IDLE_TIMEOUT_MS` for Codex). Total
  timeout: 180 s.
- Abort: forward `abortSignal` to `fetch` via `AbortController` merge.
- Error mapping: same code set as U2, plus `idle_timeout` and `unknown` to
  parity Codex error shapes for the chat-turn path. **No new error
  codes** — they all already exist in `ChatErrorCode`.

**Patterns to follow:**

- `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`
  `runCodexChat` for the line-buffered reader pattern and the
  `idle/total timeout` shape.
- `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-stream-client.ts`
  for the chunk-boundary-safe NDJSON read loop (same trick — append to a
  buffer, split on the trailing newline, keep the tail).

**Test scenarios:**

- Happy path: mocked fetch returns a `ReadableStream` of NDJSON chunks
  `[{"message":{"content":"a"}},{"message":{"content":"b"}},{"done":true}]`
  → `onToken` called with "a", "b" in order; resolves
  `{kind: "envelope", raw: {…parsed accumulated body…}}`.
- Happy path: accumulated body parses as a valid envelope (validation
  happens in the chat service, not the adapter — the adapter only delivers
  `raw`).
- Edge case: a single chunk contains two NDJSON lines — both parsed.
- Edge case: a chunk straddles a JSON-line boundary — the buffer's
  remainder carries to the next chunk and parses correctly.
- Error path: server returns 500 before any chunk → resolves
  `{kind: "error", code: "provider_unavailable", message}`.
- Error path: stream goes idle for > IDLE_TIMEOUT_MS → resolves
  `{kind: "error", code: "codex_idle_timeout"|"provider_timeout", message}`
  (decide which alias is right; plan position: `provider_timeout` to
  reflect that Codex isn't the actor).
- Error path: abortSignal fires → resolves with an error event whose code
  is `cancelled`.
- Edge case: a chunk contains `[DONE]` or other non-JSON sentinel — log
  - skip without throwing.

**Verification:**

- Adapter resolves the expected discriminated result for each mocked
  scenario. Token deltas reach the caller in order. No test relies on a
  real Ollama instance — all use stream fakes.

---

### U4. Quality-draft path accepts a `provider` arg

**Goal:** Route `generateQualityExperienceDraft` to either OpenRouter or
Ollama based on the caller's selection.

**Requirements:** R2, R3, R6, R8

**Dependencies:** U2

**Files:**

- Modify:
  `apps/admin/src/services/experience-ai/experience-ai-quality-draft.ts` —
  accept `provider: ChatProvider`, branch to the right adapter, widen
  `QualityExperienceDraftResult["provider"]["kind"]` union to include
  `"ollama-gemma4"`, widen `QualityExperienceDraftError.attempts` type.
- Modify:
  `apps/admin/src/services/experience-ai/experience-ai-quality-draft.test.ts`
  — add the provider-routing scenarios.

**Approach:**

- Branch ONCE at the top of `generateQualityExperienceDraft` on `provider`.
- OpenRouter branch is the existing code path with no behavior change —
  signature backward-compat: `provider` is optional, defaults to
  `"openrouter"`.
- Ollama branch builds the same messages array, calls
  `generateOllamaStructuredOutput`, surfaces the same `QualityDraftReview`
  - `imageDirection` shape (re-parse via `QualityDraftPackageSchema`).
- Error mapping: `OllamaProviderError` → `QualityExperienceDraftError` with
  the corresponding code, attempts log carries the single Ollama attempt.

**Patterns to follow:**

- `apps/admin/src/services/hybrid-search.service.ts` `search()` branched
  orchestrator on `mode` — same shape: single decision at the top, two
  branches that produce a uniform output type.

**Test scenarios:**

- Happy path (provider omitted): uses OpenRouter, result.provider.kind ===
  `"openrouter-free"` — byte-identical to current behavior.
- Happy path (provider="ollama"): uses Ollama,
  result.provider.kind === `"ollama-gemma4"`, attempts has one entry.
- Error path: Ollama returns `validation_error` → throws
  `QualityExperienceDraftError("provider_validation_failed", ...)` with
  the Ollama attempt in `attempts`.
- Edge case: provider value is `undefined` vs missing key — both default
  to OpenRouter.

**Verification:**

- The two existing quality-draft tests still pass without modification
  (R8 invariant). New Ollama-branch tests assert
  `provider.kind === "ollama-gemma4"`.

---

### U5. Chat service wires `provider` through both flows

**Goal:** `streamChatTurn` accepts `provider` in its input, routes the
quality-draft branch via U4, routes the chat-turn branch via U3 when
`provider === "ollama"`, keeps the Codex path when
`provider === "openrouter"`.

**Requirements:** R2, R6, R8

**Dependencies:** U3, U4

**Files:**

- Modify:
  `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`
  — add `provider?: ChatProvider` to `StreamChatTurnInput`, normalize at
  the top of `streamChatTurn`, thread to both branches.
- Modify:
  `apps/admin/src/services/experience-ai/experience-ai-chat.service.test.ts`
  — add the provider-routing scenarios across both flows.

**Approach:**

- `provider = normalizeChatProvider(input.provider)` at the very top of
  the generator.
- Quality-draft branch (line ~566): pass `provider` to
  `generateQualityExperienceDraft({...args, provider})`. Stamp
  `providerKind: provider === "ollama" ? "ollama-gemma4" : "openrouter-free"`
  on the persisted message.
- Chat-turn branch (line ~705): branch on `provider`:
  - `"openrouter"` → existing Codex path. Gate
    `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK` stays.
  - `"ollama"` → call `runOllamaChat({prompt: promptText, abortSignal,
onToken})` instead of `runCodexChat`. The downstream envelope
    validation, slug rejection, cross-locale guard, and
    `applyChatMutation` are unchanged. Stamp `providerKind:
"ollama-gemma4"` on the persisted message.
- The brief-update path (line ~640) is NOT provider-aware — it does no
  AI call, just record-keeping. `providerKind` stays `"brief"`.

**Test scenarios:**

- Happy path quality-draft default: input has no `provider` → flow uses
  OpenRouter, `providerKind === "openrouter-free"` on the persisted row
  (R8 invariant).
- Happy path quality-draft Ollama: input `provider: "ollama"` → flow uses
  Ollama, `providerKind === "ollama-gemma4"`.
- Happy path chat-turn default: input has no `provider`, post-brief turn
  with Codex fallback enabled → runs Codex,
  `providerKind === "codex"` (R8 invariant).
- Happy path chat-turn Ollama: input `provider: "ollama"`, post-brief
  turn → runs Ollama, `providerKind === "ollama-gemma4"`. The Codex gate
  is NOT consulted on this branch.
- Edge case: input `provider: "ollama"` AND
  `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK !== true` → Ollama still runs
  (gate doesn't apply). Regression guard for the gate-lift.
- Edge case: input `provider: "garbage"` → normalizes to OpenRouter, no
  throw.
- Error path: Ollama adapter resolves with `{kind: "error", code:
"provider_unavailable"}` → service yields the same error event, no
  attempt to fall back to Codex.
- Integration: provider-stamp parity — every existing test that asserts
  `providerKind: "openrouter-free"` or `"codex"` still passes (run the
  whole `experience-ai-chat.service.test.ts` after changes).

**Verification:**

- All existing chat-service tests pass unmodified. New tests cover the
  six scenarios above.

---

### U6. Stream route accepts `provider` in the request body

**Goal:** The SSE route validates and forwards the new field.

**Requirements:** R2, R8

**Dependencies:** U1, U5

**Files:**

- Modify: `apps/admin/src/app/api/experience-chat/stream/route.ts` —
  extend the Zod `Body` schema with `provider:
z.enum(["openrouter","ollama"]).optional()`; pass through to
  `streamChatTurn`.
- Modify: `apps/admin/src/app/api/experience-chat/stream/route.test.ts` —
  add parsing tests for present/absent/invalid values.

**Approach:**

- Use the closed `z.enum(["openrouter","ollama"])` rather than `z.string()`
  so a typo lands a 400 at the route boundary (the chat service's
  graceful coerce is the SECOND line of defense, for clients that
  bypass Zod — e.g., tests calling the service directly).
- Optional + omitted → undefined flows to the service, which defaults to
  `"openrouter"`.

**Test scenarios:**

- Happy path: body without `provider` → 200, request reaches service
  with `provider: undefined` (R8 invariant — existing tests still pass).
- Happy path: body with `provider: "ollama"` → 200, request reaches
  service with `provider: "ollama"`.
- Edge case: body with `provider: "unknown"` → 400, Zod issue reported.
- Edge case: body with `provider: null` → 400 (z.enum doesn't accept
  null without `.nullable()`; decide explicitly — plan position: 400,
  align with the closed-enum stance).

**Verification:**

- Existing route tests pass unmodified. New tests cover the four
  scenarios.

---

### U7. Stream client passes `provider`

**Goal:** The browser-side stream client carries the provider field.

**Requirements:** R2, R8

**Dependencies:** U1, U6

**Files:**

- Modify:
  `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-stream-client.ts`
  — add `provider?: ChatProvider` to `StreamChatRequestBody`; include in
  the POST body when present.

**Approach:**

- Import the type from U1's shared module so client and server stay
  in lockstep.
- The fetch body construction is `JSON.stringify(body)`; just include
  the new optional key. Don't synthesize a default — let the server
  decide (graceful coerce). This keeps the wire format clean: omitted
  on the client iff the user didn't override.

**Test scenarios:**

- Happy path: caller omits `provider` → request body has no `provider`
  key (R8 — wire-format identity).
- Happy path: caller passes `provider: "ollama"` → request body has
  `"provider":"ollama"`.

**Verification:**

- A single fetch-stub test asserts the JSON body shape for each case.

---

### U8. Chat panel exposes a provider dropdown

**Goal:** Editor picks the provider before sending; selection is sent
on every turn until they change it.

**Requirements:** R1, R2

**Dependencies:** U7

**Files:**

- Modify:
  `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
  — add `const [provider, setProvider] = useState<ChatProvider>("openrouter")`
  in the same area as `confirmAcrossLocales`; render a `<select>` (native
  element, no extra UI lib) next to the cross-locale checkbox;
  pass `provider` into the `openChatStream` call.
- Modify:
  `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx`
  — add the dropdown-state test.

**Approach:**

- Native `<select>` keeps the change zero-cost and matches the existing
  visual register (the composer uses `<input type="checkbox">` and
  `<textarea>` directly). Apply the same Tailwind class shape as the
  composer for visual parity.
- `data-testid="experience-chat-provider"` on the select.
- Persist the selection in React state only (no localStorage in this
  iteration — keep scope tight; deferred to follow-up).
- Disabled while `stream.kind === "streaming"` (mirror the textarea
  disabled-state).
- Options: `<option value="openrouter">OpenRouter (default)</option>`
  and `<option value="ollama">Ollama (gemma4:e4b)</option>` — model
  name visible so editors know what they're picking.

**Test scenarios:**

- Happy path: default renders → `<select>` has value `"openrouter"`.
- Happy path: change to `"ollama"` → state updates;
  next handleSend call passes `provider: "ollama"` into `openChatStream`.
- Edge case: selecting while a turn is streaming is blocked
  (`disabled` attribute set).
- Edge case: switching back to `"openrouter"` between turns → next call
  passes that value.

**Verification:**

- Manual smoke (per CLAUDE.md "test the UI" rule): open the chat panel,
  select Ollama, send a turn, observe the token stream + final mutation
  apply. Repeat with OpenRouter. Confirm `providerKind` in the chat
  history reflects the selection.

---

## System-Wide Impact

- **Interaction graph:** UI → POST `/api/experience-chat/stream` → service →
  provider adapter. The route's rate limiter, auth, and ABAC enforcement are
  unchanged. The brief-collection path (no AI call) is untouched.
- **Error propagation:** All Ollama errors map to the existing
  `ChatErrorCode` union. No SSE consumer changes needed.
- **State lifecycle risks:** Persisted `ExperienceChatMessage.providerKind`
  now has a third value (`"ollama-gemma4"`). Downstream consumers that
  enumerate the field (chat history rendering, audit queries) get an
  unknown value — verify none have a closed-set switch that throws on
  unrecognized. (Initial scan: nothing reads `providerKind` for branching
  today; it's display-only metadata.)
- **API surface parity:** The new `provider` field is optional and absent
  by default — no breaking change for any caller. The hybrid-search-mode
  precedent (R4 extension) is the closest analog and shipped without
  incident.
- **Integration coverage:** Real Ollama on `localhost:11434` is needed for
  end-to-end smoke; the test suite stays fully mocked. CI doesn't have
  Ollama, so no integration test runs by default. A `OLLAMA_INTEGRATION=1`
  opt-in is the right granularity if we add one later.
- **Unchanged invariants:** Codex path behavior, OpenRouter behavior,
  brief-mode behavior, ABAC gating, cross-locale guard, envelope
  validation, mutation persistence shape, SSE wire format, rate-limit
  bucket. R8 is the regression guard.

---

## Risks & Dependencies

| Risk                                                                                                                  | Mitigation                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ollama isn't running on the editor's machine; selecting it produces a confusing error.                                | The first error is `provider_not_configured` or `provider_unavailable` with a clear message. UI surfaces it as a typed error already. Future follow-up: a health probe + a disabled state on the dropdown. |
| `gemma4:e4b` doesn't honor `format: "json"` tightly enough and produces invalid envelopes more often than OpenRouter. | Surface as `schema_violation` — same code the Codex path already produces on bad output. Editor sees the same UX and can retry or switch provider.                                                         |
| NDJSON parsing edge case breaks chat-turn mid-stream.                                                                 | U3 test scenarios cover chunk-straddle, multi-line-per-chunk, and abort cases. The Codex-stdout precedent shows the buffer-and-split pattern is sound.                                                     |
| Providers diverge over time (one gains features the other doesn't), making the dropdown a slow source of subtle bugs. | The single `ChatProvider` type forces every call site to handle both — adding a new flow without considering both branches is a TS error.                                                                  |
| `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK` gate is lifted incorrectly and Codex runs on the Ollama branch.                  | U5 test scenario explicitly asserts the gate is bypassed only on the Ollama branch; the OpenRouter branch keeps the gate.                                                                                  |
| `providerKind` widens to a third value and breaks an enum-switch somewhere we missed.                                 | Grep for `providerKind` before merge; today the field is metadata-only — no consumer switches on it.                                                                                                       |

---

## Documentation / Operational Notes

- Add a one-line note to `apps/admin/CLAUDE.md` under a new "Experience AI
  Chat providers" mini-section (or extend the existing relevant block) so
  future agents know both channels exist and which env vars control them.
- Update `apps/admin/.env.example` with `OLLAMA_CHAT_MODEL=gemma4:e4b`
  and a short comment about Ollama being a peer of OpenRouter.
- No migration. No deployment ordering concern. No Doppler change required
  for the default — the default ships in code.
- For Railway deployment: Ollama isn't reachable from Railway. Production
  Ollama selection would surface `provider_unavailable` immediately. We
  accept this — Ollama is a local-dev / future-self-host channel; future
  work could surface a "channel availability" probe in the dropdown.

---

## Sources & References

- Related code:
  - `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`
    (lines ~120–260 envelope schema + Codex runner; ~566 quality-draft
    branch; ~668–846 chat-turn branch)
  - `apps/admin/src/services/experience-ai/experience-ai-openrouter-free.ts`
    (provider adapter contract)
  - `apps/admin/src/services/experience-ai/experience-ai-quality-draft.ts`
    (quality-draft entry point)
  - `apps/admin/src/services/ollama-embedding.service.ts` (Ollama HTTP
    call style already in the repo)
- Related plan: `docs/plans/2026-05-11-001-feat-admin-ai-chat-quality-first-generation-plan.md`
  (the quality-first work that introduced the OpenRouter free-tier loop
  this plan extends)
- External docs: Ollama HTTP API —
  `https://github.com/ollama/ollama/blob/main/docs/api.md`
