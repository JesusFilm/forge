# feat-208 — Postgres-persisted ai-chat memory (Seeker) — Plan

- Roadmap: `docs/roadmap/ai-chat/feat-208-seeker-postgres-memory.md`
- Lane: `ai-chat` (docs-only lane — see `docs/roadmap/ai-chat/CLAUDE.md`)
- Status: implemented in the same PR as this plan
- Depends on: feat-205 (chat ↔ `/forge-seeker` wiring); recorded feat-209 preconditions below

## Goal

Move the seeker agent's Memory off its deliberately non-persistent
`InMemoryStore` onto Postgres via `@mastra/pg`, in a schema **separate** from
the `mastra` schema (runtime storage + experience-chat memory), so ai-chat
conversations never mix with other agents' data. The same schema is shared by
every future ai-chat agent (intent routing, etc.): Mastra memory threads are
keyed by `threadId`+`resourceId` with **no agent scoping**, so agents pointed
at the same storage and called with the same keys share a thread by
construction.

Verified against the pinned packages (`@mastra/core@1.36.0`,
`@mastra/memory@1.18.2`, `@mastra/pg@1.11.1` — dist sources, not docs):

1. **Mastra enforces no thread ownership on the message path.** Both
   agent-side thread-preparation call sites run `getThreadById({ threadId })`
   and silently adopt an existing thread without comparing its `resourceId` to
   the caller's resource (the only mismatch throw is in the
   `update-working-memory` tool). `resourceId` is only stamped at
   `createThread`.
2. `getThreadsByResourceId` does not exist in Mastra 1.x — thread listing is
   `memory.listThreads({ filter: { resourceId }, page, perPage })`.
3. `@mastra/pg`'s `saveMessages` bumps `mastra_threads.updatedAt`
   transactionally with every message insert — thread `updatedAt` is a true
   rolling last-activity key, so retention can key on it.
4. `Agent.network()` delegation auto-isolates subagent memory (fresh thread
   per delegation) — cross-agent thread sharing must be explicit per-call
   `memory: { thread, resource }`, never delegation defaults.

## A. Storage — dedicated `ai_chat` schema, shared singleton

`apps/mastra/src/mastra/memory.ts` gains an ai-chat section mirroring the
experience-chat one: `buildAiChatStorage()` → `PostgresStore({ id:
"ai-chat-storage", connectionString: getMastraDatabaseUrl(), schemaName:
"ai_chat", max: 5 })`, lazy singleton `getAiChatStorage()` +
`__reset*ForTesting`. Auto-DDL (`CREATE SCHEMA IF NOT EXISTS` + tables) at
init. Same DB, separate schema: a future reset is `DROP SCHEMA ai_chat
CASCADE`. Pool arithmetic recorded in the file header: runtime store defaults
`max ?? 20` → ~32 potential connections service-wide (20 + 5 experience-chat +
2 vector + 5 ai-chat).

## B. Memory factory — backend-aware, seam-injectable, kill-switch

`buildAiChatMemory()` replaces `buildSeekerMemory()`: resolved backend
`memory` → dedicated `InMemoryStore` (local dev/tests); else
`Memory({ storage: getAiChatStorage() })`. Storage-only — no PgVector /
embedder / semantic recall in this ticket. Injectable `getBackend` seam
(defaults to `resolveAiChatMemoryBackend()`) for per-case unit tests.

New **optional** env var `AI_CHAT_MEMORY_BACKEND` (`enum postgres|memory`,
`.optional()`, runtime fallback to `MASTRA_STORAGE_BACKEND`, never required at
boot): the production kill-switch to revert seeker persistence without a code
deploy. Carve-out: this one surface may run in-memory in production; the
runtime store may not (`assertMastraRuntimeEnv` still rejects it). Note:
`AI_CHAT_MEMORY_BACKEND=postgres` + `MASTRA_STORAGE_BACKEND=memory` locally
makes the seeker's first turn hit an unreachable Postgres — set both or
neither.

## C. Thread ownership check (new, load-bearing)

Because of verified fact 1, `threadId` alone would grant continuation of
anyone's thread through the world-reachable unauthenticated `/api/seeker`
proxy — and a mid-conversation identity change would silently continue the old
thread rather than erroring. So:

- New shared helper `apps/mastra/src/mastra/ai-chat-thread-ownership.ts`:
  `authorizeAiChatThreadAccess({ memory, threadId, resource })` — existing
  thread whose `resourceId !== resource` → `thread_forbidden`; new thread over
  the per-resource ceiling → `thread_limit`. Future ai-chat routes inherit it.
- `handleSeekerRouteRequest` runs it before `agent.stream`; rejections emit
  in-stream fixed-vocabulary error frames (enum-only KTD6 logging, no ids). A
  store failure falls through to `generation_failed` — fail closed, never
  open.
- Both reasons pass through the chat proxy verbatim (never folded into
  `generation_failed`) into `REPLY_FAILURE_REASONS` and distinct UI notices.
- Identity-change rotation holds by construction today (OAuth sign-in/out are
  full-page redirects; conversation state is client-memory-only) — an
  invariant feat-209 must deliberately preserve once ids live in URLs.
