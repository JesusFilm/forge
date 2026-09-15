---
id: "feat-402"
title: "Denial pane CTA: client-side New on granted shells, reload only on real denials"
owner: "jian wei"
priority: "P3"
status: "complete"
start_date: "2026-09-01"
duration: 1
depends_on:
  - "feat-399"
blocks: []
tags:
  - "web"
---

## Resolution

**Shipped:** 2026-08-28 via [PR #2088](https://github.com/JesusFilm/forge/pull/2088) (`feat(chat): denial pane CTA is a client-side New on granted shells (feat-402)`).

**What landed.** Build, not drop: the reach argument held (mobile has no visible rail escape), and the change is one presence-branch. `DenialScreen` gained the optional `onStartNew`, threaded into `UnavailableScreen` only; `AppShell` passes it gated on the existing `grantedShell` belt exactly as the brief prescribed. The accepted `<button>` trade-off (no open-in-new-tab) was kept as specified — no `preventDefault` anchor variant. All four Verification rows ran, including the browser network-panel pair (no document request on the granted path; full load on the denial path) and the scoped sabotage falsification (exactly the two unavailable-arm anchor guards went red). Both granted arms got click-and-release coverage, not just the element assertion.

**Compound docs.** None — the change applied already-documented patterns (the two-axis-gate belt, synthetic-fixture labeling).

**Residual risk / follow-ups.** One prose correction to this ticket's Constraints, found in review: revocation surfaces as the KTD8 401/403 revert on the HISTORY paths, but on the SEND path of a never-persisted conversation `gate_denied` rebuilds the inline stub (feat-281 Ruling 3) rather than the access-changed copy — still fail-closed at the API, and no new capability (the rail's New was already a client-side button on these shells). Also noted, accepted: Tailwind v4 preflight gives the button `cursor: default` while the anchor keeps the pointer, matching the existing `NewConversationButton` precedent.

## Problem

`UnavailableScreen`'s "Start new conversation" is always a real anchor
(`<a href="/">`), a full cross-document navigation. That is CORRECT on a
server-decided denial shell and must stay: feat-209 KTD6 makes leaving a denial
a deliberate reload so identity and the seeker gate re-resolve server-side, and
`apps/chat/eslint.config.mjs` disables `@next/next/no-html-link-for-pages` for
that file specifically to allow it. On a denial shell the client's "who am I /
am I still granted" answer is exactly what cannot be trusted, so the reload is
the security property, not a style choice.

But the same pane now renders on two GRANTED shells, where none of that
reasoning applies:

1. the feat-209 replay escalation (`escalatedUnavailable` — a deep-linked
   thread whose replay resolves `not_available`), and
2. feat-399's `deepLinkUnresolvable` (a gate-granted visitor whose deep-link id
   was malformed).

On those the visitor is fully granted, the rail is hydrated, and the URL layer
is live — so the reload throws away a hydrated sidebar and re-fetches the
history page for no benefit.

(An earlier draft also claimed the anchor stacks a second `/` history entry.
That was asserted, never measured, and is likely inverted — the URL layer has
already `replaceState`d the address to `/`, and a same-URL auto-handled
navigation converts to replace. It is dropped rather than shipped unverified;
the surviving cost is the discarded hydrated sidebar and the re-fetched
history page.)

The rail's own New control already draws exactly this distinction —
`linkToHome={deniedShell}` (`sidebar.tsx`) renders an anchor on a denial shell
and a real session-mutating button on a granted one. The PANE's CTA is the one
affordance that never discriminates. Reported as an advisory finding during the
feat-399 Tier-2 review and deliberately deferred, because the fix changes a
contract shared with the genuine denial shells.

