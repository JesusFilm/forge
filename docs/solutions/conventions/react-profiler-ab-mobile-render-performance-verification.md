---
title: "Measure a React Native render change with a React Profiler A/B, not with launch timing"
date: "2026-09-24"
category: conventions
module: apps/mobile
problem_type: convention
component: development_workflow
severity: medium
applies_when:
  - "A React Native change alters what a component renders, mounts, or updates, such as a loading placeholder swapped for real content"
  - "The load-performance rule asks for evidence, but the change has no DOM, so the browser methods (document.readyState, Lighthouse, paint timing) do not apply"
  - "A review finding says a mobile rendering change has no load-time evidence, only a visual smoke"
  - "The only measurement tried is dev-client cold-launch timing, which cannot resolve a millisecond-scale render cost"
  - "The A/B swaps a file under a live Metro, or the measured component is a FlashList row"
resolution_type: workflow_improvement
tags:
  - react-profiler
  - performance-verification
  - render-performance
  - expo-dev-client
  - ab-testing
  - flashlist
related_components:
  - apps/mobile
  - apps/tv
---

# Measure a React Native render change with a React Profiler A/B, not with launch timing

## Context

Root `CLAUDE.md` requires load-performance evidence for a frontend change that
alters rendering. The rule says: "visual browser smoke proves behavior, not load
impact". The rule's home,
`docs/solutions/conventions/frontend-change-page-load-performance-verification.md`,
gives only browser methods: `document.readyState`, Lighthouse, paint timing,
resource timing, and a `layout-shift` observer. `apps/mobile` has none of these.

PR #2418 (open and unmerged as of 2026-09-24) changes the loading state of the
Recommended for You shelf on Home. On `main`, the row reserves its height with an
empty `View` sized by `recommendationsShelfBodyHeight`. The PR replaces that
spacer with the row's real heading and two card-sized `Animated.View` skeletons
that pulse (`RecommendationsShelfSkeleton`,
`apps/mobile/src/components/home/RecommendationsShelf.tsx:140-176`). A
`ce-code-review` criteria finding (P2) said that the PR had no load-time
evidence. The question was: does the skeleton make Home render slower?

Two known mobile methods cannot answer that question:

- **Wall-clock cold-launch timing.** A dev-client cold launch has a noise floor
  of about ±6 s (Android emulator, 5 launches, 19.8-31.6 s to
  `home_feed_ready`), because the dev client fetches and evaluates the whole
  module graph (auto memory [claude]). A change of a few milliseconds is
  invisible under that noise.
- **The existing `apps/mobile` performance loops.** These are a bundle-bytes
  gate, a Datadog field scorecard, and an Android `gfxinfo` kit (auto memory
  [claude]). None of them measures the render cost of one component.

The method below measured the change with a spread of less than half a
millisecond on the shelf's own render. It also found two traps. Each trap
produced wrong data once, with no error.

## Guidance

Measure the changed component with React's `<Profiler>` in an A/B test. Arm A is
the new file. Arm B is the old file from `origin/main`. Run the same cold
launches for each arm and compare medians.

### 1. Prepare the two arms

1. Save the new file as arm A.
2. Extract the old file as arm B:

   ```bash
   git show origin/main:apps/mobile/src/components/home/RecommendationsShelf.tsx > arm-b.tsx
   ```

3. Save a byte copy of every file that you will patch, before you patch it.
4. Choose one marker string per arm. The marker must occur only in that arm's
   file, across the whole bundle. Check this with `git grep` before you rely on
   it.

In the session, the arm A marker was `recommendations-skeleton-card`, the value
of `RECOMMENDATIONS_SKELETON_CARD_TEST_ID` (`RecommendationsShelf.tsx:50-51`).
The arm B marker was `recommendationsShelfBodyHeight`, a function that exists
only on `origin/main`.

### 2. Add temporary Profiler instrumentation

Never commit this instrumentation. Wrap two elements:

- Wrap `<HomeScreen />` in `apps/mobile/app/(tabs)/index.tsx` with
  `<Profiler id="home" onRender={onRender}>`.
