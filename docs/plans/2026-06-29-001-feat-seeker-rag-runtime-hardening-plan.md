---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-brainstorm
origin: docs/brainstorms/2026-06-29-seeker-rag-runtime-hardening-requirements.md
ticket: docs/roadmap/ai-chat/feat-202-seeker-rag-runtime-hardening.md
title: "feat: Seeker RAG runtime hardening — RAG response byte-cap + agent step-budget floor"
date: 2026-06-29
depth: standard
---

# feat: Seeker RAG runtime hardening (feat-202)

> **Product Contract preservation:** Product Contract unchanged. This plan enriches the
> legacy requirements doc (`docs/brainstorms/2026-06-29-seeker-rag-runtime-hardening-requirements.md`)
> with HOW; it does not alter the WHAT. The two deferred items (in-memory eviction → feat-208;
> firecrawl-client's identical gap → its owners) stay out of scope exactly as the brainstorm decided.

## Summary

Two independent defense-in-depth hardenings on the Studio-only seeker, plus one docs note. Both
guard the **shared single Node process** that runs every Mastra agent/workflow:

1. **RAG response byte-cap** — both `await response.json()` reads in
   `apps/mastra/src/services/jesusfilm-rag-client.ts` (success body `:217`, error path
   `readUpstreamReason` `:123`) currently buffer the entire upstream body into the heap before any
   slicing applies. A misbehaving (not hostile) RAG returning a multi-GB body can OOM the process.
   Bound both reads at a max-bytes ceiling read from a streamed counter; over-cap maps to the
   **existing** `parse_error → unavailable` path, never a throw.
2. **Agent step-budget floor** — the seeker `Agent` has no `maxSteps`. The bearer-gated
   `/forge-seeker` route sets `maxSteps: STEP_CAPS.toolCallingTurn` (8) at its call site, but the
   built-in code-unauthenticated `/api/agents/seekerAgent` surface (reachable by any in-network
   caller) inherits no ceiling. Set `defaultOptions: { maxSteps: STEP_CAPS.toolCallingTurn }` on the
   constructor (the vNext field, reusing the route's shared constant), so both paths share one floor.
3. **Routing-convention note** — a short honor-system note in `apps/mastra/CLAUDE.md`: apps/services
   must call the bearer-gated `/forge-seeker`, never the unauthenticated/unbudgeted
   `/api/agents/seekerAgent`. Not enforcement — the binding containment stays the network boundary.

This is a small, correct slice of the original three-item ticket; the brainstorm is authoritative for
what is in and out.

---

## Problem Frame

The feat-198/feat-199 seeker skeleton shipped clean for a Studio-only, release-gated prototype. A
code review surfaced three latent gaps; a 2026-06-29 investigation against the live code reshaped the
ticket. Two are worth closing now because their value is **independent of the seeker's exposure
level** (both can OOM or runaway the shared process regardless of who reaches it); the third
(in-memory `Memory` eviction) is deliberately deferred to feat-208, where the Postgres move
_eliminates_ — not relocates — the heap-OOM risk it guarded against.

Context that bounds urgency (none of these is a live, externally-triggerable bug today): the RAG
upstream is a trusted, host-allowlisted, bearer-authed first-party service; the seeker is Studio-only
behind the `apps/mastra-gateway` + Railway network boundary. These are defense-in-depth and
drift-prevention, not incident response.

---

## Requirements

Traced to the origin brainstorm's **Decisions** and **Scope boundaries** sections.

- **R1 — Byte-cap both RAG read sites.** Bound the buffered read at a max-bytes ceiling on **both**
  the success body (`:217`) and the error path (`readUpstreamReason`, `:123`). A multi-GB _error_
  body OOMs the shared process identically to a success body.
- **R2 — Stream with a byte counter, not `Content-Length` trust.** The header can be absent or wrong;
  count bytes as they arrive and stop/abort the stream once the cap is exceeded (cancel the reader so
  the socket can't keep filling) — do not buffer-then-measure.
- **R3 — Over-cap maps to the existing graceful failure, never a throw.** An over-cap body resolves
  to the existing `parse_error` client result → the tool's `unavailable` status. The typed no-throw
  result-union and the `{ status, sources, message? }` tool shape are unchanged.
- **R4 — Default ceiling sized above a legitimate `topK=5` payload.** A low single-digit MB default,
  comfortably above a contract-derived upper bound (≈ max passage text × 5 + citation overhead) so a
  valid retrieval is never rejected as `unavailable`.
- **R5 — Any new env knob is `.optional()` with a runtime fallback.** Zero new required-at-boot env
  vars; nothing new in the production `missing` list in `assertMastraRuntimeEnv`.
- **R6 — Agent step-budget floor.** Set `defaultOptions: { maxSteps: STEP_CAPS.toolCallingTurn }` on
  the seeker `Agent` constructor — the vNext field, **not** `defaultStreamOptionsLegacy` — reusing
  the **same** shared constant the `/forge-seeker` route uses (one source of truth).
- **R7 — Floor is a default, not an un-overridable ceiling.** vNext deep-merge lets an explicit
  per-call `maxSteps` win; this protects the realistic omit-maxSteps case, matching the property the
  route's budget already has.
- **R8 — Routing-convention note in `apps/mastra/CLAUDE.md`.** Apps/services call `/forge-seeker`,
  never `/api/agents/seekerAgent`. State plainly it's honor-system, not enforcement.

**Out of scope (carried verbatim from origin):** any change to `firecrawl-client.ts`; extracting the
shared HTTP helpers (`endpoint`/`safeReason`/`readUpstreamReason`); in-memory memory eviction; a
per-request wall-clock budget on the direct `/api/agents/*` path; any new required env var; any change
to the no-throw result-union or tool-result shape.

---

## Key Technical Decisions

### KTD1 — Streamed byte-counter read helper, shared by both call sites

Add one small private helper in `jesusfilm-rag-client.ts` (e.g. `readJsonBodyCapped(response, maxBytes)`)
that replaces both `await response.json().catch(() => undefined)` calls. It:

1. Takes `response.body` (a `ReadableStream<Uint8Array>`); if absent (null body), returns `undefined`.
2. Reads chunks via `getReader()`, summing `chunk.byteLength` into a running total.
3. The moment the total exceeds `maxBytes`, calls `reader.cancel()` (abort the underlying stream so
   the socket stops filling — R2) and returns `undefined`.
4. Otherwise concatenates the chunks, `TextDecoder`-decodes, `JSON.parse`s, and returns the parsed
   value — **all wrapped so any failure (read error, decode error, parse error, over-cap) returns
   `undefined`**, preserving the existing `.catch(() => undefined)` no-throw contract. The catch
   block **swallows silently (returns `undefined`) and must NOT log the caught error** — a
   `JSON.parse` `SyntaxError` can embed raw body fragments in its message, so logging it would breach
   the file's documented `NO-THROW LEAK CONTROL` invariant (query/bearer/raw body never reach a
   throw, a log, or the typed result).

Returning `undefined` is the keystone: the success site already feeds `undefined` into
`SearchResponseSchema.safeParse(...)` → `parse_error`; the error site (`readUpstreamReason`) already
treats a non-object body as "no reason" and falls through to status-based classification. So an
over-cap body needs **no new branch** — it rides the existing graceful paths to `unavailable` (R3).
Keep the helper local; do **not** extract it into a shared module (origin scope boundary — firecrawl
stays untouched).

### KTD2 — Default cap: 2 MiB, env-overridable

Default `DEFAULT_JESUSFILM_RAG_MAX_RESPONSE_BYTES = 2_097_152` (2 MiB). A legitimate `topK=5` payload
is five passage chunks (passage text is short — chunk-sized — plus a small citation each); even a very
generous ~50 KB/passage upper bound is ~250 KB, so 2 MiB is ~8× headroom and still low-single-digit MB
(R4). Overridable via `JESUSFILM_RAG_MAX_RESPONSE_BYTES`.

### KTD3 — Env knob shape: schema `.optional()` + runtime fallback in the accessor

`JESUSFILM_RAG_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().optional()` in the schema, with
the default applied at read time in `getJesusfilmRagConfig()` (`env.JESUSFILM_RAG_MAX_RESPONSE_BYTES ??
DEFAULT_JESUSFILM_RAG_MAX_RESPONSE_BYTES`). This is the literal `.optional()`-with-runtime-fallback
shape the ticket calls for (R5). It differs slightly from the sibling `JESUSFILM_RAG_TIMEOUT_MS`, which
uses in-schema `.default(...)` — both achieve "never required at boot," but `.optional()` + accessor
fallback matches the stated discipline exactly and keeps the default value co-located with the other
RAG client default constant. Either shape keeps the var out of the `assertMastraRuntimeEnv` `missing`
list; this one is chosen for fidelity to the requirement wording. Add the var to the `apps/mastra/CLAUDE.md`
env table.

### KTD4 — `defaultOptions` (vNext), verified against installed `@mastra/core@1.36.0`

The constructor field is `defaultOptions?: DynamicArgument<AgentExecutionOptions>` (resolved by
`agent.getDefaultOptions()`), confirmed in the installed `@mastra/core@1.36.0` type surface
(`dist/agent/types.d.ts:318`, `dist/agent/agent.d.ts` `getDefaultOptions`). `AgentExecutionOptions`
carries `maxSteps?: number`. The vNext `stream()`/`generate()` path deep-merges
`getDefaultOptions()` with per-call options (per-call wins → R7). Set it on `defaultOptions`, **not**
`defaultStreamOptionsLegacy` (which only feeds the unused legacy routes). Import `STEP_CAPS` from
`../budgets` so the floor and the route's cap share one constant (R6).

### KTD5 — Verify the default via `getDefaultOptions()`, not a full `mastra build`

The brainstorm asks to verify "against the built path." `agent.getDefaultOptions()` resolves the same
`defaultOptions` field the built vNext `stream()`/`generate()` consumes — so a unit test asserting
`(await seekerAgent.getDefaultOptions()).maxSteps === STEP_CAPS.toolCallingTurn` proves the
constructor floor takes effect on the production-shaped path without standing up a `mastra build`. The
risk the brainstorm flags (wrong field — legacy vs vNext) is closed by KTD4's type-surface check plus
this resolver assertion.

---

## Implementation Units

### U1. Byte-cap both RAG response reads

**Goal:** Bound both `response.json()` ingress sites in the RAG client at a max-bytes ceiling so an
oversized upstream body can't OOM the shared process; over-cap degrades to the existing
`parse_error → unavailable` path.

**Requirements:** R1, R2, R3, R4, R5.

**Dependencies:** none.

**Files:**

- `apps/mastra/src/services/jesusfilm-rag-client.ts` — add the `readJsonBodyCapped` helper; replace
  both `await response.json().catch(() => undefined)` calls (`:123`, `:217`) with it; add
  `maxResponseBytes` to the `JesusfilmRagConfig` type and thread it from `config`.
- `apps/mastra/src/config/env.ts` — add `JESUSFILM_RAG_MAX_RESPONSE_BYTES` (schema `.optional()`),
  the `emptyToUndefined(...)` runtime-parse entry, the `DEFAULT_JESUSFILM_RAG_MAX_RESPONSE_BYTES`
  constant, and the `?? DEFAULT` fallback in `getJesusfilmRagConfig()`.
- `apps/mastra/CLAUDE.md` — add the `JESUSFILM_RAG_MAX_RESPONSE_BYTES` row to the env table.
- `apps/mastra/src/services/jesusfilm-rag-client.test.ts` — new test cases (below).

**Approach:** See KTD1–KTD3. The helper is the only new logic; the two call sites swap their read
expression and otherwise keep their existing downstream handling verbatim. `JesusfilmRagConfig` gains
`maxResponseBytes: number` (always populated by the accessor, so non-optional on the type); test fixtures
add it to `testConfig`.

**Technical design (directional, not implementation spec):**

```
readJsonBodyCapped(response, maxBytes):
  stream = response.body
  if stream == null: return undefined
  reader = stream.getReader()
  total = 0; chunks = []
  try:
    loop:
      { done, value } = await reader.read()
      if done: break
      total += value.byteLength
      if total > maxBytes:
        await reader.cancel()        # abort the socket — R2
        return undefined             # → parse_error → unavailable — R3
      chunks.push(value)
    text = TextDecoder().decode(concat(chunks))
    return JSON.parse(text)
  catch: return undefined            # read/decode/parse error — no-throw contract
  finally: reader.releaseLock()      # if not already released by cancel()
```

**Patterns to follow:** the existing `.catch(() => undefined)` no-throw discipline and the
`config_missing`/`parse_error` result shapes already in the file; the env-knob shape mirrors the
sibling `JESUSFILM_RAG_TIMEOUT_MS` (constant + schema entry + `emptyToUndefined` runtime parse +
accessor) — differing only in `.optional()` vs `.default()` per KTD3.

**Test scenarios** (`jesusfilm-rag-client.test.ts`):

- _Success-body over-cap → parse_error (real over-cap, not a mocked branch)._ Build a **real**
  `Response` whose JSON body is structurally valid but larger than a deliberately tiny
  `maxResponseBytes` (e.g. 64) passed via config; assert the result is
  `{ ok: false, reason: "parse_error", retryable: false, status: 200 }` and that no body content leaks
  into the result. _Covers R1, R3._
- _Over-cap actually aborts the stream — assert `cancel()`, not just the return value (anti-mock-trap)._
  This is the load-bearing R2 test: assert the **abort mechanism fired**, not merely that the result is
  `parse_error`. Construct the `Response` body from a hand-built `ReadableStream` whose `cancel()` sets
  an observable flag (and which would emit far more than `maxResponseBytes` if fully drained); after the
  over-cap call, assert the cancel flag is set / no further chunks were pulled past the cap. Without
  this, a regression that deletes `reader.cancel()` and leaves a bare `return undefined` after the loop
  would still pass every result-shape test while silently reopening the OOM vector this plan exists to
  close. _Covers R2._
- _Error-path over-cap → status-classified failure with no `upstreamReason`._ A `status: 400` real
  `Response` with an oversized error body + tiny cap; assert `{ ok: false, reason: "rejected", status:
400 }` with `upstreamReason` undefined (the capped read returned `undefined`, so no reason was
  extracted) — proving `readUpstreamReason` is also byte-bounded. _Covers R1._
- _Under-cap success still parses normally._ The existing happy-path fixtures pass unchanged with the
  default 2 MiB cap (regression guard that the helper is transparent below the cap). _Covers R4._
- _Under-cap error body still yields `upstreamReason`._ The existing 4xx/5xx `{ error }` /
  `{ message }` fixtures still surface `upstreamReason` (helper transparent on the error path too).
- _Null-body response → parse_error, no throw._ A `Response` with `body: null`; assert graceful
  `parse_error` (success site) — guards the null-stream branch.
- _Cap boundary._ A body exactly at the cap parses; one byte over yields `parse_error` (off-by-one
  guard on the `> maxBytes` comparison).

**Verification:** `pnpm --filter @forge/mastra test` green; grep `response.json()` in
`jesusfilm-rag-client.ts` returns **zero** matches (both sites now go through the capped helper);
`assertMastraRuntimeEnv`'s production `missing` list gains no new entry.

---

### U2. Step-budget floor on the seeker agent

**Goal:** Give the seeker `Agent` a default `maxSteps` so the unauthenticated, unbudgeted
`/api/agents/seekerAgent` path inherits a runaway-loop ceiling without diverging from the route's cap.

**Requirements:** R6, R7.

**Dependencies:** none (independent of U1).

**Files:**

- `apps/mastra/src/mastra/agents/seeker-agent.ts` — import `STEP_CAPS` from `../budgets`; add
  `defaultOptions: { maxSteps: STEP_CAPS.toolCallingTurn }` to the `Agent` constructor, with a short
  comment that this is a default floor (deep-merge lets per-call win) and that it reuses the route's
  shared constant so the two paths can't drift.
- `apps/mastra/src/mastra/agents/seeker-agent.test.ts` — new test case (below).

**Approach:** See KTD4–KTD5. One constructor field, one import. No change to instructions, model,
tools, or memory.

**Patterns to follow:** the route's existing `maxSteps: STEP_CAPS.toolCallingTurn` at
`seeker-route.ts:272`; the `budgets.ts` constants module.

**Test scenarios** (`seeker-agent.test.ts`):

- _Constructor default takes effect._ `expect((await seekerAgent.getDefaultOptions()).maxSteps).toBe(STEP_CAPS.toolCallingTurn)`
  — asserts against the shared constant (not a magic `8`) so the test can't drift from the route.
  _Covers R6._ This is the brainstorm's "invoke with no per-call maxSteps and assert the constructor
  default applies," resolved against the vNext resolver path (KTD5).

**Verification:** `pnpm --filter @forge/mastra test` green; the new assertion passes; the existing
seeker-agent tests (name, safety line, citation discipline, tool wiring, memory) still pass unchanged.

---

### U3. `/forge-seeker`-not-`/api/agents` routing-convention note

**Goal:** Record the honor-system routing convention so future first-party callers don't bypass the
budgeted route.

**Requirements:** R8.

**Dependencies:** none (docs-only).

**Files:**

- `apps/mastra/CLAUDE.md` — add a short note in the seeker section, next to "Containment" / "Service
  route (`POST /forge-seeker`)".

**Approach:** A few sentences: apps and services must call the bearer-gated `/forge-seeker` route and
**never** the built-in `/api/agents/seekerAgent` surface, which is code-unauthenticated and carries no
budget. State plainly this is an honor-system convention (and a drift-prevention companion to the U2
default floor), **not** enforcement — the binding containment is and stays the network/gateway
boundary. Optionally mention that a CI grep asserting no first-party reference to
`/api/agents/seekerAgent` could harden it into a real check later (deferred, not built here).

**Test expectation:** none — documentation only.

**Verification:** the note is present in `apps/mastra/CLAUDE.md` adjacent to the seeker Containment /
Service route sections and reads as honor-system, not enforcement.

---

## Verification Contract

Run from the worktree root (`/workspace/.claude/worktrees/feat-202-rag-hardening`):

1. `pnpm --filter @forge/mastra test` — all green, including the new U1 over-cap cases (success body
   **and** error path, against real over-cap behavior) and the U2 `maxSteps`-default assertion.
2. `pnpm --filter @forge/mastra typecheck && pnpm --filter @forge/mastra lint` — clean.
3. `grep -n "response.json()" apps/mastra/src/services/jesusfilm-rag-client.ts` — **zero** matches
   (both ingress sites are byte-bounded via the helper).
4. `apps/mastra/CLAUDE.md` carries the `/forge-seeker`-not-`/api/agents` routing note next to the
   seeker Containment / Service route sections, **and** the new `JESUSFILM_RAG_MAX_RESPONSE_BYTES` env row.
5. No new entry in the production `missing` env list in `assertMastraRuntimeEnv` (no new boot
   requirement) — confirm `JESUSFILM_RAG_MAX_RESPONSE_BYTES` is absent from that list.
6. `firecrawl-client.ts` is untouched (`git diff --stat` shows no change to it); no shared HTTP helper
   module was created.

---

## Definition of Done

- U1, U2, U3 complete; all Verification Contract checks pass.
- Both RAG reads are byte-bounded via the streamed counter; over-cap → `parse_error` → `unavailable`
  on both the success body and the error path, proven by real-over-cap tests (not mocked branches).
- The seeker agent carries `defaultOptions.maxSteps = STEP_CAPS.toolCallingTurn`, verified via
  `getDefaultOptions()` against the shared constant.
- The routing-convention note and the new env-table row are in `apps/mastra/CLAUDE.md`.
- Zero new required-at-boot env vars; the no-throw result-union and `{ status, sources, message? }`
  tool shape are unchanged.
- Out-of-scope items (firecrawl, helper extraction, in-memory eviction, direct-path wall-clock budget)
  are untouched.
- Changes left uncommitted in the worktree for local review (no commit/push/PR).

---

## Scope Boundaries

### In scope

Byte-cap on `jesusfilm-rag-client.ts` only (both read sites); a default `maxSteps` on the seeker
`Agent` via `defaultOptions` reusing `STEP_CAPS.toolCallingTurn`; the routing-convention note + env-row
in `apps/mastra/CLAUDE.md`; tests for the oversized-body→`unavailable` path (both sites, real over-cap)
and a confirm-the-default test for `maxSteps`.

### Deferred for later (origin decisions — not this plan)

- **In-memory `Memory` eviction → feat-208.** The Postgres move eliminates the heap-OOM risk rather
  than relocating it; building eviction now would be throwaway. Deferral tripwire (from origin):
  revisit an interim guard if feat-208 is not in-progress by the time feat-202 ships, **or** if the
  seeker is promoted beyond Studio/dogfooding exposure.
- **Per-request wall-clock budget on the direct `/api/agents/*` path.** Step-capping (U2) bounds the
  loop dimension only; the direct path keeps no wall-clock bound — its containment remains the network
  boundary.

### Outside this work's identity (accepted, left to owners)

- **`firecrawl-client.ts`'s identical uncapped `response.json()` (`:212`, `:329`).** Real and
  identical risk, consciously **accepted and left to the firecrawl owners** — an organizational scope
  decision, not a risk-tiering one. feat-202 deliberately neither caps nor extracts firecrawl and
  opens no cross-lane ticket; the observation is recorded in the origin brainstorm so it isn't lost.

---

## Risks & Dependencies

- **R-risk1 — Cap too low rejects valid retrievals.** Mitigated by KTD2's ~8× headroom over a generous
  payload estimate and the env override. If a future contract grows passage size materially, raise the
  default (or set the env var) — surfaced as `unavailable`, never a crash.
- **R-risk2 — Wrong constructor field (legacy vs vNext) makes the floor cosmetic.** Closed by KTD4's
  type-surface check against the installed `@mastra/core@1.36.0` and KTD5's `getDefaultOptions()`
  resolver assertion.
- **R-risk3 — `response.body` shape in tests.** `new Response(string)` provides a real
  `ReadableStream` body, so the over-cap tests exercise the real streamed path; the null-body scenario
  guards the one shape that lacks a stream. No mock of `getReader` is needed (and would defeat the
  "real over-cap" requirement).
- **No build/runtime dependencies** beyond the already-installed `@mastra/core@1.36.0`. No schema,
  GraphQL, or cross-app changes. U1/U2/U3 are mutually independent and can land in any order.

---

## Sources & Research

- Origin requirements: `docs/brainstorms/2026-06-29-seeker-rag-runtime-hardening-requirements.md`
- Ticket: `docs/roadmap/ai-chat/feat-202-seeker-rag-runtime-hardening.md`
- Code read during planning: `apps/mastra/src/services/jesusfilm-rag-client.ts` (+ its test),
  `apps/mastra/src/mastra/agents/seeker-agent.ts` (+ its test), `apps/mastra/src/mastra/agents/seeker-route.ts:272`,
  `apps/mastra/src/mastra/budgets.ts` (`STEP_CAPS.toolCallingTurn`), `apps/mastra/src/config/env.ts`
  (`JESUSFILM_RAG_TIMEOUT_MS` sibling knob, `getJesusfilmRagConfig`), `apps/mastra/src/mastra/tools/retrieve-answer.ts`
  (confirmed `!response.ok` → `status: "unavailable"` for every reason, incl. `parse_error`).
- Mastra API verified against installed `@mastra/core@1.36.0`: `defaultOptions` constructor field
  (`dist/agent/types.d.ts:318`) + `getDefaultOptions()` resolver + `AgentExecutionOptions.maxSteps`.
- Institutional learnings applied: optional-env-var discipline
  (`docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`);
  mocked-shape-vs-real-contract testing discipline
  (`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`) — hence the
  real-over-cap tests rather than a mocked branch.
- External research: none — local patterns (the firecrawl `.slice` cap, the sibling RAG env knob, the
  standard Web Streams `getReader` API) are sufficient; no unsettled external option set.