**Reach, and the escape that already works — read before building this.** On
desktop the rail's own New control is ALREADY a client-side button on both
granted causes (`linkToHome={deniedShell}` is false there), and feat-399
already releases the pane on any rail row, New, or history traverse — so a
desktop user has a working no-reload escape today. The strongest remaining case
is MOBILE, where that rail sits behind the off-canvas drawer and the pane's CTA
is the only visible escape. Reach is narrow either way: the pane needs a
GATE-GRANTED visitor opening a broken or dead deep link, and the grant is still
the dogfood email allowlist while feat-236 is not-started. Decide build-or-drop
against that, not against the ticket's existence; if the answer is drop, record
it as a comment on `UnavailableScreen` naming the known reload cost.

## Entry Points — Read These First

1. `apps/chat/src/components/chat/denial-screens.tsx` — `DenialScreen` /
   `UnavailableScreen`; the `<a href="/">` CTA and the `ACTION_CLASS` styling
   both branches must keep sharing.
2. `apps/chat/src/components/shell/app-shell.tsx` — `paneDenial` is the union of
   the three causes (`deniedScreen`, `escalatedUnavailable`,
   `unresolvableDeepLink`). Only the last two are granted-shell causes. The
   existing `newConversationFocused` handler is what a button would call.
3. `apps/chat/src/components/chat/chat.tsx` — `ReplayNotAvailable` already
   renders the SAME copy and label as a `<button onClick={onStartNew}>`, wired
   from `app-shell.tsx:317` to the very handler this ticket threads. It is the
   closest precedent and grounds the prop name; note its class string
   duplicates the module-private `ACTION_CLASS` in `denial-screens.tsx`.
4. `apps/chat/src/components/shell/sidebar-new-conversation.tsx` — the
   established anchor-vs-button pattern (`linkToHome`) to mirror, including how
   it keeps one `className` across both element types.
5. `apps/chat/eslint.config.mjs` — the `no-html-link-for-pages` carve-out (it
   lists this file AND `sidebar-new-conversation.tsx`); it must survive, since
   the anchor branch stays.

## Grep These

- `linkToHome` — the precedent, in `sidebar.tsx` and
  `sidebar-new-conversation.tsx`.
- `escalatedUnavailable`, `unresolvableDeepLink`, `paneDenial` in
  `app-shell.tsx` — the three causes and where the granted ones are already
  distinguished.
- `Start new conversation` across `apps/chat/src` — every assertion on the CTA;
  the denial-shell suites expect an ANCHOR with `href="/"` and must keep
  expecting exactly that.
- `data-denial` in the shell test suites — how each pane cause is currently
  identified in tests.

## What To Build

Give `DenialScreen` an optional callback and branch on its presence, mirroring
`NewConversationButton`:

```ts
export function DenialScreen({
  screen,
  returnTo,
  onStartNew,
}: {
  screen: DeniedScreen
  returnTo?: string
  /** feat-402: present ONLY on a granted shell (the KTD5 escalation and
   * feat-399's unresolvable deep link). Absent => the KTD6 reload anchor. */
  onStartNew?: () => void
})
```

Render a `<button>` calling `onStartNew` when it is supplied, the existing
`<a href="/">` otherwise. Same label, same `ACTION_CLASS`, same position.

In `AppShell`, pass it ONLY on a granted shell — reuse the belt the file
already defines, never `paneDenial` alone:

```ts
onStartNew={grantedShell ? newConversationFocused : undefined}
```

`grantedShell` (`app-shell.tsx:77`, `seekerEnabled && !denialShell`) is NOT a
new boolean — it already exists three lines above the pane code and already
feeds `useConversations` and the URL hook. It implies `deniedScreen ===
undefined` AND adds the gate conjunct.