- Wrap `<RecommendationsShelf ... />` in
  `apps/mobile/src/components/home/HomeScreen.tsx` (the `renderItem` branch at
  lines 460-471) with `<Profiler id="recs-shelf" onRender={onRender}>`.

Log one plain line per callback:

```tsx
import { Profiler } from "react"

function onRender(
  id: string,
  phase: string,
  actual: number,
  _base: number,
  _start: number,
  commit: number,
) {
  console.log(
    `[perf] id=${id} phase=${phase} actual_ms=${actual.toFixed(2)} commit_ms=${commit.toFixed(1)}`,
  )
}
```

The lines appear in the worktree Metro log in this shape:

```text
 LOG  [perf] id=recs-shelf phase=nested-update actual_ms=... commit_ms=...
```

Apply the patch with a script that asserts that each search string occurs
exactly once. A patch then cannot land in the wrong place, and it cannot land
twice.

The sixth `onRender` argument is the commit start time. React sets it once per
commit in a module-level variable (`ReactFabric-dev.js:14420`) and passes that
same value to every `Profiler` in the commit (`ReactFabric-dev.js:11169-11176`).
So `commit_ms` joins a `recs-shelf` line to the `home` line of the same commit.
All `ReactFabric-*` paths are under
`apps/mobile/node_modules/react-native/Libraries/Renderer/implementations/`.

### 3. Hold the data that the component waits for

Make the state under test actually render. The skeleton shows only while the
recommendation slate is loading. An instant slate replaces it before anything
can measure it.

In the session, a fake-Admin proxy held the `UserRecommendations` response for
2.5 s. That delay stays under the client's 3 s delivery deadline
(`DELIVERY_DEADLINE_MS`, `apps/mobile/src/lib/recommendations/transport.ts:12`),
so the cards still land. For the proxy itself, see
`docs/solutions/developer-experience/mobile-write-path-smoke-via-fake-admin-proxy.md`.

### 4. Verify the served bundle before every arm

Copy the arm's file into place. Then poll the bundle that Metro serves until this
arm's marker is present AND the other arm's marker is absent. Launch only after
that.

```bash
# $1 = this arm's marker, $2 = the other arm's marker
wait_for_arm() {
  while :; do
    curl -s "http://127.0.0.1:$PORT/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true" > bundle.js
    if grep -q "$1" bundle.js && ! grep -q "$2" bundle.js; then return 0; fi
    sleep 2
  done
}

cp arm-b.tsx apps/mobile/src/components/home/RecommendationsShelf.tsx
wait_for_arm recommendationsShelfBodyHeight recommendations-skeleton-card
```

### 5. Run six cold launches per arm

For each launch, record the Metro log's line count, relaunch, wait, and keep only
the new `[perf]` lines:

```bash
before=$(wc -l < "$METRO_LOG")
xcrun simctl terminate "$UDID" org.jesusfilm.forgewatch
xcrun simctl openurl "$UDID" "forgemobile://expo-development-client/?url=http://127.0.0.1:$PORT"
sleep 30
tail -n +"$((before + 1))" "$METRO_LOG" | grep '\[perf\]' > "trial-$ARM-$N.log"
```

### 6. Parse the trials

For each trial, extract three values:

1. The shelf's FIRST recorded `recs-shelf` line, whatever its `phase`. Use its
   `actual_ms`.
2. The `home` line with the same `commit_ms`. Use its `actual_ms`.
3. The largest later `recs-shelf` update. This is the cards landing. The 2.5 s
   hold separates it from the first render, so "largest later update" is a
   usable heuristic here.

Report the median and the min-max range across the six trials for each value.

### 7. Restore every patched file

Restore each file from its byte copy with `cp`. Then run `cmp` on each file
against its copy. Do not use `git checkout`: it restores `HEAD` and discards any
uncommitted work in the same file.

### Trap 1: FlashList rows never report `phase=mount`

The shelf is a row of Home's `FlashList` (`HomeScreen.tsx:579`). Its first render
arrived as `phase=nested-update` in all six trials. A parser that keyed on
`phase=mount` found 0 of 6 trials.

