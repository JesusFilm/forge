---
title: "Native TV search actions need current input and snapshot identities"
date: "2026-10-29"
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: native_search
severity: medium
tags: [tv, tvos, search, retry, focus, history]
---

## Problem and evidence

The native Apple search surface accepted only content results. An injected live
`WatchSearch` GraphQL failure displayed No results found with no retry, while the
custom Android surface already distinguished errors. The same native result
surface can display action cards for persisted recents, existing topics and
retry without replacing native text input or Siri dictation.

## State and identity rules

- Keep search, retry and content navigation as distinct actions. Resolve only
  actions currently displayed; never interpret arbitrary event IDs as queries.
- Scope recent action IDs to a history snapshot. Index-only IDs can change
  meaning after hydration or a completed search reorders history. Keep typed
  text out of bridge IDs and automatic interaction names.
- Retry the current field with the latest `submit` callback. The prior-query
  `retry` callback can submit failed A after the viewer edits to B during
  debounce; the shared custom/Android Retry binding has the same risk. `runQuery(B)` is also unsuitable when B is already the field value:
  its one-shot debounce skip flag can remain armed and skip the next C edit.
  A real-hook regression covers A failure, B submit once and subsequent C search.
- `searchText` is an external-action override. Do not echo transformed native
  input into it on every `onSearch`; the package warns this can loop or disrupt
  typing. Releasing the override with undefined does not clear the native field.

## Rendering and privacy

`expo-tvos-search` renders nonempty result arrays even for an empty query.
Existing props provide compact action tiles: a full-height opaque title overlay
covers the generic photo placeholder, with a white focused fill and dark title.
Actual content cards keep their portrait dimensions and external title/type.
No initial artwork requests are needed for these actions.

The installed native implementation gates external subtitles independently of
`showTitle`, despite older package documentation saying otherwise. Verify the
installed Swift implementation when combining overlay titles with context text.

Datadog React interaction tracking reads fiber props and parent action names;
separate UIKit native interaction tracking is not enabled by this app. Keep a
generic `dd-action-name` on the native search view and never add query-bearing
manual actions. Do not assume a React parent property automatically names every
SwiftUI descendant if native tracking is enabled later.

## Verification

Use actual native selection and count `WatchSearch` requests: one topic selection
should issue one request after the native field update. Exercise an injected
error, delayed retry and Back while waiting; retain screenshots and typed query.
An inactive screen staying hidden after a response is visibility evidence, not
proof that the HTTP request was aborted. Keep simulator microphone and physical
remote behavior limitations explicit.

## Seeded details are presentation, not readiness

A Home seed supplies a poster and title, not playable metadata. Derive current
video readiness on both platforms. Keep Apple seed art during loading but make
Play inert until a valid active stream exists. On terminal failure, expose Retry
even when a seed exists; a static poster can preserve context without starting a
backdrop decoder. A failed seeded query must never leave a ready-looking Play
action that cannot act. Keep meaningful state/hook tests and live fault/recovery
evidence instead of source-snippet assertions that duplicate an implementation.

## Android exit controls must remain actionable

A handler can be correctly wired while the interaction still appears broken.
The native player consumed hidden-chrome Back as a reveal-only key, and the
playing-controls timer hid the on-screen Back even while it held focus. The next
Select then revealed the timebar rather than activating the vanished exit.

Handle remote Back separately from keys that reveal controls: consume both halves
and dismiss once on key-up. Preserve the earlier scrub-cancellation branch and
its paired-key latch. Keep focused Back out of both hide scheduling and hide
execution; checking only scheduling misses a timer already queued before focus
moves. Moving focus to another control should resume normal scheduling.

Verify the difficult state, not only paused controls: focus Back, resume playback,
wait longer than the hide timeout, then select. Separately press Back once with
all controls hidden. Preserve the resulting detail destination and saved progress.
These paths were reproduced and verified in feat-903 on the packaged emulator.

## Snapshot restores can invalidate network evidence

An emulator snapshot also restores an old guest clock. During the Back diagnosis,
an 80-minute drift caused OCSP validation to reject a certificate response as
out-of-date. Synchronizing the guest clock to the host restored playback without
changing the APK or bypassing certificate checks. Record both clocks after a
restore before attributing TLS or media failures to an application change.
