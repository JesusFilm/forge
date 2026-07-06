---
id: "feat-209"
title: "Per-conversation URLs + sidebar history"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-07-15"
duration: 3
depends_on:
  - "feat-207"
  - "feat-208"
blocks: []
tags:
  - "web"
---

## Problem

Conversations are client-only with no URL, so they can't be deep-linked,
restored, or shared, and there's no sidebar of past conversations. Add
per-conversation URLs and a history sidebar, reading history back from the
`ai_chat` Postgres memory feat-208 established.

## Hard preconditions (recorded by feat-208 — read before starting)

1. **Revocation before listing.** Per-user thread listing turns the
   revocation-less, display-only feat-207 session cookie into an
   _authorization credential_ (a stolen/replayed cookie would read a user's
   full spiritual-conversation history). feat-207's own code comment
   (`apps/chat/src/auth/identity.ts`) requires revocation/re-verification
   before the first feature trusts the subject — that work is a dependency of
   this ticket's listing surface, not optional hardening.
2. **Listing API.** Mastra 1.x has no `getThreadsByResourceId` — use
   `memory.listThreads({ filter: { resourceId }, page, perPage })`.
3. **Never list the fallback resource.** `SEEKER_DEFAULT_RESOURCE_ID`
   (`"seeker-dogfood"`) is a shared commons for non-chat dogfooding callers —
   it must never appear as anyone's history.
4. **Preserve the rotation invariant.** Today an identity change (sign-in/out
   full-page redirect) resets client conversation state, so post-change
   conversations get fresh thread ids by construction. Once ids live in URLs
   that reset no longer happens for free — rotation on identity change must be
   preserved deliberately, or the feat-208 ownership gate will (correctly)
   reject the resumed thread with `thread_forbidden`.
5. **Anonymous→account migration stays out of scope** (feat-208 accepted
   limitation): threads created anonymously belong to the `anon:<uuid>`
   resource and are not re-parented on sign-in.
6. **Session-expiry UX.** Passive expiry of the 8h session cookie (no
   redirect) makes the next send resolve as `anon:*`, so the ownership gate
   returns `thread_forbidden` on the user's OWN thread (feat-208 accepted
   limitation, plan §C). With URL-addressable threads, opening an old link
   with an expired session becomes the COMMON path — map
   `thread_forbidden` + signed-out state to an explicit "session expired —
   sign in to continue" prompt (not the generic failure notice). Do NOT fix
   this by rolling/extending the session cookie lifetime before precondition
   1 (revocation) lands: the 8h fixed TTL is the only bound on a
   revocation-less credential.

## Entry Points — Read These First

1. `docs/plans/2026-07-05-001-feat-seeker-postgres-memory-plan.md` — §C/§D/§G
   (ownership gate, resource keying, these preconditions).
2. `apps/mastra/src/mastra/ai-chat-thread-ownership.ts` — any new listing
   route must scope strictly by the caller's resolved resource.
3. `apps/chat/src/auth/anon-id.ts` — how the proxy resolves resources.
4. `apps/chat/src/components/shell/sidebar-conversation-list.tsx` — the
   sidebar surface to feed from server history.

## Grep These

- `listThreads` in `apps/mastra/` — the pagination + filter surface.
- `SEEKER_DEFAULT_RESOURCE_ID` — the resource that must never be listed.
- `resolveSeekerResource` — the only legitimate source of a listing scope.

## What To Build

(To be planned when picked up — a bearer-gated Mastra listing/replay route
scoped by resource, chat-side per-conversation URLs, sidebar hydration, and
the revocation work from precondition 1.)

## Constraints

- No listing surface before precondition 1 lands.
- History reads must go through a bearer-gated `/forge-*` route (never
  Mastra's built-in `/api/*` surfaces) and be scoped server-side to the
  caller's resolved resource — the client never names a resource.

## Verification

- A signed-in user sees only threads whose resource is their own `user:<sub>`.
- The dogfood fallback resource never appears in any listing.
- A replayed conversation URL under a different identity is rejected
  (`thread_forbidden`), not silently adopted.