The source explains the label. FlashList 2.0.2 measures its children in a
`useLayoutEffect` and calls `setRenderId` when a layout changes
(`@shopify/flash-list/src/recyclerview/RecyclerView.tsx:187-230`, under
`apps/mobile/node_modules/`). That schedules
a synchronous re-render from inside the commit. React then marks the next commit
as nested (`ReactFabric-dev.js:14719-14724` and `3684-3686`). In a nested commit,
`commitProfiler` replaces `"mount"` with `"nested-update"` for every `Profiler`
(`ReactFabric-dev.js:10873-10874`). The session did not trace which FlashList
pass first mounted the row; that part is inferred from the source.

The rule: key on the first recorded entry for the `id`, never on `phase`.

### Trap 2: the served bundle can still be the old arm right after the swap

The first arm B run copied arm B's file into place and fetched the bundle at
once. The arm B marker had 0 hits, and the arm A marker was still present. All
six "arm B" launches ran arm A's code, and the numbers looked normal.

The likely cause is that Metro had not yet processed the file change when the
script fetched the bundle. The session did not verify that cause. The poll in
step 4 is the fix. The rerun verified arm B first and produced different numbers.

The bundle check proves only what Metro serves. A dev-client relaunch can also
run a cached bundle
(`docs/solutions/developer-experience/expo-dev-client-cached-bundle-verification.md`).
A stronger check, not used in the session, makes each log line name its arm. Arm
B exports `recommendationsShelfBodyHeight` and arm A does not, so the
instrumentation in `HomeScreen.tsx` can derive the arm without a change to either
arm:

```tsx
import * as shelfModule from "./RecommendationsShelf"
const ARM = "recommendationsShelfBodyHeight" in shelfModule ? "B" : "A"
// then add arm=${ARM} to the [perf] line
```

### Companion check: layout parity from a video

The Profiler measures time, not position. To prove that the swap from skeleton
to cards moves nothing, use a screen recording:

1. Record the simulator:

   ```bash
   xcrun simctl io "$UDID" recordVideo --codec=h264 --force out.mp4
   ```

2. Map the proxy log's request and serve timestamps onto offsets in the video.
3. Extract one frame before the swap and one frame after it:

   ```bash
   ffmpeg -ss <t> -i out.mp4 -frames:v 1 f.png
   ```

4. Find a glyph in the section below the component. Compare the pixel rows that
   the glyph occupies in the two frames.

In the session, the glyph occupied rows 2523-2562 in both frames.

## Why This Matters

The rule in root `CLAUDE.md` applies to every frontend, but its documented
methods exist only in a browser. Without a mobile method, a request for load
evidence on an `apps/mobile` change has two bad answers. One is a screenshot,
which the rule itself rejects. The other is launch timing, whose ±6 s noise hides
any real render change.

`actualDuration` measures the time that React spends rendering the `Profiler`
subtree in JS for one commit. It does not include bundle fetch, module
evaluation, network time, or native work. That is why its spread stays small
while a cold launch varies by seconds. React reports effect time separately,
through the `onCommit` callback (`ReactFabric-dev.js:10884-10885`).

Both traps produce clean-looking numbers from wrong data. A parser keyed on
`mount` returns nothing, which is visible. An unverified arm returns a plausible
second data set, which is not visible: a PR that reports it compares two runs of
the same code.

The measured result for PR #2418 (dev build, 6 cold launches per arm, median
with min-max):

| Measurement                  | Skeleton (arm A)       | Old spacer (arm B)     |
| ---------------------------- | ---------------------- | ---------------------- |
| Shelf's first render         | 2.96 ms (2.84-3.21)    | 0.87 ms (0.84-1.05)    |
| Home commit that contains it | 16.67 ms (16.35-18.01) | 15.68 ms (15.31-17.08) |
| Shelf update when cards land | 8.76 ms (7.69-10.55)   | 13.96 ms (8.57-21.43)  |

The skeleton adds about 2 ms to the shelf's first render. The Home commit that
contains it grows by about 1 ms, and the two ranges overlap. The update when the
cards land is smaller with the skeleton. One possible reason: in arm A, the
heading `Text` is at the same position in both branches, so React updates it; in
arm B, the spacer branch has a `View` there, so React mounts a new heading when
the cards land. The session did not isolate that reason.

