---
id: "feat-209"
title: "Per-conversation URLs"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-07-28"
duration: 2
depends_on:
  - "feat-241"
  - "feat-281"
blocks:
  - "feat-399"
tags:
  - "web"
---

## Resolution

**Shipped:** 2026-08-20 via [PR #1974](https://github.com/JesusFilm/forge/pull/1974) (`feat(chat): per-conversation URLs with two-screen deep-link denial (feat-209)`).

**What landed.** Built to the plan (`docs/plans/2026-08-18-2122-feat-chat-per-conversation-urls-plan.md`), which supersedes this brief where amended: URLs are gate-granted-only (not merely signed-in) until feat-236; item 4's unified sign-in state became a two-screen model (sign-in only when there is no session; one identical "no longer available" for every signed-in denial, escalated client-side for thread-level causes so no composer ever renders under a denial); in-app switching is shallow `history.pushState` with a popstate adopt-or-refuse loop and a `pageshow` bfcache guard — never router navigations. Notable empirical result: back/forward traversal issues zero RSC requests on next@16.2.4 (measured, then source-determined — see the solutions pin). Denial shells are structurally never gate-granted (the Tier-2 review's P1).

**Compound docs.** The two-axis-gate instance in `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` (two-axis gate / vacuous flag-off fixtures); `docs/solutions/design-patterns/lifecycle-protection-keyed-to-transient-marker-dies-with-marker.md`; `docs/solutions/developer-experience/mastra-dev-storage-wipe-on-restart.md`; `docs/solutions/best-practices/nextjs-16-shallow-history-traverse-zero-rsc-requests.md`.

