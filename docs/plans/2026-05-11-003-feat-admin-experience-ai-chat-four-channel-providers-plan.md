---
title: "feat: Admin Experience AI Chat — Four Provider Channels"
type: feat
status: active
date: 2026-05-11
origin: docs/brainstorms/2026-05-11-admin-experience-ai-chat-four-channel-providers-requirements.md
---

# feat: Admin Experience AI Chat — Four Provider Channels

## Summary

Widen the in-flight Experience AI Chat provider plumbing from two channels
(OpenRouter, Ollama) to four (OpenRouter, Ollama, Codex CLI, Claude Code
CLI) so the editor can pick any channel from a single dropdown that drives
both flows uniformly — quality-draft generation and chat-turn mutation
envelope. The existing Codex spawn lifts out of `experience-ai-chat.service.ts`
into its own adapter and gains a quality-draft path; a new Claude Code
adapter follows the same shape against `claude --print --output-format
stream-json`. Per-channel env gates and `R8` default-on-omit guarantees keep
production safe and existing tests green.

---

## Problem Frame

Today's chat surface implicitly binds providers to flows: quality-draft →
OpenRouter free, chat-turn → Codex CLI (gated by
`EXPERIENCE_AI_ALLOW_CODEX_FALLBACK`). The editor pays for Codex and Claude
Code subscriptions; the free OpenRouter quota is the bottleneck. The
brainstorm (see origin) resolved the product shape — four explicit channels,
single dropdown, both flows uniform — and validated the underlying CLI
capabilities during planning: both `claude` and `codex exec` support
non-interactive structured-output invocations suitable for stdin/spawn use.
The remaining work is the technical plumbing.

---

## Requirements

- R1. Dropdown with four options (`openrouter` | `ollama` | `codex` |
  `claude-code`); default `openrouter` (origin R1, R8).
- R2. Selected channel drives BOTH flows uniformly: quality-draft +
  chat-turn (origin R2).
- R3. HTTP channels (OpenRouter, Ollama) keep current adapters. CLI
  channels (Codex, Claude Code) spawn the local binary with stdin prompt
  and stdout structured JSON output (origin R3).
- R4. CLI channels use prompt-engineered JSON output for quality-draft
  AND chat-turn — both CLIs support `--output-format json` /
  `--output-schema` / `--json-schema`, so plumb the schema through (origin
  R4).
- R5. Per-channel env gates control CLI availability:
  - `EXPERIENCE_AI_ALLOW_CODEX` (rename from
    `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK`, with backward-compat shim
    reading the old name for one release window)
  - `EXPERIENCE_AI_ALLOW_CLAUDE_CODE` (new)
  Picking a gated-off CLI returns `provider_not_configured`, no spawn
  (origin R5, R10, F5, AE4).
- R6. All errors map to the existing `ChatErrorCode` literals — no new
  codes. UI and route error paths are unchanged (origin R6, AE5).
- R7. Persisted `ExperienceChatMessage.providerKind` reflects the channel
  actually used. Stamp literals: `openrouter-free`, `ollama-gemma4`,
  `codex`, `claude-code`, `brief` (origin R7).
- R8. **Backward-compat invariant.** Default-on-omit is `openrouter`.
  Every existing chat-service / route / stream-client / panel test
  passes without modification (origin R8, F1, AE1).
- R9. Dropdown options carry cost-posture labels so editors don't burn
  paid quota on routine work (origin R9, AE6).
- R10. Optional model overrides per channel via env:
  - `OLLAMA_CHAT_MODEL` (already shipped, default `gemma4:e4b`)
  - `EXPERIENCE_AI_CODEX_MODEL` (optional; falls back to Codex's
    `config.toml` default when unset)
  - `EXPERIENCE_AI_CLAUDE_CODE_MODEL` (optional; defaults to `sonnet`
    alias which Claude Code resolves to the latest Sonnet)

**Origin actors:** A1 (Experience editor), A2 (Admin operator)
**Origin flows:** F1–F6 (default behavior preserved, channel switching
per turn, env-gated CLI rejection, provider-stamp on history rows)
**Origin acceptance examples:** AE1–AE6

---

## Scope Boundaries

### Deferred for later

- Claude API direct integration (HTTP, not CLI) as a fifth channel.
  Useful when production needs Claude-quality output without a local CLI;
  out of scope here per origin's stated CLI-subscription motivation.
- Per-channel rate limiting / quota tracking. One Redis bucket continues
  to cover all providers.
- Auto-fallback (channel A fails → try channel B). Dropdown stays
  explicit.
- Streaming JSON validation mid-turn. End-of-stream `safeParse` semantics
  apply to all channels.
- Channel health probe surfaced on `/api/health`. CLI binary presence
  detection is non-trivial cross-platform.

### Outside this product's identity

- "AI chat" is not a multi-tenant model playground. Channels are a small
  fixed set with operational rationale; adding every new vendor is out.
- The dropdown does not become a routing UI for non-chat AI work
  (image-gen, embeddings, etc.).

### Deferred to Follow-Up Work

- Backfilling historical `providerKind: "codex"` rows to distinguish
  "codex via openrouter-pick (legacy)" vs "codex via explicit pick".
  Today's rows are read-only metadata; disambiguation is an audit
  concern, not a blocker.
- Per-channel telemetry dashboard panel.
- Renaming `OPENROUTER_API_KEY` / removing `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK`
  after the back-compat shim's one-release-window passes.

---

## Context & Research

### Relevant Code and Patterns