The spreads show the method's resolution. The shelf's first render varied by
0.37 ms (arm A) and 0.21 ms (arm B). The Home commit varied by about 1.7 ms. The
card-landing update varied by up to 12.9 ms in arm B. The largest of these is
more than two orders of magnitude below the ±6 s launch floor.

Three limits apply. Keep them in any PR evidence:

- **Dev-build numbers are inflated.** Compare arms, not absolute values. A
  release build cannot run this method: the production renderer has no
  `onRender` call at all (`ReactFabric-prod.js` contains zero `onRender`
  references, and `ReactFabric-profiling.js` contains three). A profiling build
  could measure release-like values. The session did not try it.
- **The Profiler does not see UI-thread work.** Native mount, layout, and drawing
  are outside `actualDuration`.
- **A native-driver animation's UI-thread cost stays unmeasured.** The pulse uses
  the native driver (`apps/mobile/src/hooks/useShimmerOpacity.ts`).
  `Animated.loop` hands a native-driver loop to native once
  (`Libraries/Animated/AnimatedImplementation.js:488-489`, under
  `apps/mobile/node_modules/react-native/`), and `TimingAnimation` schedules its
  JS `requestAnimationFrame` only when the native driver is off
  (`Libraries/Animated/animations/TimingAnimation.js:123-134`). So the pulse does
  no per-frame JS work, but its UI-thread cost was not measured. The Android
  `gfxinfo` kit is a possible method for that part.

## When to Apply

- A React Native change alters what a component renders in a screen's first
  commit, or in a data-driven update. Examples are a loading state, a skeleton,
  a placeholder, or a new wrapper component.
- A reviewer asks for load-time evidence on an `apps/mobile` or `apps/tv` change.
- The expected effect is milliseconds, far below dev-client launch noise.
- The component is a `FlashList` row. Trap 1 then applies.
- The A/B swaps a file under a live Metro. Trap 2 then applies.

Use a different method for a different risk:

- For per-tick or effect cost, a temporary `performance.now()` console patch that
  you read from the worktree Metro log is sufficient. Warm deep-link
  time-to-first-frame has about ±0.5 s noise (auto memory [claude]).
- For bundle size, native modules, or network requests, use the bundle-bytes
  gate, Datadog field data, or a request log. A Profiler cannot see these.

## Examples

Insufficient by itself as PR evidence:

```text
Simulator screenshot shows the skeleton, then the cards.
```

Insufficient, because launch noise hides the effect:

```text
Cold launch to home_feed_ready: 24.1 s with the skeleton, 23.7 s without.
```

Sufficient for a render change like PR #2418:

```text
React Profiler A/B, dev build, iPhone 17 Pro simulator (iOS 26.5), 6 cold launches per arm.
Both arms verified in the served bundle (arm marker present, other marker absent) before launch.
Slate held 2.5 s by the fake-Admin proxy so the placeholder renders.
Shelf first render: 2.96 ms (A) vs 0.87 ms (B). Home commit: 16.67 ms vs 15.68 ms.
Card landing: 8.76 ms vs 13.96 ms. Medians; ranges in the PR body.
Layout parity: next-section glyph at rows 2523-2562 before and after the swap.
Not measured: UI-thread cost of the native-driver pulse.
```

A parser that silently drops every trial:

```python
# Wrong: a FlashList row's first render is "nested-update", never "mount".
first = next(line for line in shelf_lines if line.phase == "mount")
```

The fix:

```python
# Right: the first recorded entry for the id, whatever its phase.
first = shelf_lines[0]
```

## Related

- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`:
  the rule's home, with browser methods only.
- `docs/solutions/developer-experience/expo-dev-client-cached-bundle-verification.md`:
  the device side of Trap 2, where a relaunch can run a cached bundle.
- `docs/solutions/developer-experience/mobile-dev-build-verification-false-signals.md`:
  other dev-build signals that differ from what they appear to prove.
- `docs/solutions/developer-experience/mobile-write-path-smoke-via-fake-admin-proxy.md`:
  the proxy that held the slate in step 3.
- `docs/solutions/conventions/verify-animated-media-motion-rich-probe-window.md`:
  frame extraction from `simctl io recordVideo` for motion checks.