**Residual risk / follow-ups.** [feat-399](feat-399-deep-link-malformed-id-granted-sidebar.md) (granted user's sidebar empties on a malformed deep link — designed inertness, UX follow-up); thread ids in Cloudflare/Railway access logs (accepted KTD9 residual; retention-window check registered in feat-339); post-deploy production `/c/<uuid>` probe on the PR checklist.

**Unblocked.** feat-399.

> **Re-sequenced (2026-07-21, architecture-review adjudication):** this ticket
> now lands AFTER feat-281 (the conversation session module) and is expected
> to be a thin URL adapter over that module's interface — the route param
> drives selection through the session, and the no-remount/no-dropped-streams
> requirement is a property the session already provides. Rationale + rulings:
> `docs/handoffs/2026-07-21-chat-architecture-review-rulings.md` (Ruling 1 +
> "feat-209 ordering"). `start_date` pushed 2026-07-23 → 2026-07-28;
> `depends_on: feat-281` added.

> **Planned (2026-08-18):** implementation plan at
> `docs/plans/2026-08-18-2122-feat-chat-per-conversation-urls-plan.md` — it is
> the authority where this brief has drifted. The four corrections it carries:
> (1) "signed-in" below means **gate-granted (`seekerEnabled`)** until feat-236
> removes the dogfood gate — history/replay exist only for allowlisted users,
> so a merely-signed-in user's URL could never restore; (2) item 4's unified
> "sign in to continue" state is **superseded** by a two-screen model (see the
> dated note at item 4); (3) the "thin URL adapter" expectation above holds for
> the URL layer, but deep links to threads outside the hydrated first history
> page need one session extension (an adopt-by-id operation) — plan KTD3;
> (4) per-user erasure (feat-337) and the 25-day retention window (feat-336)
> make a dead `/c/<id>` a normal owner-visible state, covered by the
> "not available" screen. In-app URL changes use shallow
> `history.pushState` + a popstate listener — item 2's "become navigations"
> must NOT be read as router navigations, which remount the pane (plan KTD1).

## Problem

Conversations restore via the sidebar (feat-241) but have no address:
they can't be deep-linked, bookmarked, or reopened from browser history.
Give each signed-in conversation a URL that restores it.

> **Scope note.** This ticket originally bundled "per-conversation URLs +
> sidebar history". It was split (2026-07-08): real sign-out is feat-240
> (whose original session-revocation half was later dropped by decision —
> see that ticket's Decision Record), server history + sidebar hydration is
> feat-241, and this ticket is now only the URL layer on top. The original
> hard preconditions moved with their work: sign-out → feat-240; the listing
> API, fallback-resource exclusion, and anon-migration boundary → feat-241.
> The rotation invariant and the expired-session UX stayed here.

**URLs are signed-in-only.** Anonymous conversations never get a URL: replay
is signed-in-only (feat-241), so an anonymous conversation URL would be a
dead link for everyone including its creator (anonymous→account migration is
out of scope per feat-208), and a URL that can never restore is worse than no
URL. Anonymous chat stays at the root URL with today's ephemeral behavior —
matching the major AI chat products.

## Entry Points — Read These First

1. `apps/chat/src/app/page.tsx` — the single-page entry today (resolves the
   seeker gate + identity server-side, `force-dynamic`); the per-conversation
   route reuses this resolution.
2. `apps/chat/src/lib/use-conversations.ts` — `activeId` /
   `selectConversation` / `newConversation`; these become URL-driven for
   signed-in users. (Post-feat-281 these live on the `ConversationSession`
   interface — adapt the URL layer over the session, not over the hook.)
3. `apps/chat/src/components/shell/app-shell.tsx` — state owner wiring the
   hook to the sidebar and pane.
4. feat-241's replay proxy route — the deep-link restore path; this ticket
   adds no new data surface.
5. `docs/plans/2026-07-05-001-feat-seeker-postgres-memory-plan.md` §C — the
   identity-rotation invariant this ticket must preserve.

## Grep These

- `activeId` and `activeIdRef` in `apps/chat/src/lib/use-conversations.ts` —
  the state the route param takes over.
- `thread_forbidden` in `apps/chat/` — the failure reason the deep-link UX
  maps to the sign-in prompt.
- `useRouter\|usePathname` in `apps/chat/` — should be absent today; this
  ticket introduces the routing layer.

## What To Build

1. **Route structure**: a conversation route (e.g. `app/c/[id]/page.tsx`)
   alongside the root; selecting a conversation or starting a new one (first
   send) updates the URL for signed-in users. Anonymous users stay at `/` —
   no URL is ever minted for an anonymous conversation.
2. **URL ↔ state sync**: the route param drives `activeId`; sidebar select
   and new-conversation become navigations. Client-side transitions must not
   remount the pane or drop in-flight streams (the per-conversation
   AbortController map keeps replies landing in their conversation).
3. **Deep-link restore**: opening `/c/<id>` signed-in loads the thread via
   feat-241's replay path.
4. **One unified "sign in to continue" state** for every deep-link denial —
   expired or invalid session cookie, anonymous visitor, or another
   identity's thread (`thread_forbidden`). The prompt is explicit (not the
   generic failure notice) and never silently adopts the thread.
   > **Superseded (2026-08-18, plan KTD5):** two screens, not one. "Sign in
   > to view this conversation" renders only when there is NO valid session
   > (anonymous ≡ expired ≡ tampered — sign-in is the fix there). A signed-in
   > visitor who is denied — another identity's thread, a deleted/erased
   > thread, a gate-denied account, or a malformed id — gets the existing
   > "This conversation is no longer available." pane with identical wording
   > across those causes. Never adoption, in either screen.
5. **Identity-rotation invariant**: an identity change (sign-in/out) must
   still reset active conversation state. Today the OAuth full-page redirect
   does this for free; once ids live in URLs it must be preserved
   deliberately — after sign-out or identity change, a stale `/c/<id>` in the
   address bar or history resolves through the denial state above, and
   sign-out while viewing `/c/<id>` redirects to `/`.

## Constraints

- Signed-in-only: no anonymous conversation URLs, no anonymous restore.
- No new Mastra or proxy surfaces — deep-link restore reuses feat-241's
  replay path and its server-side scoping.
- No conversation sharing. A URL opened by a different identity is always
  denied; an intentional share feature (snapshot copy) would be its own
  future ticket.
- Anonymous UX is unchanged: root URL, in-memory conversations, reset on
  refresh.

## Verification

- Signed-in: select a conversation → URL changes; open that URL in a new tab
  → same conversation restores; browser back/forward walks conversations.
- Anonymous: chatting never changes the URL; refresh resets as today.
- Deep link while signed out (or with an expired session) → "sign in to
  continue" prompt; after signing in as the owner, the conversation opens.
- Deep link under a different account → denial prompt, never adoption.
- Sign out while viewing `/c/<id>` → lands on `/` as anonymous.
- `pnpm --filter @forge/chat test && pnpm --filter @forge/chat lint && pnpm --filter @forge/chat typecheck`