Do NOT use `deniedScreen === undefined` instead. It is producer-safe today, but
only by inheritance: of the two granted causes, `unresolvableDeepLink` states
`grantedShell` in its own expression (`:249`) while `escalatedUnavailable`
(`:241-246`) carries NO grant conjunct at all — it is granted-only because
`replay` is set exclusively under `useConversations(grantedShell, …)`, an
upstream producer fact. AppShell itself accepts `seekerEnabled=false` with no
`deniedScreen` and an `initialConversationId`, and `maybeStartReplay`
(`conversation-session.ts:646`) is not gate-gated, so that pane is
component-reachable with a session-mutating button. Using `grantedShell` makes
the granted-only property structural at the consumer — the belt-and-producer
pattern the repo's two-axis-gate law prescribes.

## Constraints

- After this change the two granted panes' CTA no longer re-resolves identity or
  the seeker gate. That is acceptable ONLY because `resolveSeekerGate` re-runs
  server-side on every `/api/seeker` and `/api/history/*` call, so a revoked
  grant surfaces as the KTD8 401/403 revert on the next request — NEVER because
  a granted client's own "am I still granted" answer is trusted. Do not
  generalize this into removing a server round-trip that is not redundant.
- NEVER pass `onStartNew` on a server-decided denial shell. The reload is the
  KTD6 security property — a client-side transition there would carry a stale
  identity/gate answer forward. This is the whole reason the ticket is scoped
  to the two granted causes.
- Do NOT introduce `next/link` in this file. The anchor branch stays a plain
  `<a>`, and the eslint carve-out stays.
- Do NOT change the copy, the styling, or the pane layout — `sign_in`'s two
  anchors (`Sign in` + `Start new conversation`) are untouched by this ticket.
- Do NOT alter `newConversationFocused`'s feat-270 behavior (reuse + composer
  focus). Composer focus needs no extra work here: `composer.tsx` focuses itself
  on mount when not pending, which is why the rail's New already lands focused
  from this pane (browser-verified 2026-08-20).
- Accepted trade-off, do not re-litigate silently: a `<button>` drops the
  anchor's middle-click / Cmd-click / context-menu "open in new tab" and
  Space-bar activation, and the two branches look identical so the loss is
  invisible. This matches the rail's existing `linkToHome` control. If that
  matters, the alternative is an anchor with `onClick` + `preventDefault()` on a
  plain left-click — but pick one deliberately.

## Verification

- Granted + malformed deep link (`/c/<not-a-uuid>`): the pane's CTA is a
  `<button>` with no `href` — assert the ELEMENT, which is what discriminates
  under jsdom (an anchor never navigates there, so a `window` sentinel survives
  either way and proves nothing). Clicking it clears the pane and the rail's
  hydrated rows are still present afterward. The sentinel and the no-document-
  request check belong to the browser row below, not to the unit test.
- Granted deep link whose replay is `not_available`: same button behavior.
- Server-decided denial `deniedScreen="unavailable"`: CTA is still an
  `<a href="/">` — falsify by passing `onStartNew` unconditionally and confirm
  it goes red. This is the ONLY arm the sabotage can turn red, so scope the
  falsification to it.
- `deniedScreen="sign_in"`: do NOT write a falsification test here — the
  constraint keeps `SignInScreen`'s anchors untouched, so `onStartNew` never
  reaches that branch and an unconditional pass leaves it green. Assert
  structurally instead: `DenialScreen` never threads `onStartNew` into
  `SignInScreen`, so that CTA stays an anchor by construction rather than by a
  test no input can falsify.
- Add the discriminating fixture for the belt itself: a pane rendered with
  `seekerEnabled=false` and no `deniedScreen` must keep the anchor. Label it
  SYNTHETIC in place, naming `deepLinkShell` as the producer that keeps that
  pair unreachable through the route — it pins the consumer belt, which is the
  whole reason for choosing `grantedShell` over `deniedScreen === undefined`.
- Anonymous and gate-denied deep links: unchanged, still fully inert.
- `pnpm --filter @forge/chat test && pnpm --filter @forge/chat lint && pnpm --filter @forge/chat typecheck`
- Browser: confirm the network panel shows no document request on the granted
  path, and a full document load on the denial path.
