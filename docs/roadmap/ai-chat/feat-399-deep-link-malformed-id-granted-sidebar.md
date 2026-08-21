---
id: "feat-399"
title: "Deep-link malformed id: keep the granted user's sidebar alive"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-09-01"
duration: 1
depends_on:
  - "feat-209"
blocks:
  - "feat-401"
  - "feat-402"
tags:
  - "web"
---

## Resolution

**Shipped:** 2026-08-21 via [PR #1984](https://github.com/JesusFilm/forge/pull/1984) (`feat(chat): keep the granted user's sidebar alive on a malformed deep link (feat-399)`).

**What landed.** A gate-granted visitor's malformed `/c/<id>` now resolves to a GRANTED shell that opens on the unchanged "no longer available" pane — rail, history hydration and the URL layer stay live, and the pane releases on the first rail selection, New conversation, or history traverse. Anonymous and gate-denied malformed links are unchanged and still fully inert. The gate decision moved from an inline compare in the route to one tested mapper, `deepLinkShell(kind)`, whose `never`-typed default arm is strictly tighter than the expression it replaced (that one would have passed an unknown kind through as a `DeniedScreen`). **Address-bar decision, which this brief left open:** the shell NORMALIZES to `/` — not by a redirect but because the now-live URL layer applies its existing non-persisted rule, as a `replaceState`, so Back still leaves the app; the pane carries the broken-link feedback. The valid-UUID-but-dead case deliberately keeps `/c/<id>`, since there a real id exists to preserve. Two review rounds removed a redundant release conjunct that was masking whether the explicit dismiss actually worked.

**Compound docs.** A new worked-instance row in [mocked-shape-vs-real-contract-discipline-20260506.md](../../solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) — an unfalsifiable "defense in depth" conjunct that launders a sibling test's assertion, with the preventive rule bounded to fail-OPEN redundancy so it cannot read as licence to strip the fail-closed consumer belts. The `CONCEPTS.md` "Denial Screen" entry was also corrected: this feature falsified its "a shell showing one is never gate-granted" clause, now restored scoped to server-decided denials.

**Residual risk / follow-ups.** [feat-401](feat-401-sidebar-no-placeholder-row-for-unstarted-conversation.md) (drop the placeholder "New conversation" rail row) and [feat-402](feat-402-denial-pane-cta-client-side-on-granted-shells.md) (the pane CTA still forces a full reload on granted shells, discarding the hydrated sidebar). Accepted limitation: no cross-model review ran at any stage — four independent contexts, zero independent model families — and the independent security pass was source-level only.

**Unblocked.** feat-401, feat-402.

## Problem

Observed 2026-08-20 during feat-209 dogfooding: a signed-in, gate-granted user who opens a malformed deep link (e.g. `/c/d` — a typo or half-copied URL) gets the "This conversation is no longer available." pane with an EMPTY sidebar — their history rows are gone until they leave via "Start new conversation". This is the designed consequence of feat-209's P1 hardening, not an accident: the route classifies a malformed id server-side as a denial shell, and denial shells are structurally never gate-granted (no history hydration, no URL hook — plan KTD5/KTD6 in `docs/plans/2026-08-18-2122-feat-chat-per-conversation-urls-plan.md`), while the valid-UUID-but-dead case already keeps the rail alive because it resolves client-side through the escalation path. The fix is to route a GRANTED user's malformed id through that same client-side escalation (unavailable pane, live sidebar, the URL layer owning the address bar) WITHOUT weakening denial-shell inertness for the anonymous and gate-denied cases — the discriminating flag-on tests in `apps/chat/src/components/shell/app-shell.deeplink.test.tsx` pin that inertness and must be re-cut deliberately, never deleted. Alternative considered: redirect granted+malformed to `/` (simpler, but loses the "that link was broken" feedback).

## Verification

- Signed-in gate-granted + `/c/<malformed>` → unavailable pane WITH history rows in the rail; address bar behavior decided at implementation (stay or normalize — record the choice).
- Anonymous and gate-denied malformed cases unchanged: fully inert denial shell, no hydration fetch, no history writes.
- `pnpm --filter @forge/chat test && pnpm --filter @forge/chat lint && pnpm --filter @forge/chat typecheck`; re-run the feat-209 browser-matrix rows for the malformed-id and denial-shell cases under `next build` + `next start`.
