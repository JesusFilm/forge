---
id: "feat-399"
title: "Deep-link malformed id: keep the granted user's sidebar alive"
owner: "jian wei"
priority: "P2"
status: "in-progress"
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

## Problem

Observed 2026-08-20 during feat-209 dogfooding: a signed-in, gate-granted user who opens a malformed deep link (e.g. `/c/d` — a typo or half-copied URL) gets the "This conversation is no longer available." pane with an EMPTY sidebar — their history rows are gone until they leave via "Start new conversation". This is the designed consequence of feat-209's P1 hardening, not an accident: the route classifies a malformed id server-side as a denial shell, and denial shells are structurally never gate-granted (no history hydration, no URL hook — plan KTD5/KTD6 in `docs/plans/2026-08-18-2122-feat-chat-per-conversation-urls-plan.md`), while the valid-UUID-but-dead case already keeps the rail alive because it resolves client-side through the escalation path. The fix is to route a GRANTED user's malformed id through that same client-side escalation (unavailable pane, live sidebar, the URL layer owning the address bar) WITHOUT weakening denial-shell inertness for the anonymous and gate-denied cases — the discriminating flag-on tests in `apps/chat/src/components/shell/app-shell.deeplink.test.tsx` pin that inertness and must be re-cut deliberately, never deleted. Alternative considered: redirect granted+malformed to `/` (simpler, but loses the "that link was broken" feedback).

## Verification

- Signed-in gate-granted + `/c/<malformed>` → unavailable pane WITH history rows in the rail; address bar behavior decided at implementation (stay or normalize — record the choice).
- Anonymous and gate-denied malformed cases unchanged: fully inert denial shell, no hydration fetch, no history writes.
- `pnpm --filter @forge/chat test && pnpm --filter @forge/chat lint && pnpm --filter @forge/chat typecheck`; re-run the feat-209 browser-matrix rows for the malformed-id and denial-shell cases under `next build` + `next start`.
