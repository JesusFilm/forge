---
id: "feat-269"
title: "Chat sources presentation: heading, clamped cards, collapse"
owner: "jian wei"
priority: "P1"
status: "complete"
start_date: "2026-07-20"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
---

## Resolution

**Shipped:** 2026-07-20 via [PR #1619](https://github.com/JesusFilm/forge/pull/1619) (`feat(chat): collapse sources into a Sources · N disclosure (feat-269)`).

**What landed.** Native `<details>`/`<summary>` for both the section and per-source snippet disclosures (chosen over button+state — keeps sources-list hook-free per chat's client-context convention), with a select-to-copy guard so copying an expanded passage doesn't collapse it. Dedupe went slightly beyond the brief: unparseable/junk urls ("N/A", "") are exempt so distinct unlinked citations never collapse into one. The finalize scroll aligns the answer's top to the scrollport via `useLayoutEffect` (pre-paint, no flash); streaming growth and conversation switches still bottom-pin. Verified with live-gate mint plus synthetic-SSE fixtures in headless Chromium at 1440px/390px, including the pane's pointer-events and scroll-padding traps.

**Compound docs.** `docs/solutions/design-patterns/native-details-summary-disclosure-implementation-traps.md`, `docs/solutions/best-practices/synthetic-sse-fetch-patch-browser-verification.md`, and a Boundary amendment to `docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md`.

**Residual risk / follow-ups.** Mid-stream per-token bottom-pin still yanks a reader interacting with a previous turn's sources while a new reply streams — validated as newly-relevant but deferred as a scroll-stickiness design call, suggested for [feat-270](feat-270-chat-ui-cleanup-batch.md)'s batch. Screen readers announce the whole snippet as the disclosure's name (inherent to snippet-in-summary; accepted at current scale).

## Problem

From the 2026-07-15 UI audit: after each Seeker reply, every cited source
renders its FULL passage inline — hundreds of words per source, four-plus
sources per turn, repeated after every turn in the conversation. There is no
"Sources" heading, so the only boundary between the answer and the citation
dump is the tiny `Grounded` / `SEEKER` labels; on finalize the dump lands
below the answer and (with the audit's auto-scroll behavior) pushes the
answer's start off-screen. The transcript becomes a wall of citation text that
dwarfs the actual replies.

`sources-list.tsx` renders `source.snippet` unclamped by design today — the
grounding signal is the point of the dogfood — but the current presentation
buries the answer it grounds.

## Entry Points — Read These First

1. `apps/chat/src/components/chat/sources-list.tsx` — the whole surface: the
   `snippet` span (line 53-55 today) is the unclamped passage; the https-only
   link discipline here must survive the redesign untouched.
2. `apps/chat/src/components/chat/message-list.tsx` — where `SourcesList` and
   the `Grounded`/`SEEKER` badges compose under an assistant turn; the
   "Sources" heading lands here or at the top of `SourcesList`.
3. `apps/chat/src/components/chat/chat.tsx` — the `logRef` bottom-pin effect:
   check how a collapsed→expanded source section interacts with the
   keep-latest-in-view scroll behavior.

## Grep These

- `data-sources` — the list/empty test hooks; keep them working.
- `No sources cited` — the empty state must stay first-class.
- `mt-0.5 block text-ash` — the current unclamped snippet span.

## What To Build

- A `Sources` heading (visible text, not just badges) above the list, with the
  source COUNT (e.g. "Sources · 4").
- Each source becomes a compact entry: title link (unchanged discipline) +
  snippet clamped to 2-3 lines (`line-clamp-*`), expandable per-source via a
  native `<details>`/`<summary>` or a button — sighted users get a scannable
  card, keyboard/SR users get a real disclosure.
- Default the whole section COLLAPSED (or clamped) — the answer is primary;
  grounding is one interaction away. Pick collapsed-by-default only if the
  empty "No sources cited" state stays immediately visible without
  interaction.
- Deduplicate identical sources within one turn (same URL cited repeatedly —
  the audit reply cited the same Cru article three times).
- Verify the finalize-scroll behavior: after a reply lands, the top of the
  ANSWER (not the sources block) should be what the user is reading.

## Constraints

- The security seam is not negotiable: `isHttpsUrl` gate, `rel="noopener
noreferrer"`, snippet text never HTML — regardless of markdown work in
  feat-268 (source snippets stay PLAIN text; they are corpus-verbatim, not
  agent output).
- Replayed turns render no sources (R21) — unchanged.
- No new icon dependency for the disclosure affordance; the repo's inline-SVG
  pattern (`shell/icons.tsx`) covers a chevron.

## Verification

```bash
pnpm --filter @forge/chat typecheck && pnpm --filter @forge/chat lint && pnpm --filter @forge/chat test
```

- Component tests: heading + count render; clamp class present; expand
  interaction reveals the full snippet; duplicate-URL sources dedupe; empty
  state unchanged; non-https URL still renders as text.
- Browser: a live multi-source Seeker reply reads answer-first; sources are
  one glance/one click; a turn's sources no longer dominate the scrollback.
