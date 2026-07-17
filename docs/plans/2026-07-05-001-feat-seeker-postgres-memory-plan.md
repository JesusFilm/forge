# feat-208 — Postgres-persisted ai-chat memory (Seeker) — Plan

- Roadmap: `docs/roadmap/ai-chat/feat-208-seeker-postgres-memory.md`
- Lane: `ai-chat` (docs-only lane — see `docs/roadmap/ai-chat/CLAUDE.md`)
- Status: implemented in the same PR as this plan
- Depends on: feat-205 (chat ↔ `/forge-seeker` wiring); recorded feat-209 preconditions below

> **Amendment (2026-07-13, feat-240 rewording):** §G's first precondition
> ("revocation/re-verification must land first" before per-user thread
> listing) is superseded — feat-240 dropped the session-lease/revocation
> design by decision. Revocation is not a precondition for feat-241 and is
> not planned; the retained preconditions are real sign-out (feat-240's
> force-login marker, so a shared browser cannot silently re-auth into
> someone's history), signed-in-only `user:*` scoping, and the rest of §G.
> Decision record:
> `docs/roadmap/ai-chat/feat-240-chat-sign-out-force-login.md`. The original
> text below is unmodified.

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
5. `@mastra/pg@1.11.1`'s `getThreadById` THROWS a `MastraError` on a store
   error (dist catch → `throw`) — so the ownership check propagates the fault
   and the caller maps it to `generation_failed` (fail closed).
   **Security-load-bearing: if a bump ever flips this to swallow/return-null,
   ownership silently fails OPEN** — a store blip reads the thread as absent →
   the ceiling branch returns `ok:true` → Mastra's silent-adopt (fact 1) lets
   another resource continue the thread.
6. `@mastra/pg@1.11.1`'s `listThreads` SWALLOWS a store error (dist catch →
   logs, returns `{ total: 0, threads: [] }`) — so the creation-ceiling check
   reads zero and lets a new thread through (fail open). §C's fail-mode split
   and §E's purge connectivity probe both depend on this throw-vs-swallow
   asymmetry.
7. `@mastra/pg@1.11.1`'s `getThreadById` returns `null` (not a throw) for a
   missing id — the §E retention probe relies on this to no-op cheaply on a
   healthy store; a bump that makes not-found throw would fail every purge run.

These behaviors (facts 1–7) are internal to pinned dependencies and no
fake-Memory unit test observes them. `ai-chat-pg-failmode-contract.test.ts`
pins the security-critical direction of fact 5 against the REAL
`Memory`+`PostgresStore` surface — an unreachable-store smoke asserting a
thread read REJECTS rather than resolving null (the ownership fail-CLOSED +
retention-probe-fires guarantee), so that drift fails CI. Facts 6 (post-init
`listThreads` swallow) and 7 (missing-id → null) need a reachable store and
stay covered by the real-Postgres smoke. Re-verify facts 1–7 in the dist on
every `@mastra/*` bump — the surface is TWO packages: the fail-closed
propagation also needs `@mastra/memory` to keep delegating
`getThreadById`/`listThreads` to the store without its own try/catch.

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
runtime store may not (`assertMastraRuntimeEnv` still rejects it).
Kill-switch scope: it reverts **writes** only — the retention purge (§E) is
deliberately gated on a postgres backend being configured at all
(`canAiChatDataPersist`), not on this switch, so conversations already stored
in `ai_chat` keep aging out on schedule while the switch is engaged. Note:
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
  in-stream fixed-vocabulary error frames (enum-only KTD6 logging, no ids).
  The gate call is raced against the turn budget (`settleWithinBudget`), so a
  slow-not-down Postgres surfaces as the fixed `timeout` frame instead of
  hanging the stream past the 90s ceiling. Fail modes differ by branch (facts
  5–6), not uniform: the **ownership** check fails **closed** — `getThreadById`
  throws on a store error, falling through to `generation_failed`, so a store
  blip never grants continuation of another resource's thread (the
  security-critical guarantee); the **ceiling** check fails **open** —
  `listThreads` swallows store errors and returns `total 0`, so a transient
  fault lets a new thread through. Accepted: the ceiling is a soft anti-abuse
  cap backstopped by the retention purge, never the access boundary, and a
  genuinely-down store fails the downstream stream anyway.
- Both reasons pass through the chat proxy verbatim (never folded into
  `generation_failed`) into `REPLY_FAILURE_REASONS` and distinct UI notices.
- Identity-change rotation holds by construction today (OAuth sign-in/out are
  full-page redirects; conversation state is client-memory-only) — an
  invariant feat-209 must deliberately preserve once ids live in URLs. The
  one identity change WITHOUT a redirect is passive session expiry, accepted
  below.