- **Already shipped on this branch (`feat/admin-chat-ollama-provider`):**
  - `apps/admin/src/services/experience-ai/experience-ai-chat-provider.ts`
    — `ChatProvider` union (currently 2 values: `openrouter` | `ollama`),
    `normalizeChatProvider`, `DEFAULT_CHAT_PROVIDER`. Widens to 4 in U1.
  - `apps/admin/src/services/experience-ai/experience-ai-chat-error-codes.ts`
    — `ChatErrorCode` union extracted from the chat service.
  - `apps/admin/src/services/experience-ai/experience-ai-ollama.ts` —
    template for an adapter that does both flows. Same shape applies to
    Codex and Claude Code adapters.
- **Existing Codex spawn path** to extract / refactor:
  `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`
  — `runCodexChat` (the spawn + readline + idle/total timeout pattern)
  and the chat-turn branch that consumes it. Today's path uses raw
  `child_process.spawn("codex", […])`; the new plan uses
  `codex exec --json --output-schema <path>` and `claude --print
  --output-format stream-json --json-schema <inline>` respectively.
- **OpenRouter adapter:**
  `apps/admin/src/services/experience-ai/experience-ai-openrouter-free.ts`
  — quality-draft contract with multi-model fallback ladder.
- **Quality-draft entry point:**
  `apps/admin/src/services/experience-ai/experience-ai-quality-draft.ts`
  — single-provider today, widens to 4-way in U6.
- **Stream route:**
  `apps/admin/src/app/api/experience-chat/stream/route.ts` — Zod-
  validated body, SSE encoding.
- **Stream client:**
  `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-stream-client.ts`
  — fetch wrapper + NDJSON SSE consumer.
