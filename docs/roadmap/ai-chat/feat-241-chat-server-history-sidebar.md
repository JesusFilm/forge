---
id: "feat-241"
title: "Chat server-side conversation history + sidebar hydration"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-07-20"
duration: 3
depends_on:
  - "feat-208"
  - "feat-240"
blocks:
  - "feat-209"
  - "feat-247"
  - "feat-248"
  - "feat-250"
tags:
  - "web"
  - "ai-pipeline"
---

## Resolution

**Shipped:** 2026-07-14 via [PR #1552](https://github.com/JesusFilm/forge/pull/1552) (`feat(chat): server-side conversation history + sidebar hydration (feat-241)`).

**What landed.** The full read path: two bearer-gated Mastra routes (listing with explicit `updatedAt DESC` + clamped pagination; replay through the ownership gate + existence check with a text-only 8,192-UTF-16-unit-per-message projection) behind a NEW dedicated `AI_CHAT_SERVICE_API_KEYS` lane bearer (boot-asserted disjoint from the shared pool), LLM thread titles via Mastra `generateTitle` (signed-in resources only, per-call override on the send route), two POST-shaped chat proxies with the KTD8 closed deny vocabulary, and `useConversations` hydration/merge/Load-more/lazy-replay/resume with sends blocked until a transcript loads. Review-driven deltas from the brief, recorded in the plan's Implementation Deviations addendum: thread byte-cap 4→8 MiB (UTF-16 sizing math), read budgets 8s route / [9s,10s] proxy / 15s client, the KTD10 persisted predicate widened to failed turns with partial text, and access loss reverting silently to the client-only sidebar on every surface (KTD8 uniformity). The dogfood gate rides the new `"history"` surface; feat-236's removal recipe was refreshed in this PR (AE15) and gained a titling data-flow precondition. Operational tail: provision Mastra `AI_CHAT_SERVICE_API_KEYS` before chat `AI_CHAT_MASTRA_API_KEY` (receiver-first), then triage the expected CodeQL `js/request-forgery` alerts on the two new proxy fetch call sites.

**Compounded learnings.** All six compound artifacts were independently doc-reviewed (six sessions); findings applied — citation-drift fixes plus one substantive correction (the `seekerEnabled` guard in the Mastra corollary's quoted predicate).

New solution docs:

- `docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md` — StrictMode remount wedge in `useConversations`: cleanup-mutated hook-lifetime refs must be restored in setup; a jsdom StrictMode render is the only deterministic detector.
- `docs/solutions/developer-experience/chat-mastra-gated-stack-local-smoke-recipes.md` — local signed-in/gate-granted smoke recipes without `apps/auth` or a model key (hand-minted session cookie + Mastra memory-API seeding).
- `docs/solutions/build-errors/nextjs-dev-types-validator-corrupt-after-killed-dev-server.md` — killed dev server leaves a corrupt `.next/dev/types/validator.ts` failing tsc with TS1109; `rm -rf .next`.

Fold-ins to existing docs:

- `docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md` — sizing corollary: byte caps derived from char-denominated contracts need the 3-bytes-per-UTF-16-unit worst case (the 4 MiB → 8 MiB history-cap correction).
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — 14th worked instance: the reasonless-404 body-conditional classification trap in `history-client.ts`.
- `docs/solutions/architecture-patterns/browser-sse-proxy-to-bearer-gated-internal-sse-20260626.md` — guidance #7: body-conditional reason passthrough binds EVERY hop of a closed-vocabulary reason chain.
- `docs/solutions/architecture-patterns/mastra-agent-stream-auto-creates-thread-contract-20260626.md` — consumer-side corollary: auto-create runs before generation, so a failed turn with partial text still persisted a thread (the KTD10 partial-text predicate).

Root `CLAUDE.md` Known Patterns: new StrictMode remount-safety bullet; char-vs-byte sizing corollary appended to the byte-cap bullet; mocked-shape instance count corrected to fourteen.

**Residual risk / follow-ups.** [feat-247](feat-247-chat-history-management.md) (delete/rename), [feat-248](feat-248-chat-anon-thread-migration.md) (anon→account migration, future consideration), [feat-250](feat-250-seeker-route-lane-key-migration.md) (send path stays on the shared pool — pool keys can still WRITE into `user:*` partitions until it lands), [feat-209](feat-209-chat-per-conversation-urls.md) (deep links + explicit session-expired UX), [feat-236](feat-236-chat-remove-seeker-dogfood-gate.md) (gate removal; step-0 rate cap covers the history routes too, plus the new titling data-flow precondition). Accepted day-one: pg `listThreads` fails open (store outage reads as an empty sidebar), replay 403/404 split is a thread-id existence oracle (v4-UUID entropy), offset-page drift until refresh, stolen-cookie blast radius now includes bulk transcript read (8h TTL, feat-240 Decision Record).

**Unblocked.** feat-209, feat-247, feat-248, feat-250 (all `depends_on` this ticket).

## Problem

Since feat-208, Seeker conversations persist server-side (Mastra's `ai_chat`
Postgres schema, keyed by a proxy-resolved per-user resource) — but the UI
cannot read them back. The sidebar lists only in-memory client conversations
that reset on refresh. Build the server history read path: Mastra listing +
replay routes, a chat-side proxy, and sidebar hydration.

**History is signed-in-only by design** (listing AND replay). The anonymous
continuity cookie is a long-lived bearer token that must never become a
history-reading credential; anonymous conversations stay ephemeral (lost on
refresh) deliberately — that ephemerality is a privacy feature for this
product.

**And for the dogfood phase, history additionally rides the seeker gate**
(decided 2026-07-09): the history proxy routes deny unless
`resolveSeekerGate` returns a full grant — the same `SEEKER_ALLOWED_EMAILS`
layer that fronts `/api/seeker`. Rationale: server-side threads are only ever
created by the Seeker path, which only allowlisted users reach, so the gate
excludes zero legitimate users while shrinking the audience of this new
surface from "any signed-in account" back to the dogfood roster — which
matters since apps/auth enabled public signup (PR #1504, 2026-07-09: anyone
can now create an account, though the seeker gate still stands in front of
the paid path). The gate layer is phase-scoped scaffolding and comes off in
feat-236 with the rest of the dogfood gate; signed-in + server-side
resource scoping are the permanent design (feat-240's session lease was
dropped — see its Decision Record).

## Entry Points — Read These First

1. `apps/mastra/src/mastra/ai-chat-thread-ownership.ts` —
   `authorizeAiChatThreadAccess` + the narrow Memory surface. The replay route
   must call this before returning any messages; the listing route must scope
   strictly by the caller's resolved resource.
2. `apps/mastra/src/mastra/index.ts` + `apps/mastra/src/mastra/agents/seeker-route.ts`
   — the `registerApiRoute("/forge-*")` bearer-gated route pattern to follow.
3. `apps/chat/src/auth/anon-id.ts` — `resolveSeekerResource`, the only
   legitimate source of a listing scope (prefix-check only, never split on
   `:`).
4. `apps/chat/src/app/api/seeker/route.ts` — the existing proxy shape (bearer
   held server-side, SSRF/https guard, timeout-bounded, plain-string logs);
   the history proxy routes follow it.
5. `apps/chat/src/lib/seeker-gate.ts` + `apps/chat/src/app/api/seeker/route.gate-wiring.test.ts`
   — the gate helper the history routes must call, and the test pattern for
   proving the deny path is wired.
6. `apps/chat/src/lib/use-conversations.ts` — the client hook to hydrate
   (list on load, lazy replay on select, merge with in-session sends).
7. `apps/chat/src/components/shell/sidebar-conversation-list.tsx` — the
   sidebar surface to feed from server history.
8. `docs/plans/2026-07-05-001-feat-seeker-postgres-memory-plan.md` — §C/§D/§G
   (ownership gate, resource keying, recorded preconditions).

## Grep These

- `listThreads` in `apps/mastra/` — Mastra 1.x has no `getThreadsByResourceId`;
  use `memory.listThreads({ filter: { resourceId }, page, perPage })`.
- `SEEKER_DEFAULT_RESOURCE_ID` — the shared dogfood fallback resource that
  must never appear in any listing.
- `resolveSeekerResource` — resource resolution the proxy must reuse.
- `authorizeAiChatThreadAccess` — the ownership gate for replay.
- `deriveTitle` in `apps/chat/src/lib/conversations.ts` — the client-side
  title rule; server threads currently have NO titles (the seeker path
  creates threads implicitly and `generateTitle` is not configured).

## What To Build

1. **Mastra listing route** (new bearer-gated `/forge-*` route): paginated
   `listThreads` filtered to the caller's resolved resource. Server-side
   refusal of any resource that is not `user:`-prefixed — the signed-in-only
   rule is enforced here, not just hidden in the UI. The dogfood fallback
   resource is never listable.
2. **Mastra replay route** (same route file): messages for one thread id,
   `authorizeAiChatThreadAccess` first — `thread_forbidden` on any mismatch,
   never silent adoption.
3. **Chat proxy routes**: resolve the resource server-side from the session
   (the client never names a resource) — a valid signed session cookie IS the
   credential (expired/invalid → refuse; feat-240 dropped the lease design,
   see its Decision Record), hold the Mastra bearer server-side — and deny
   unless `resolveSeekerGate` returns a full grant (the dogfood-phase layer;
   same helper and deny pattern as `/api/seeker`, re-resolved per request).
4. **Hook hydration** in `use-conversations.ts`: fetch the thread list on load
   when signed in; lazy-load messages on select; merge in-session sends with
   server history without breaking the per-conversation pending/abort
   machinery.
5. **Titles**: pick one — derive server-side from the first user message
   (mirroring `deriveTitle`) at thread creation, or enable Mastra's title
   generation. Decide in the plan; either way the listing route returns a
   displayable title.
6. **Sidebar states**: loading / empty / error for the server list, shown only
   when the gate grants; gate-denied and signed-out users keep exactly today's
   client-only sidebar. The "Sign in to save your conversations" nudge is
   DEFERRED to feat-236 — until seeker (and so persistence) is public, the
   nudge would be a false promise for non-allowlisted users.

## Constraints

- **No listing or replay surface before feat-240 merges** — not for a lease
  (feat-240's revocation/lease design is dropped; see its Decision Record,
  which retires the feat-207/feat-208 revocation precondition) but for
  sign-out: until the force-login marker lands, sign-out on a shared browser
  is followed by silent re-auth, which would hand the next user of that
  browser the previous user's full history. Real sign-out precedes history
  exposure.
- **Signed-in `user:*` resources only**, enforced in the Mastra routes.
  `anon:*` resources are never listable or replayable.
- History reads go through bearer-gated `/forge-*` routes only — never
  Mastra's built-in `/api/*` surfaces.
- The client never names a resource; scope always comes from
  `resolveSeekerResource` on the server.
- Anonymous→account thread migration stays out of scope (feat-208 accepted
  limitation).
- No changes to `apps/auth`.
- **The seeker-gate layer on history routes is scaffolding, not the design.**
  It sits IN ADDITION to (never instead of) signed-in + server-side
  resource scoping, and it comes off in feat-236. The
  implementation PR must update feat-236's removal recipe with the new
  `resolveSeekerGate` call sites it adds (the recipe's greps are its source
  of truth — keep them true).
- No day-one rate cap on the history routes: with the gate in front, the
  audience is the dogfood roster. The cap is feat-236's step-0 precondition
  and lands before the gate comes off.

## Verification

- A signed-in allowlisted user sees only threads whose resource is their own
  `user:<sub>`; the dogfood fallback resource never appears.
- A signed-in but non-allowlisted user receives no history (gate denied
  server-side in the proxy routes; the sidebar falls back to client-only
  behavior).
- An anonymous session receives no history (listing refused server-side, not
  just unrendered).
- A replay request for another identity's thread returns `thread_forbidden`.
- A history read with an expired or invalid session cookie is refused.
- Refresh as a signed-in user restores the sidebar from the server; refresh
  as an anonymous user resets, as today.
- `pnpm --filter @forge/chat test lint typecheck` and
  `pnpm --filter @forge/mastra test lint typecheck` clean.