- Accepted + documented: cookie-refusing clients lose continuity at turn 2
  (`thread_forbidden` via the failure-notice UI); TOCTOU residue (check-then-
  stream race at creation time vs a v4 UUID); `thread_forbidden` as an
  existence oracle for thread ids (v4 UUID entropy makes probing infeasible).

## D. Resource keying — namespaced, rolling anon cookie

The chat proxy resolves `resourceId` server-side, never client-supplied
(`apps/chat/src/auth/anon-id.ts`):

- Signed in → `user:<sub>` (session cookie's verified sub — used as a memory
  **partition key** only, never authorization, per feat-207 R7).
- Anonymous → `anon:<uuid>` from a dedicated cookie. Prefix namespacing makes
  anon↔sub collision unrepresentable; consumers prefix-check (`startsWith`)
  only — never split on `:` (a sub may contain anything). Value validated as a
  UUID on every read; anything else is discarded and re-minted.
- Cookie spec: session-cookie hardening (HttpOnly, Secure in prod,
  SameSite=Lax, host-only, Path=/), minted only on first message send, and
  **re-set with a fresh 30-day Max-Age on every send** so its lifetime rolls
  with the retention window (the day-31 active user keeps threads AND
  cookie). Set-Cookie is attached when the SSE `Response` is constructed —
  headers cannot be added after streaming begins.
- The proxy **always** sends a resolved `resourceId` (no fallback).
  `/forge-seeker` keeps `SEEKER_DEFAULT_RESOURCE_ID` for other dogfooding
  callers; feat-209 must never list that fallback resource.

## E. Data stewardship — retention, deletion, disclosure

Seeker conversations can carry deeply personal spiritual content; we treat
them as high-sensitivity data and pair persistence with an explicit
stewardship position from day one:

- **Retention:** anonymous threads (resource not prefixed `user:` — includes
  `anon:*` and the dogfood fallback) purged **30 days** after last activity;
  signed-in threads **180 days**. Revisit at feat-209.
- **Purge job** (`apps/mastra/src/mastra/ai-chat-retention.ts`): boot sweep +
  daily timer; bounded (500 deletes/run) collect-then-delete over
  `listThreads` pages; deletes via `Memory.deleteThread` (also removes
  messages + orphaned vectors); **no-ops unless the resolved ai-chat backend
  is postgres** (preserves the "boots clean with no Postgres" local-dev
  invariant); enum/count-only logging. The purge is also the adversarial
  backstop on storage growth.
- **Deletion path:** operator-run SQL keyed by `resourceId` (runbook in
  `apps/mastra/CLAUDE.md`). Self-serve deletion is follow-up work.
- **Disclosure:** one quiet line in the chat empty state when Seeker is live
  ("Conversations are saved to keep continuity between visits — anonymous
  conversations are kept for 30 days."). The full privacy/consent surface is
  a public-launch-gate item.

## F. Abuse posture, restated honestly

`/api/seeker`'s accepted unauth/un-rate-limited posture now has durable
consequences: each junk POST writes rows in the same database as Mastra
runtime storage. The per-resource thread ceiling (200, checked at new-thread
creation via `listThreads` total, failing as `thread_limit`) bounds a single
cooperative or runaway client **only** — a cookie-refusing attacker can mint a
fresh `anon:<uuid>` resource per POST for free, so **the 30-day purge is the
sole adversarial backstop**. Inbound auth + rate caps remain hard
prerequisites before the audience widens (unchanged from feat-205/207).

## G. feat-209 preconditions (recorded now)

- Per-user thread listing turns the revocation-less, display-only feat-207
  cookie into an **authorization credential** — revocation/re-verification
  must land first (feat-207's own code comment).
- Listing API: `memory.listThreads({ filter: { resourceId }, page, perPage })`.
- Never list the `seeker-dogfood` fallback resource.
- Preserve the identity-change thread-rotation invariant once ids live in
  URLs.
- Anonymous→account thread migration stays out of scope (accepted
  limitation).

## Verification (all executed pre-merge)

- Unit: backend seam + `ai_chat` schema options + singleton/reset
  (`memory.test.ts`); ownership/ceiling gate incl. missing-owner fail-closed
  (`ai-chat-thread-ownership.test.ts`); retention windows, boundary-exact
  purge, paging, delete bound, backend gate, failing-sweep survival
  (`ai-chat-retention.test.ts`); route gate frames + fail-closed + real-memory
  replay rejection (`seeker-route.test.ts`); anon-id validation/rolling/
  namespacing incl. the day-31 case (`anon-id.test.ts`); proxy resourceId
  forwarding, Set-Cookie attachment, reason passthrough (`route.test.ts`).
- Real-DB smoke against local Postgres 16 (all passed): (a) two turns → fresh
  store instance ("restart") → recall; (b) owner allowed / different resource
  → `thread_forbidden` / over-ceiling → `thread_limit`; (c) tables landed in
  `ai_chat`, nothing new in `mastra` (also proves the role's CREATE
  privilege); (d) aged thread purged with no orphaned messages, live thread
  kept.
- `pnpm --filter @forge/mastra test|typecheck|lint` and
  `pnpm --filter @forge/chat test|typecheck|lint` green.