- **Composer markup:**
  `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
  (line ~772) — site of the new dropdown.
- **CLI invocation verified during planning** (this session):
  - `claude --print --output-format stream-json --json-schema '<schema>'
    --model sonnet "prompt"` → streams NDJSON; supports schema
    validation.
  - `codex exec --json --output-schema <file> --model <model>` →
    structured-output mode; prompt via stdin or positional.

### Institutional Learnings

- Outbound timeout discipline: CLI spawn needs both an idle and a total
  timeout (runCodexChat already does this — reuse the pattern).
- Fire-and-forget slot-leak guard: not relevant here (no slot
  reservation in the chat path), but the principle applies — wrap full
  callback body in try/finally for any spawn cleanup.
- "Default behavior is byte-identical when caller omits the new field"
  invariant (root `CLAUDE.md`): same shape as the hybrid-search `mode`
  arg and the in-flight Ollama work. Locked in via R8 regression tests.
- Mocked-vs-real testing discipline: every typed-discriminator branch
  needs at least one test where ONLY that branch can match. Apply per-
  channel.

### External References

- Claude Code CLI docs: `claude --help` (verified locally — supports
  `--print`, `--output-format text|json|stream-json`, `--json-schema`,
  `--model`, `--max-budget-usd`, prompt as positional or stdin).
- Codex CLI docs: `codex exec --help` (verified locally — supports
  `--json`, `--output-schema <file>`, `--model`, `-o
  <output-last-message-file>`, prompt as positional or stdin).
- Origin requirements doc (this plan's source).

---

## Key Technical Decisions

- **CLI flag set, not raw stdin stuffing.** Both CLIs offer flags
  designed for programmatic use. Use them: `claude --print --output-format
  stream-json --json-schema <schema-inline>` and `codex exec --json
  --output-schema <schema-file-path>`. This is cleaner than the existing
  `runCodexChat` raw-spawn-and-prompt approach, which is preserved for
  the in-flight one release window via the back-compat shim but is not
  the new code path.
- **Single adapter file per CLI channel, mirroring Ollama's shape.**
  - `experience-ai-codex.ts` exports `generateCodexStructuredOutput`
    (quality-draft) + `runCodexChat` (chat-turn, replaces the in-service
    version).
  - `experience-ai-claude-code.ts` exports the analogous pair for
    Claude Code.
  Each adapter owns its CLI invocation, schema file lifecycle, env-gate
  check, error mapping, and timeout. Keeps the chat service thin.
- **Schema-driven CLI output for BOTH flows.** Codex `--output-schema`
  takes a file path; Claude Code `--json-schema` takes an inline JSON
  string. The chat-turn envelope schema (`ChatMutationEnvelopeSchema`)
  and the quality-draft package schema (`QualityDraftPackageSchema`)
  both get JSON-schema serializations passed to the CLI. Validate the
  CLI's return with Zod regardless — the CLI's schema enforcement is a
  hint, not a guarantee.
- **Per-CLI schema file location.** Codex needs a file path; write to
  `os.tmpdir()` with `randomUUID()` filename, clean up in a `finally`.
  No persistent schema-file caching in v1 — simplifies cleanup at the
  cost of one extra fs write per call.
- **`runCodexChat` extraction is a hard rename, not a parallel.** The
  in-service Codex path is REPLACED by the new adapter's
  `runCodexChat`. The shared `ChatErrorCode` union already supports the
  transition. R8 invariant locks the externally-observable behavior.
- **Env-gate rename with backward-compat shim.**
  `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK` is the legacy name; the new name
  is `EXPERIENCE_AI_ALLOW_CODEX`. During the back-compat window, env
  resolution reads NEW first and falls back to OLD with a deprecation
  log. Document removal target in `CLAUDE.md`.
- **Dropdown is a single 4-way `<select>`, native element.** Mirrors the
  existing composer's stylistic register (raw `<input>`/`<textarea>`
  with Tailwind). Two-flow split would double cognitive surface. Cost-
  posture labels live in the option text, not in a tooltip.
- **CLI channels are local-dev-only in production.** Production
  Railway containers don't ship `codex` or `claude` binaries.
  `provider_not_configured` is the user-facing signal. Don't try to
  detect binary presence eagerly — let the spawn fail and translate
  ENOENT to the typed code (`fetch failed`-style mapping for HTTP
  channels has a CLI equivalent: ENOENT → `provider_not_configured`).
- **Test isolation via mocked `child_process.spawn`.** Use `vi.mock`
  on `node:child_process` to inject fake processes; real-CLI tests are
  optional and gated behind env (`CLI_INTEGRATION=1`).
- **`providerKind` widens by literal addition, no enum migration.** The
  Prisma column is `String`; new values (`claude-code`) just appear in
  newly-inserted rows. No DB migration.

---

## Open Questions

### Resolved During Planning

- **Does `claude` CLI support non-interactive JSON output?** — Yes.
  `claude --print --output-format stream-json --json-schema <schema>`.
  Verified via `claude --help` against installed `2.1.138` in the
  devcontainer.
- **Does `codex` CLI support non-interactive structured output?** —
  Yes. `codex exec --json --output-schema <file>`. Verified via
  `codex exec --help`.
- **Do we need a separate CLI for quality-draft vs chat-turn?** — No.
  Both CLIs accept the same invocation shape; the only difference is
  the schema passed in. Adapter exposes two entry points that share
  the spawn helper.
- **Should the dropdown be model-aware?** — No, not in v1. One model
  per channel via env. Per-model picker is deferred.
- **Per-channel rate limiting?** — Deferred (origin scope boundary).

### Deferred to Implementation

- Exact JSON-schema serialization for Codex `--output-schema` (file
  format must be Codex-compatible; verify by feeding a one-shot test
  payload and reading exit code + output). Spike during U3.
- Whether `claude --output-format stream-json` mid-stream lines need
  special handling vs the simple JSON envelope. If `stream-json`
  fragments the final payload across NDJSON frames, accumulate and
  parse-at-done same as the Ollama streaming adapter. Otherwise use
  `--output-format json` for chat-turn too.
- The exact prompt template the CLIs need to reliably emit
  schema-conformant output for quality-draft. Start with the existing
  OpenRouter prompt verbatim and tune in U3/U4 if validation rate is
  too low.
- Whether `codex` and `claude` honor `cwd` in a way that pollutes the
  current directory (e.g., creating `.codex/` cache subdirs). Spawn
  with `cwd: os.tmpdir()` if needed.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance
> for review, not implementation specification. The implementing agent
> should treat it as context, not code to reproduce.*

**Channel-to-flow routing matrix** (post-implementation):

| `provider` arg | Quality-draft path           | Chat-turn path                      | Env gate            |
|----------------|------------------------------|-------------------------------------|---------------------|
| `openrouter`   | `experience-ai-openrouter-free` | `experience-ai-codex` (rebadged)   | `…_ALLOW_CODEX`     |
| `ollama`       | `experience-ai-ollama`        | `experience-ai-ollama`              | none                |
| `codex`        | `experience-ai-codex`         | `experience-ai-codex`               | `…_ALLOW_CODEX`     |
| `claude-code`  | `experience-ai-claude-code`   | `experience-ai-claude-code`         | `…_ALLOW_CLAUDE_CODE` |

The `openrouter` channel's chat-turn keeps Codex CLI today (legacy
behavior preserved per R8). The new `codex` explicit pick uses the same
Codex adapter for BOTH flows — the difference is that the quality-draft
half is newly built (not just rebranded from chat-turn).

**Adapter interface (uniform across all four channels):**

```
ChannelAdapter = {
  // Quality-draft path
  generateStructuredOutput<T>({messages, schema, validate, ...}): Promise<{
    payload: T,
    model: string,
    usedModel: string,
    attempts: ProviderAttempt[],
  }>

  // Chat-turn path
  runChatTurn({prompt, schema, abortSignal, onToken}): Promise<
    | {kind: "envelope", raw: unknown}
    | {kind: "error", code: ChatErrorCode, message: string}
  >
}
```

Each adapter is a module that exports the two functions (no class). The
chat service imports them and selects on `ChatProvider`.

---

## Implementation Units

### U1. Widen `ChatProvider` union to 4 values

**Goal:** Promote the in-flight 2-value `ChatProvider` to the full
4-value closed union; teach `normalizeChatProvider` to handle the new
literals.

**Requirements:** R1, R8

**Dependencies:** None (extends shipped U1 of prior plan)

**Files:**
- Modify:
  `apps/admin/src/services/experience-ai/experience-ai-chat-provider.ts`
- Modify (test):
  `apps/admin/src/services/experience-ai/experience-ai-chat-provider.test.ts`

**Approach:**
- Change union to `"openrouter" | "ollama" | "codex" | "claude-code"`.
- Update `KNOWN_PROVIDERS` array.
- No change to `normalizeChatProvider` logic — it's already
  literal-driven.

**Patterns to follow:**
- The existing 2-value implementation. No new pattern needed.

**Test scenarios:**
- Happy path: each of the four literals normalizes to itself.
- Edge case: case-insensitive match for `CODEX`, `Claude-Code`,
  `claude_code` (underscore-or-hyphen tolerance — decide explicitly:
  recommendation is to NORMALIZE underscores to hyphens before matching
  so wire-format flexibility doesn't fragment the canonical literal).
- Edge case: trim CR/LF/TAB before match.
- Error path: `"chatgpt"` falls back to default with sanitized log.
- Edge case: `"claude"` alone (no `-code` suffix) falls back to default
  + log — close-but-wrong is a class users will type, and silently
  matching it to `claude-code` would mask a typo.

**Verification:**
- Test file passes; TypeScript narrowing across the codebase shows the
  4-value union (compile errors anywhere that switch-statements only
  cover 2 values).

---

### U2. Per-channel env gates + back-compat shim

**Goal:** Add `EXPERIENCE_AI_ALLOW_CODEX` and
`EXPERIENCE_AI_ALLOW_CLAUDE_CODE` env vars. Keep
`EXPERIENCE_AI_ALLOW_CODEX_FALLBACK` working for one release window
with a deprecation log line. Add optional
`EXPERIENCE_AI_CODEX_MODEL` and `EXPERIENCE_AI_CLAUDE_CODE_MODEL`.

**Requirements:** R5, R10

**Dependencies:** None

**Files:**
- Modify: `apps/admin/src/config/env.ts`
- Modify: `apps/admin/.env.example`
- Create:
  `apps/admin/src/services/experience-ai/experience-ai-cli-gates.ts` —
  small module exporting `isCodexAllowed()` and `isClaudeCodeAllowed()`
  helpers that encapsulate the env read + back-compat fallback + one-
  time deprecation log.
- Test:
  `apps/admin/src/services/experience-ai/experience-ai-cli-gates.test.ts`

**Approach:**
- Add the four new env vars to the Zod schema and runtime block.
- The gate helper module is the single place that knows about the
  back-compat shim — every other module imports the boolean accessor.
- Use the `vi.hoisted` env-state pattern in the test (same as ollama
  test) to flip env values per case.

**Patterns to follow:**
- `apps/admin/src/services/experience-ai/experience-ai-openrouter-free.test.ts`
  for env mocking.
- The existing `OLLAMA_BASE_URL`/`OLLAMA_CHAT_MODEL` Zod entries for
  schema style.

**Test scenarios:**
- Happy path: `EXPERIENCE_AI_ALLOW_CODEX=true` → `isCodexAllowed()`
  returns true; no deprecation log.
- Happy path: `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK=true` (legacy only)
  → `isCodexAllowed()` returns true; deprecation log fired once.
- Edge case: both set → new wins, no deprecation log.
- Edge case: both unset → false, no log.
- Happy path: `EXPERIENCE_AI_ALLOW_CLAUDE_CODE=true` →
  `isClaudeCodeAllowed()` returns true.
- Error path: `EXPERIENCE_AI_ALLOW_CODEX=notabool` → Zod coerce yields
  false (matches existing `z.coerce.boolean()` semantics).
- Edge case: deprecation log fires AT MOST ONCE across multiple
  `isCodexAllowed()` calls in the same process (module-scope `let
  hasWarned` flag).

**Verification:**
- Test passes. `env.EXPERIENCE_AI_CODEX_MODEL` is reachable. Existing
  references to `env.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK` are replaced
  by `isCodexAllowed()`.

---

### U3. Codex adapter module

**Goal:** Create `experience-ai-codex.ts` exporting
`generateCodexStructuredOutput` (quality-draft) and `runCodexChat`
(chat-turn). Replaces the in-service `runCodexChat` and adds the new
quality-draft path.

**Requirements:** R3, R4, R6, R7, R10

**Dependencies:** U1, U2

**Files:**
- Create:
  `apps/admin/src/services/experience-ai/experience-ai-codex.ts`
- Create:
  `apps/admin/src/services/experience-ai/experience-ai-codex.test.ts`

**Approach:**
- Both functions share a private `spawnCodexExec({prompt, schemaJson,
  abortSignal, onLine, timeouts})` helper. Internals:
  - Write `schemaJson` to a temp file (`os.tmpdir()` +
    `randomUUID()` + `.json`).
  - Spawn `codex exec --json --output-schema <file>
    [-m <model>]` with prompt via stdin (more robust than positional —
    avoids shell-arg quoting concerns).
  - Read stdout via `readline.createInterface` line-by-line; pass each
    line to `onLine(line)`.
  - Wire idle + total timeouts via `setTimeout` + `controller.abort()`,
    mirroring the existing `runCodexChat` pattern.
  - Clean up: clear timers, delete temp schema file (best-effort,
    swallow errors), kill child if still running.
- `generateCodexStructuredOutput`:
  - Builds messages → prompt string (system + user blocks).
  - Schema = JSON-schema serialization of `QualityDraftPackageSchema`
    (reuse `buildQualityDraftJsonSchema()` already used by OpenRouter).
  - `onLine` captures all lines; on close, find the final JSON object
    and `validate` it.
  - Error mapping: ENOENT (binary missing) →
    `provider_not_configured`. Abort/timeout → `timeout`. Non-zero
    exit + schema-parse failure → `validation_error`. Other non-zero
    → `upstream_error`.
- `runCodexChat`:
  - Schema = JSON-schema serialization of
    `ChatMutationEnvelopeSchema` (new export from the chat service or
    a new shared module — decision in U5).
  - `onLine` distinguishes envelope-line (matches `^\s*\{.*\}\s*$`)
    from token lines (everything else); calls `onToken(line)` for
    token lines, captures the envelope.
  - Discriminated return matches the in-service `CodexRunResult`
    shape so the chat-service rewrite is mechanical.
- Read model from `env.EXPERIENCE_AI_CODEX_MODEL` when set; omit
  `-m` otherwise to let `codex` use its config default.
- Gate: throw `CodexProviderError("missing_provider")` BEFORE spawn
  if `isCodexAllowed()` returns false. The chat service surfaces this
  as `provider_not_configured`.

**Execution note:** Implement `runCodexChat` first (it has the most
existing tests), then `generateCodexStructuredOutput`.

**Patterns to follow:**
- Existing `runCodexChat` in
  `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`
  (the readline + idle/total timeout + onToken pattern).
- `experience-ai-ollama.ts` (`OllamaProviderError`, `OllamaProviderAttempt`,
  the discriminated `OllamaRunResult` return).

**Test scenarios:**
- Happy path (structured): mocked spawn emits one JSON line on
  stdout that parses to a valid schema payload → returned wrapped
  with `provider.kind` info, attempts array length 1, status
  `succeeded`.
- Happy path (chat): mocked spawn emits 3 token lines then one JSON
  envelope line → `onToken` called 3 times in order; resolves
  `{kind: "envelope", raw: <envelope>}`.
- Edge case: envelope-line regex matches a token line that happens
  to look like JSON (`{a:1}` without quoting). Verify the
  Zod-validation downstream catches it — adapter's job is only
  "this looks like JSON, parse it; if it parses, treat as envelope."
- Error path: spawn throws ENOENT → `{kind: "error", code:
  "provider_not_configured", message: <contains "codex" and
  "ENOENT">}`.
- Error path (structured): exit code 1 + no valid JSON line →
  `CodexProviderError("upstream_error", ...)`.
- Error path: idle timeout fires → adapter aborts, resolves with
  `{kind: "error", code: "provider_timeout"}` (or `codex_idle_timeout`
  — decide based on what the in-service path uses; recommendation is
  `provider_timeout` to match the cross-adapter discipline).
- Error path: total timeout fires → same path.
- Edge case: abortSignal fires mid-stream → `{kind: "error",
  code: "cancelled"}`. Child is killed.
- Edge case (structured): mocked spawn writes the JSON across
  multiple stdout chunks (stream-json variant) → reader accumulates
  and parses at close.
- Error path: gate off (`EXPERIENCE_AI_ALLOW_CODEX=false`) →
  `CodexProviderError("missing_provider")` BEFORE spawn.
  Verify spawn is never called.
- Edge case: temp schema file is cleaned up even when spawn throws
  (try/finally with fs.rm best-effort).
- *Covers AE3.* Structured output parses successfully → quality-draft
  payload returns. If parse fails → `provider_validation_failed`.

**Verification:**
- All tests pass. The in-service `runCodexChat` symbol is no longer
  needed (removed in U5).

---

### U4. Claude Code adapter module

**Goal:** Create `experience-ai-claude-code.ts` exporting
`generateClaudeCodeStructuredOutput` and `runClaudeCodeChat`. CLI flag
shape: `claude --print --output-format stream-json --json-schema
'<schema-inline>' --model <model>` with prompt via stdin.

**Requirements:** R3, R4, R6, R7, R10

**Dependencies:** U1, U2

**Files:**
- Create:
  `apps/admin/src/services/experience-ai/experience-ai-claude-code.ts`
- Create:
  `apps/admin/src/services/experience-ai/experience-ai-claude-code.test.ts`

**Approach:**
- Mirror the Codex adapter shape exactly. Differences:
  - Schema is passed inline as a JSON string (`--json-schema
    '...'`), not a file. No temp file lifecycle.
  - Output format: `stream-json` emits per-event NDJSON frames where
    each frame is a control message, message-delta, or terminal
    result. Plan stance: parse each line; the terminal `type:
    "result"` frame carries the final assistant message which we
    validate. Token deltas come from `type: "assistant"` /
    `type: "message_delta"` frames — adapter extracts `delta.text`
    when present.
  - Model default = `sonnet` alias (Claude Code resolves to latest
    Sonnet); override via `env.EXPERIENCE_AI_CLAUDE_CODE_MODEL`.
  - Gate via `isClaudeCodeAllowed()` BEFORE spawn.
- The CLI's stream-json frame schema may shift across versions —
  treat parsing leniently. Use Zod with `.passthrough()` and only
  match on the known discriminator fields.

**Patterns to follow:**
- The Codex adapter (U3) for spawn/timeout/abort pattern.
- The Ollama streaming adapter for NDJSON line buffering.

**Test scenarios:**
- Happy path (structured): mocked spawn emits NDJSON frames
  culminating in a `{type: "result", result: <valid-payload>}` line
  → returned wrapped.
- Happy path (chat): frames emit content deltas → `onToken` called
  per delta; terminal frame carries the JSON envelope → resolves
  `{kind: "envelope", raw: <envelope>}`.
- Edge case: unknown frame `type` is ignored (forward-compat).
- Edge case: schema-inline arg is properly serialized — verify the
  spawn args include `--json-schema` followed by a parseable JSON
  string.
- Error path: gate off → `ClaudeCodeProviderError("missing_provider")`
  BEFORE spawn.
- Error path: spawn ENOENT → `{kind: "error", code:
  "provider_not_configured"}`.
- Error path: non-zero exit + no terminal frame → upstream_error.
- Error path: idle / total timeout → `provider_timeout`.
- Edge case: abortSignal fires mid-stream → cancelled.
- Edge case: terminal frame's `result` is a string-encoded JSON
  (claude sometimes returns content as plain text even with
  json-schema) → `JSON.parse` the string, validate downstream.

**Verification:**
- All tests pass.

---

### U5. Extract `ChatMutationEnvelopeSchema` to shared module + chat-service Codex-spawn replacement

**Goal:** Move `ChatMutationEnvelopeSchema` and `ChatMutationsSchema`
out of `experience-ai-chat.service.ts` into a small shared module so
the Codex and Claude Code adapters can JSON-schema-serialize them
without re-importing the service. Delete the in-service `runCodexChat`
and re-import from the new Codex adapter.

**Requirements:** R3, R6, R8

**Dependencies:** U3

**Files:**
- Create:
  `apps/admin/src/services/experience-ai/experience-ai-chat-envelope.ts`
- Modify:
  `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`
  — remove `runCodexChat`, import from `experience-ai-codex.ts`;
  re-export envelope schemas from the new module for back-compat with
  test consumers.
- Modify:
  `apps/admin/src/services/experience-ai/experience-ai-chat.service.test.ts`
  — only if existing tests reach into the moved symbols; otherwise no
  change (R8).

**Approach:**
- Move types verbatim. Use `zod-to-json-schema` (or hand-coded JSON
  schema — decide during implementation) to produce the schema the
  CLIs accept. If `zod-to-json-schema` isn't already a dep, prefer
  hand-coded JSON schema since the envelope shape is small and stable.
- The chat service still exports `ChatMutationEnvelopeSchema` and
  `ChatMutationsSchema` for back-compat with consumers (TOTAL_TIMEOUT_MS
  re-export, etc.).

**Test scenarios:**
- Happy path: existing chat-service tests that consume re-exported
  envelope schemas keep working (R8 regression).
- Edge case: round-trip — Zod schema → JSON schema → CLI-validated
  payload → Zod safeParse passes for any envelope that conforms.
  This is a property test in the chat-envelope test file (a
  hand-rolled few cases is enough — full property-based testing is
  overkill).

**Verification:**
- Existing chat-service tests pass without modification. The in-
  service `runCodexChat` function no longer exists; references go
  through the new adapter.

---

### U6. Quality-draft 4-way routing

**Goal:** Widen `generateQualityExperienceDraft` to branch on
`provider: ChatProvider` and call the right adapter. All four channels
produce the same `QualityExperienceDraftResult` shape.

**Requirements:** R2, R4, R6, R7, R8

**Dependencies:** U3, U4

**Files:**
- Modify:
  `apps/admin/src/services/experience-ai/experience-ai-quality-draft.ts`
- Modify:
  `apps/admin/src/services/experience-ai/experience-ai-quality-draft.test.ts`

**Approach:**
- Add `provider?: ChatProvider` arg, default `DEFAULT_CHAT_PROVIDER`.
- Single switch on `provider` at function entry. Each branch:
  - Builds the same `messages` + `userPrompt` + locale-aware payload.
  - Calls the channel's `generateStructuredOutput` (or analog).
  - Maps the channel's `*ProviderError` → `QualityExperienceDraftError`
    using a per-channel error mapper.
  - Returns the uniform result shape with the correct
    `provider.kind` literal.
- Widen `provider.kind` union to include `codex` and `claude-code`.
- Widen `QualityDraftProviderAttempt` to be the union of all four
  attempt shapes.

**Patterns to follow:**
- The hybrid-search branched-orchestrator pattern from `CLAUDE.md`.
- The stashed Ollama-only branching attempt (in stash; reference
  only — implementation should do all 4 channels in one shot).

**Test scenarios:**
- Happy path (provider omitted): existing OpenRouter behavior, byte-
  identical result shape (R8).
- Happy path (provider="ollama"): Ollama adapter is called;
  `provider.kind === "ollama-gemma4"`.
- Happy path (provider="codex"): Codex adapter is called;
  `provider.kind === "codex"`.
- Happy path (provider="claude-code"): Claude Code adapter is called;
  `provider.kind === "claude-code"`.
- Error path (per channel): each adapter's typed error maps to
  `QualityExperienceDraftError` with the right code (e.g.,
  `CodexProviderError("missing_provider")` →
  `QualityExperienceDraftError("provider_not_configured")`). Test
  each mapping branch.
- Edge case: `provider="codex"` AND gate off → adapter throws before
  spawn → `provider_not_configured` surfaced.
- Integration: dead-branch detection — delete one branch from the
  switch (mentally / in code review) and the corresponding test
  fails. No "regex backstop" — each branch is structurally
  unreachable from the others.

**Verification:**
- Existing tests pass without modification. New per-channel tests
  pass.

---

### U7. `streamChatTurn` 4-way chat-turn routing

**Goal:** Widen the chat-service generator to accept `provider:
ChatProvider`, normalize at entry, route the chat-turn branch to the
right CLI/HTTP adapter, stamp `providerKind` correctly.

**Requirements:** R2, R6, R7, R8

**Dependencies:** U3, U4, U5, U6

**Files:**
- Modify:
  `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`
- Modify:
  `apps/admin/src/services/experience-ai/experience-ai-chat.service.test.ts`

**Approach:**
- Add `provider?: ChatProvider` to `StreamChatTurnInput`. Normalize
  at the top of the generator.
- Quality-draft branch (line ~566 pre-refactor): pass `provider` to
  `generateQualityExperienceDraft`. Stamp `providerKind`:
  - `openrouter` → `openrouter-free`
  - `ollama` → `ollama-gemma4`
  - `codex` → `codex`
  - `claude-code` → `claude-code`
- Chat-turn branch (line ~668 pre-refactor): branch on `provider`:
  - `openrouter` → `runCodexChat` from the Codex adapter, gated by
    `isCodexAllowed()`. **This is today's legacy behavior** — when
    OpenRouter is picked, chat-turn still goes through Codex per
    R8.
  - `ollama` → `runOllamaChat`. No gate.
  - `codex` → `runCodexChat`. Gated by `isCodexAllowed()`.
  - `claude-code` → `runClaudeCodeChat`. Gated by
    `isClaudeCodeAllowed()`.
- Stamp `providerKind` on the persisted chat-turn assistant message
  to match the actual channel.
- The brief-update path is unchanged (no AI call; `providerKind:
  "brief"`).

**Test scenarios:**
- Happy path (provider omitted, post-brief turn): OpenRouter selected,
  Codex spawn runs (legacy), persisted `providerKind === "codex"`.
  **R8 regression.**
- Happy path (provider="ollama"): Ollama runs both flows; persisted
  `providerKind === "ollama-gemma4"`.
- Happy path (provider="codex"): Codex runs both flows; persisted
  `providerKind === "codex"`.
- Happy path (provider="claude-code"): Claude Code runs both flows;
  persisted `providerKind === "claude-code"`.
- Error path (provider="codex" AND gate off):
  `provider_not_configured` surfaced; nothing spawned; persisted
  message has the error state.
- Error path (provider="claude-code" AND gate off): same.
- Error path: Codex adapter resolves with `{kind: "error", code:
  "provider_unavailable"}` → service yields the same error event;
  no fallback to another channel. *Covers AE5.*
- Edge case: `provider="garbage"` → normalizes to `openrouter` → no
  throw, behavior matches default.
- *Covers AE2:* Same thread picks `ollama` for a quality-draft turn
  AND a chat-turn → both rows have `providerKind: "ollama-gemma4"`.
- Integration: existing chat-service tests (about a dozen) pass
  unmodified. R8 invariant.

**Verification:**
- Whole `experience-ai-chat.service.test.ts` is green. New
  per-channel tests added.

---

### U8. Stream route Zod widens to 4-value enum

**Goal:** Extend the SSE route's Zod body schema to accept the new
`provider` field with the closed 4-value enum.

**Requirements:** R2, R8

**Dependencies:** U1

**Files:**
- Modify: `apps/admin/src/app/api/experience-chat/stream/route.ts`
- Modify: `apps/admin/src/app/api/experience-chat/stream/route.test.ts`

**Approach:**
- Add `provider:
  z.enum(["openrouter","ollama","codex","claude-code"]).optional()`.
- Forward through to `streamChatTurn`.
- Closed-enum is the route boundary's first line of defense; the
  chat service's `normalizeChatProvider` is the second line for
  callers that bypass Zod (tests calling the service directly).

**Test scenarios:**
- Happy path: body without `provider` → 200, request reaches service
  with `provider: undefined`. R8.
- Happy path: body with each of the 4 valid values → 200, value
  forwarded.
- Edge case: body with `provider: "anthropic"` → 400 with Zod issues.
- Edge case: body with `provider: null` → 400 (closed enum doesn't
  accept null without `.nullable()`).

**Verification:**
- Route test passes; existing tests pass unmodified.

---

### U9. Stream client widens `StreamChatRequestBody`

**Goal:** The browser-side SSE client carries the new `provider`
field type.

**Requirements:** R2, R8

**Dependencies:** U1

**Files:**
- Modify:
  `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-stream-client.ts`

**Approach:**
- Add `provider?: ChatProvider` to `StreamChatRequestBody`.
- POST body includes the key only when present (wire-format identity
  when omitted preserves the R8 invariant).

**Test scenarios:**
- (No standalone client test today.) Verify via the panel test in U10
  that the fetch stub receives the right body shape per option.

**Verification:**
- Type widens; consumer (the panel) can pass the new field.

---

### U10. Chat panel 4-option dropdown

**Goal:** Add the native `<select>` provider dropdown to the
composer beside the "Apply across locales" checkbox. Four options
with cost-posture labels.

**Requirements:** R1, R2, R9

**Dependencies:** U9

**Files:**
- Modify:
  `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
