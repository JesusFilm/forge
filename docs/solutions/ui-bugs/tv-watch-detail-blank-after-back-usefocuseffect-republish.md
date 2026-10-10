---
title: "TV watch detail goes blank after Back from an Up Next episode — re-publish the shared WatchSession on focus, not on a memoized data effect"
date: "2026-06-25"
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: rails_view
severity: high
symptoms:
  - "Below-hero content (Up Next rail, About, Related Questions) vanishes after opening an Up Next episode then pressing Back"
  - "Share / Download / Play action pills (DetailsActionRow) disappear on the returned-to screen"
  - "Only the seed-painted hero + Play/Language/Subtitles remain; video === null so every session-gated element is gone"
root_cause: async_timing
resolution_type: code_fix
related_components:
  - WatchSessionProvider
  - DetailsActionRow
tags:
  - tv
  - react-native-tvos
  - expo-router
  - usefocuseffect
  - navigation
  - shared-state
  - react-context
---

# TV watch detail goes blank after Back from an Up Next episode — re-publish the shared WatchSession on focus, not on a memoized data effect

> `component: rails_view` is the nearest value in the (Rails-oriented) schema enum; the real component is the **React Native tvOS watch-detail screen** (`apps/tv/app/watch/[slug].tsx`). The accurate tech lives in `module` / `tags` / `related_components`.

## Problem

On the tvOS watch-detail screen, all below-hero content (Up Next, About, Related Questions) **and** the Share/Download/Play action pills disappeared after navigating into a sibling episode from the "Up Next" rail and pressing Back. The screen reads its display state from a **shared `useWatchSession()` singleton** that the popped child had cleared, and the re-focused parent never re-published its own video.

## Symptoms

- Open episode A → open episode B from A's "Up Next" rail (`router.push`) → press Back to A.
- A returns showing only the seed-painted hero plus Play/Language/Subtitles.
- Share and Download pills are gone; the Up Next rail, About, and Related Questions sections are all gone.
- The signature splits cleanly along session-gated consumers: Share/Download missing = `buildShareUrl(video)` returned `null` (so `canShare`/`canDownload` are false); Up Next + About missing = `hasVideo === false`.

## What Didn't Work

Decoupling the screen's own rendering from the session — i.e. rendering the below-hero sections from the screen's local `normalized` object instead of from `useWatchSession().video`. This patches the sections the _screen_ renders directly, but `DetailsActionRow` **also** reads the session for Share/Download/Play, so it would still see `video === null` and the pills would stay gone. Re-publishing the session on focus is the cohesive fix: a single state write restores **all** session consumers (the screen's sections AND the action row) at once, instead of rewiring each consumer to a different source.

## Solution

Change the "publish video into the session" effect from a mount/data effect to a **focus effect**, so the focused screen re-asserts ownership of the shared session on every focus gain.

Before (`apps/tv/app/watch/[slug].tsx`):

```ts
useEffect(() => {
  if (normalized) setVideo(normalized)
}, [normalized, setVideo])
```

After:

```ts
useFocusEffect(
  useCallback(() => {
    if (normalized) setVideo(normalized)
  }, [normalized, setVideo]),
)
```

`useFocusEffect` (expo-router / react-navigation) re-runs on every focus gain — initial mount, partial → full Apollo enrichment (the `normalized` dependency changing), AND re-focus after a stacked child pops. The intentional unmount-clear on the child's teardown (`setVideo(null)`, which prevents a stale dub leaking into a later experience-card play) is kept as-is. (commit `13b0d635`)

## Why This Works

Root cause: there is **one** `WatchSessionProvider` instance shared across all stacked watch screens, so `video` is a singleton. The old publish effect was keyed on `[normalized, setVideo]`; on Back, the parent's `normalized` is memoized and unchanged, so the effect does not re-run and the parent never re-publishes after the child's teardown set `video = null`. Every session-gated branch (`canShare = buildShareUrl(video) != null`, `hasVideo`, etc.) then reads null.

The focus re-publish reconciles with the unmount-clear because of react-navigation's **ordering**: when the child pops, its unmount cleanup (`setVideo(null)`) fires **first**, then the parent receives its focus event. So the parent's `useFocusEffect` runs _after_ the clear and writes its own `normalized` back into the session — the clear and the re-publish compose correctly rather than racing.

## Prevention

- **General rule:** any screen that derives display state from a **shared context/session singleton** AND can have a sibling of the **same route** stacked on top of it (push-to-self navigation) must re-assert its state on **focus**, not just on a memoized-data change. A mount-only or data-dependency `useEffect` silently fails to re-fire when the parent returns with unchanged memoized inputs. Reach for `useFocusEffect`, not `useEffect`, for "this screen owns the shared singleton while focused."
- **Residual to watch (manual sim check):** re-publishing on focus drives `WatchSessionProvider`'s `[video?.documentId]` reset effect, and `documentId` passes through `null` on the child round-trip — so a non-default dub/language chosen on the parent can reset to its default after returning from a child episode. If per-screen dub/language persistence is wanted, it must survive the documentId-null transition independently of the focus re-publish.
- **Test gap:** this regression is invisible to unit tests and the full jest suite (all green through the bug). It only reproduces under real stacked-navigation focus/unmount ordering. Cover push-to-self → Back with a navigation/integration test, or a documented simulator smoke: `A → Up Next sibling → Back → assert all pills + below-hero sections return`. The failure mode lives in react-navigation lifecycle ordering, not in any single component's logic.

## Related Issues

- `docs/solutions/mobile/experience-selection-provider-library-tab-pattern-2026-04-08.md` — sibling pattern: a shared React context written on a lifecycle event (uses the `createContext(null)` throw-guard convention). Contrast: that guards a **mount-time** async write; this one re-publishes on **focus**.
- `docs/solutions/mobile/sdui-experience-provider-block-index-parent-child-loss.md` — "same symptom, different cause": below-hero/child content loss there is a block-index keying bug, not a session re-publish. Disambiguate before assuming this fix applies.
- `docs/solutions/architecture-patterns/admin-owned-watch-route-manifest-20260530.md` — context for the watch-route surface this bug lives on.
- **Not this — different "focus":** `docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md` and `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md` cover **D-pad focus** restoration (`hasTVPreferredFocus` / `requestTVFocus`). `useFocusEffect` here restores **session ownership**, not D-pad focus — don't conflate the two.
- **Sibling learning from the same work:** the Home screen's back-navigation **D-pad** focus restoration (`createFocusMemory` + `requestTVFocus` on `useFocusEffect` re-entry) is the focus-engine half of "returning from a child screen"; this doc is the session-state half. They were fixed together in PR #1367.
