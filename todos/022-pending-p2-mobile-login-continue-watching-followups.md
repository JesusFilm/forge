---
status: pending
priority: p2
issue_id: "022"
title: Mobile login + continue-watching — deferred follow-ups from PR #1876
labels:
  - mobile
  - auth
  - watch-progress
  - testing
created_at: 2026-08-10
---

# Problem

Four items were consciously deferred while landing PR #1876 (mobile login and
cross-device continue watching). None blocks that PR; each has a natural
trigger recorded below so it is picked up at the right moment rather than
rediscovered.

# Follow-ups

## 1. Behavioural autostart tests

`apps/mobile/src/components/watch/__tests__/videoPlayerAutostart.test.ts`
asserts against the raw source text of `VideoPlayer.tsx` (regex + string
index), not a driven player. It pins structure, so a refactor that preserves
the strings while reordering runtime behaviour still passes — and the bugs
that review found in this area (a latch race, a seek applied against the
previous source) were exactly runtime-ordering bugs.

The `apply` path is pure enough to lift into a standalone function and test
with a mocked player (`currentTime` setter, `play()` / `addListener` spies).
KTD11 blocks rendering JSX, not testing extracted plain functions.

**Superseded 2026-08-15 (`apps/mobile` only).** KTD11 no longer blocks
rendering JSX. `apps/mobile` has a component-render harness, and it needed no
new dependency — `@testing-library/react-native` is still absent. See
`apps/mobile/CLAUDE.md`, section "Component render tests". So this follow-up
now has two routes: extract the `apply` path as described above, or drive
`VideoPlayer` through a render suite with the shared `expo-video` stub. The
paragraph above stays as the record of what was true when it was written.

**Trigger:** the next time autostart or auto-resume changes.

## 2. `prompt=select_account` / ephemeral web session on re-sign-in

Switching accounts currently depends on Apple's and the hosted page's own
session memory. A signed-out user tapping sign-in may be silently re-admitted
as the previous account without being offered a choice.

**Trigger:** the first report of "it signed me back in as the wrong account",
or any multi-account testing pass.

## 3. Connectivity-listener queue flush

The offline progress queue drains on foreground only. A device that regains
connectivity while the app is already foregrounded holds queued writes until
the next background/foreground cycle.

**Trigger:** when `expo-network` gains a live consumer, or if queued-write
latency shows up in telemetry.

## 4. Post-deletion JWT tombstone

Account deletion revokes the session, but an already-minted user JWT lives to
its 15-minute expiry, so a deleted account can still write progress inside
that window. A tombstone keyed on the deletion reason discriminator closes it.

Named in PR #1876's Known gaps.

**Trigger:** before deletion is exercised at any real volume, or if an audit
asks what a deleted user can still do.

# Notes

Items 1 and 4 are the two with a correctness edge; 2 and 3 are UX and latency.