- Accepted + documented: cookie-refusing clients lose continuity at turn 2
  (`thread_forbidden` via the failure-notice UI); passive session expiry —
  the 8h session cookie lapsing in an open tab has no redirect, so client
  state survives, the next send resolves as `anon:*`, and the ownership gate
  rejects the user's own thread as `thread_forbidden` (same failure-notice
  recovery; feat-209 should turn this into an explicit "session expired —
  sign in again" path once threads are URL-addressable, see §G); TOCTOU
  residue (check-then-stream race at creation time vs a v4 UUID);
  `thread_forbidden` as an existence oracle for thread ids (v4 UUID entropy
  makes probing infeasible).

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
- **Purge job** (`apps/mastra/src/mastra/ai-chat-retention.ts`): boot drain +
  daily timer, started only in the deployed runtime (`NODE_ENV=production`)
  so builds / `mastra dev` CLI-analysis imports never fire DB I/O at module
  load. Accepted asymmetry (recorded): writes gate on the postgres backend —
  which defaults on in any `NODE_ENV` — but the purge additionally gates on
  `NODE_ENV=production`. Deliberate: real high-sensitivity content only
  accumulates on the public production surface, local dev runs the memory
  backend by convention, and there are no non-production deployments today, so
  any future non-public env that ever faces real users must enable retention
  explicitly. Each run first issues a `getThreadById` connectivity probe on a
  reserved sentinel id, so a store outage **present at run start** fails loudly
  (`purge_failed`) rather than logging a false `purge_complete scanned=0` (per
  facts 5–6, `getThreadById` throws while `listThreads` swallows store errors);
  a store that drops mid-run after the probe can still log a false completion
  (the `listThreads` swallow is unguarded there) — a narrow accepted residual. It then drains the
  expired backlog in bounded sweeps (≤500 deletes per sweep, ≤20 sweeps/run —
  the remainder carries over to the next tick), scanning oldest-first
  (`orderBy updatedAt ASC`, early-stopping once rows are inside the shortest
  window) and re-checking recency immediately before every delete so a thread
  resumed mid-sweep survives; deletes via `Memory.deleteThread` (also removes
  messages + orphaned vectors). The drain-stop keys on the **collected** batch
  size, not the deleted count, so a full batch the recency re-check partly
  spares does not end the run early and strand still-expired rows for a tick.
  Runs whenever a postgres backend is configured at all
  (`canAiChatDataPersist`), over a Memory built DIRECTLY on the persisted
  `ai_chat` store — so the §B kill-switch stops writes, never retention —
  while pure memory-backend local runs stay pool-free (the "boots clean with
  no Postgres" invariant); enum/count-only logging. Single-instance
  assumption: replicas would each run redundant (harmless, wasteful) sweeps —
  add a leader guard before scaling out. §F records the resulting storage
  bound and what it does NOT bound.
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
fresh `anon:<uuid>` resource per POST for free. The 30-day purge is the only
adversarial _storage_ control, and it is a bounded one: each daily run drains
up to ~20 sweeps (~10k deletes) and carries any remainder to the next tick
(§E), so total junk stays near one retention window × inflow rate **only while
daily expiry stays under that ~10k/day drain ceiling** — beyond it the backlog
compounds across days rather than staying bounded. And **in-window growth is
unbounded** regardless, and a concurrent junk-POST burst can saturate the
5-connection `ai_chat` pool long before storage matters. Nothing here bounds inflow itself: inbound auth +
rate caps remain hard prerequisites before the audience widens (unchanged
from feat-205/207) — they, not the purge, are the actual flood control.

## G. feat-209 preconditions (recorded now)

- Per-user thread listing turns the revocation-less, display-only feat-207
  cookie into an **authorization credential** — revocation/re-verification
  must land first (feat-207's own code comment).
- Listing API: `memory.listThreads({ filter: { resourceId }, page, perPage })`.
- Never list the `seeker-dogfood` fallback resource.
- Preserve the identity-change thread-rotation invariant once ids live in
  URLs.
- Turn passive session expiry into an explicit "session expired — sign in
  again" path once threads are URL-addressable — today it surfaces as
  `thread_forbidden` (see §C).
- Anonymous→account thread migration stays out of scope (accepted
  limitation).

## Verification (all executed pre-merge)

- Unit: backend seam + `ai_chat` schema options + singleton/reset
  (`memory.test.ts`); ownership/ceiling gate incl. missing-owner fail-closed
  (`ai-chat-thread-ownership.test.ts`); retention windows, boundary-exact
  purge, drain + per-run sweep valve, ordered early-stop scan, recency
  re-check before delete, enable gate, failing-sweep survival
  (`ai-chat-retention.test.ts`); route gate frames + fail-closed + real-memory
  replay rejection (`seeker-route.test.ts`); anon-id validation/rolling/
  namespacing incl. the day-31 case (`anon-id.test.ts`); proxy resourceId
  forwarding, Set-Cookie attachment, reason passthrough (`route.test.ts`).
- Post-review additions (same PR): ownership-gate budget-timeout regression
  (`seeker-route.test.ts`); kill-switch precedence + `canAiChatDataPersist`
  gating (`env.test.ts`); thread-gate UI failure notices
  (`message-list.test.tsx`).
- Tier-2 review additions (same PR): retention drain continues after a full
  batch the recency re-check partly spares, and the purge rejects on a store
  outage instead of logging a false `purge_complete scanned=0`
  (`ai-chat-retention.test.ts`); §C's per-branch fail-mode split (ownership
  closed / ceiling open) recorded against verified facts 5–7, with
  `ai-chat-pg-failmode-contract.test.ts` pinning the fail-CLOSED direction
  against the real `Memory`+`PostgresStore` (unreachable-store smoke). Mastra
  suite 809 green (typecheck + lint clean).
- Real-DB smoke against local Postgres 16 (all passed): (a) two turns → fresh
  store instance ("restart") → recall; (b) owner allowed / different resource
  → `thread_forbidden` / over-ceiling → `thread_limit`; (c) tables landed in
  `ai_chat`, nothing new in `mastra` (also proves the role's CREATE
  privilege); (d) aged thread purged with no orphaned messages, live thread
  kept.
- `pnpm --filter @forge/mastra test|typecheck|lint` and
  `pnpm --filter @forge/chat test|typecheck|lint` green.