- Modify:
  `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx`

**Approach:**
- `useState<ChatProvider>("openrouter")` near `confirmAcrossLocales`
  state.
- Render `<select data-testid="experience-chat-provider">` with
  options:
  - `<option value="openrouter">OpenRouter (free, cloud)</option>`
  - `<option value="ollama">Ollama (local, free)</option>`
  - `<option value="codex">Codex (paid, local CLI)</option>`
  - `<option value="claude-code">Claude Code (paid, local CLI)</option>`
- Disable the select while `stream.kind === "streaming"` (mirror
  textarea-disabled).
- Pass the value into `openChatStream` body.
- No localStorage in v1 — state lives only in React. Persistence is
  a deferred concern.

**Patterns to follow:**
- The composer's existing `confirmAcrossLocales` checkbox styling
  (same wrapper + Tailwind class shape).

**Test scenarios:**
- Happy path: default render → `<select>` has value `"openrouter"`.
- Happy path: change to each of the other three values → state
  updates; next `handleSend` call passes the new provider in the
  request body.
- Edge case: select is disabled mid-stream.
- *Covers AE6:* option labels indicate cost posture (test asserts
  presence of "paid" / "free" in the labels for the right options).

**Verification:**
- Test passes. Manual smoke: open the chat panel, switch each
  channel, send a turn, observe `providerKind` in the chat history
  reflects the selection (or `provider_not_configured` error if the
  CLI is gated off / not installed).

---

### U11. Documentation + operational notes

**Goal:** Update `apps/admin/CLAUDE.md` with a short "Experience AI
Chat providers" subsection naming all four channels, the env gates,
and the production caveat (CLIs aren't installed on Railway).

**Requirements:** R5 (operational), R9

**Dependencies:** U1–U10

**Files:**
- Modify: `apps/admin/CLAUDE.md` — add new subsection.
- Modify: `apps/admin/.env.example` — already touched in U2; verify
  the gate vars and model overrides are documented with one-line
  comments each.

**Approach:**
- Concise subsection (~10 lines) that names the four channels, the
  env gates, the model envs, and the deferred work (back-compat
  shim removal target).

**Test scenarios:**
- Test expectation: none -- documentation-only change.

**Verification:**
- Subsection renders cleanly; future agents reading `CLAUDE.md` can
  understand the channel model without reading the plan.

---

## System-Wide Impact

- **Interaction graph:** UI → `POST /api/experience-chat/stream` →
  `streamChatTurn` → channel adapter. The route's rate limiter, auth,
  ABAC, and brief-mode persistence are unchanged.
- **Error propagation:** All channel adapter errors map to the
  existing `ChatErrorCode` union. No SSE consumer changes.
- **State lifecycle risks:** `ExperienceChatMessage.providerKind` is
  `String` in Prisma — new literals (`claude-code`) just appear in new
  rows. Existing rows are unchanged. No migration.
- **API surface parity:** The new `provider` field is optional and
  absent by default. No breaking change for any caller. The
  hybrid-search-mode precedent shipped this exact shape without
  incident.
- **Integration coverage:** Real CLI is needed for end-to-end smoke;
  the test suite stays fully mocked. CI has no `codex` or `claude`
  binary, so no integration test runs by default. Optional
  `CLI_INTEGRATION=1` opt-in is the right granularity.
- **Unchanged invariants:** OpenRouter behavior, brief-mode behavior,
  ABAC gating, cross-locale guard, envelope validation, mutation
  persistence shape, SSE wire format, rate-limit bucket. R8 is the
  regression guard.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Claude Code or Codex CLI changes its `--output-format` / `--output-schema` interface in a future release. | Adapter parses NDJSON leniently with `.passthrough()` on Zod frames; pin a recommended minimum CLI version in `CLAUDE.md`; surface unexpected exit codes as `provider_unavailable` so the editor sees a clear error. |
| Prompt-engineered JSON output from a CLI fails schema validation more often than HTTP JSON-mode. | Surface as `schema_violation` (existing code); editor retries or switches channel. Don't auto-fallback. |
| Temp schema file leaks under crash. | `os.tmpdir()` is OS-cleaned periodically; best-effort `fs.rm` in `finally`. Accept residual disk usage. |
| Back-compat shim for `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK` is never removed. | Document the removal target in `CLAUDE.md` and add a single deprecation log line on each cold start that reads the legacy var. |
| Concurrent chat turns from one editor spawn multiple CLI processes. | Existing rate limiter (30 req/min/editor) bounds this; CLI processes are subprocess-bounded by the request lifecycle. No process pool needed in v1. |
| CLI binary not present in dev environment (new contributor). | First send produces `provider_not_configured` with a message naming the binary. Document install in `CLAUDE.md`. |
| `providerKind` widens to a new literal and breaks a downstream consumer that switches on the enum. | Grep before merge; today's consumers don't switch — field is display metadata only. Lock with a test asserting it. |

---

## Documentation / Operational Notes

- Add a short "Experience AI Chat providers" subsection to
  `apps/admin/CLAUDE.md` (U11).
- Update `apps/admin/.env.example` with all new env vars, including a
  short comment explaining that CLI channels are local-dev primary.
- No migration. No deployment ordering concern. No Doppler change
  required for the defaults — they ship in code.
- Document the back-compat removal target for
  `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK` (one release window after this
  PR merges).
- Manual smoke checklist (for the PR description):
  1. Default channel → existing behavior.
  2. Switch to Ollama → both flows hit Ollama.
  3. Switch to Codex → both flows spawn `codex exec`.
  4. Switch to Claude Code → both flows spawn `claude --print`.
  5. With `EXPERIENCE_AI_ALLOW_CLAUDE_CODE` unset, picking Claude
     Code → `provider_not_configured` error visible in the panel,
     no spawn (verify via process list).

---

## Sources & References

- **Origin document:**
  [docs/brainstorms/2026-05-11-admin-experience-ai-chat-four-channel-providers-requirements.md](../brainstorms/2026-05-11-admin-experience-ai-chat-four-channel-providers-requirements.md)
- **Superseded plan:**
  [docs/plans/2026-05-11-002-feat-admin-experience-ai-chat-ollama-provider-channel-plan.md](2026-05-11-002-feat-admin-experience-ai-chat-ollama-provider-channel-plan.md)
  — U1–U3 already shipped on `feat/admin-chat-ollama-provider` branch
  and are reused as foundations; U4–U8 superseded by this plan.
- Related code:
  - `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`
  - `apps/admin/src/services/experience-ai/experience-ai-chat-provider.ts`
  - `apps/admin/src/services/experience-ai/experience-ai-chat-error-codes.ts`
  - `apps/admin/src/services/experience-ai/experience-ai-ollama.ts`
  - `apps/admin/src/services/experience-ai/experience-ai-openrouter-free.ts`
  - `apps/admin/src/services/experience-ai/experience-ai-quality-draft.ts`
  - `apps/admin/src/app/api/experience-chat/stream/route.ts`
  - `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
- External docs:
  - Claude Code CLI: `claude --help` (verified `2.1.138` in devcontainer)
  - Codex CLI: `codex exec --help` (verified `codex-cli 0.130.0`)
