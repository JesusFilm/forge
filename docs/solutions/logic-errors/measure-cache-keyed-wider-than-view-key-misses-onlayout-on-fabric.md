---
title: "A measure cache keyed wider than its measuring view's React key never gets a height on Android Fabric"
date: "2026-09-28"
category: "logic-errors"
module: "apps/mobile"
problem_type: "logic_error"
component: "frontend_stimulus"
severity: "high"
symptoms:
  - "On an Android release build, a deep link that pushes the Bible reader to the same reference as the saved position leaves the verse hidden with no end"
  - "The reader's top bar and footer show normally; only the verse stays hidden, at the fit's opacity 0"
  - "A verse move shows the verse again, and a push to a different book always works"
  - "The defect needs Home focused with the Bible tab already mounted; iOS never shows it"
  - "The jest suite stays green, because the old harness called every measuring copy's onLayout by hand"
root_cause: "logic_error"
resolution_type: "code_fix"
framework_version: "react-native 0.86.3 / expo ~57.0.24 (Fabric new architecture), react 19.2.3"
related_components:
  - "apps/mobile/src/components/bible/VerseView.tsx"
  - "apps/mobile/src/test-utils/fabricLayout.ts"
  - "apps/mobile/app/__tests__/readerHostRoutes.test.tsx"
  - "apps/mobile/src/components/bible/__tests__/ReaderMovement.test.tsx"
tags:
  - "mobile"
  - "react-native"
  - "android"
  - "rn-fabric"
  - "onlayout"
  - "measure-cache"
  - "react-key"
  - "bible-reader"
---

# A measure cache keyed wider than its measuring view's React key never gets a height on Android Fabric

## Problem

A hidden measuring view filled a height cache from its `onLayout`. The cache
key held more than the view's React key, so on Android Fabric a key change
with an unchanged native frame sent no layout event, and the verse stayed
hidden. Keying the measuring container on the whole cache key fixed it.

PR #2427 (open, not merged as of 2026-09-28) adds a native one-verse Bible
reader to `apps/mobile`. The roadmap ticket is `feat-553` (first numbered
`feat-551`). The reader hides a verse until a fit step measures it. Hidden
measuring copies of the verse render at candidate text sizes. The `onLayout`
handler of each copy saves the copy's height in a state map under a composite
string key, `measureKey`. The fit then picks the largest size that fits.

The code is in `apps/mobile/src/components/bible/VerseView.tsx`:

- `measureKey` joins nine parts: the verse range label, the verse text,
  `columnWidth`, the font family, the line spacing, the verse-number setting,
  the chosen size, the OS font scale, and the text direction
  (`VerseView.tsx:234-245`).
- `record` saves a height under the `measureKey` of the render that made the
  handler (`VerseView.tsx:307-311`).
- `planPlacedFit` returns `status: "measure"` while a height for the current
  key is missing (`VerseView.tsx:248-255`,
  `apps/mobile/src/lib/bible/fit/fitVerse.ts:73-89`).
- While the plan is `"measure"`, the current key has no fit, so the verse
  column has `opacity: 0` (`VerseView.tsx:276-277`, `:382`, `:415`).

Before the fix, the React `key` of each measuring copy was only the text size
(`key={size}`), and the measuring container had no key. Thus a change to any
other part of `measureKey` re-rendered the same native views. When that
re-render did not change a view's native frame, Fabric sent no new `onLayout`.
The new `measureKey` never got a height, and the verse stayed hidden.

The lesson applies to any measure-and-cache pattern on Fabric. A cache keyed by
a composite key, filled by `onLayout` of views whose React key is only part of
that key, can miss the layout forever. Fabric reports a layout for a new frame
of a view. It does not report a layout for each render, and it knows nothing
about your cache key.

### The failing sequence (the width trigger)

Paths that start with `react-native/`, `ReactCommon/`, or `Libraries/` name
files in the installed react-native 0.86.3 package
(`node_modules/react-native/`), not files in this repo.

1. The Bible tab has Romans 8:28 in memory. A deep link pushes the reader to
   Romans 8:28. The book comes from memory, so the verse renders on the first
   render, before the reader's first layout.
2. Before the first layout, the reader width is the window width from
   `useWindowDimensions()` (`apps/mobile/src/components/bible/BibleReader.tsx:266`,
   `:276`). On Android, `Dimensions.set` divides window pixels by the scale in
   64-bit JS numbers (`react-native/Libraries/Utilities/Dimensions.js:69-76`).
   On a Pixel 9a, the result is `1080 / 2.625 = 411.42857142857144`.
3. `columnWidth` is that width minus two 24-point margins
   (`BibleReader.tsx:130`, `:313-316`): `363.42857142857144`. This value goes
   into the first `measureKey`, K1.
4. Yoga lays out the copies in 32-bit floats. On Android, `Float` is `float`
   (`react-native/ReactCommon/react/renderer/graphics/platform/android/react/renderer/graphics/Float.h:18`).
   The frame width of each copy is `363.4285583496094`.
5. The reader root and the measuring copy report their first layouts in one
   event flush. Both handlers run before React renders. The root stores its
   32-bit width, `411.4285583496094` (`BibleReader.tsx:278-285`). The copy's
   handler saves its height under K1, because its closure holds K1.
6. React renders. `columnWidth` is now `363.4285583496094`, so `measureKey`
   becomes K2. K2 has no heights, so the plan stays `"measure"`. The copies
   keep their React keys (`size`), so React updates the same host views with
   the new width.
7. In 32-bit floats, the new width equals the old frame width. The frame does
   not change, so `BaseViewEventEmitter::onLayout` returns before it
   dispatches (`react-native/ReactCommon/react/renderer/components/view/BaseViewEventEmitter.cpp:60-65`).
   K2 never gets a height, and the verse stays hidden.

A push to a different book does not fail. That book loads from disk, so the
reader's first layout lands and renders before any measuring copy mounts.

On iOS, only Android's `DeviceInfoModule.kt` sends the `windowPhysicalPixels`
payload that `Dimensions.js` divides. Also, iOS `Float` is `CGFloat`
(`.../platform/ios/react/renderer/graphics/Float.h:19`). So on iOS the two
widths agree, and K1 equals K2. This iOS explanation comes from a source read.
It agrees with the observation, but the session did not trace it on a device.

A verse move showed the hidden verse again. The likely cause: the new verse
text lays out to a different height, and a new frame makes Fabric report.

### The second trigger (a text change with the same frame)

The defect has a second trigger with no width change. During a scrub, one event
flush can carry the measure of verse A and a thumb move to verse B. The next
render changes `measureKey` by its text. If verse B lays out to the same frame
as verse A, Fabric reports nothing, and verse B stays hidden. The fix commit
says "a scrub can hit it too", and
`apps/mobile/src/components/bible/__tests__/ReaderMovement.test.tsx:1404-1450`
pins this case.

This trigger does not depend on 32-bit floats. The event emitter is shared C++
code, so iOS is not safe from it in principle. The session did not reproduce
this trigger on a device.

## Symptoms

- On an Android release build (Pixel 9a emulator, 2026-09-25, every attempt),
  a deep link pushed the reader to the same reference as the saved position.
  Home had focus, and the Bible tab was already mounted. The reader chrome
  showed, but the verse stayed hidden with no end.
- The verse was in the view tree, but at the fit's `opacity: 0`.
- A verse move showed the verse. A push to a different book always worked.
- iOS never showed the defect.
- Jest never showed it. `react-test-renderer` has no layout, and the old
  harness called every copy's `onLayout` by hand, so the whole suite was green.

## What Didn't Work

These items come from the session notes, with one check added on 2026-09-28.

1. **The old jest harness.** It called `onLayout` by hand for every copy on
   each pass. A hand call has no frame check, so every new key got a height.
   The suite was green with the defect in place. A falsification run on
   2026-09-28 shows the same blind spot: with the driver's report-once rule
   removed, all five fit tests pass without the fix (see Prevention).
2. **The iOS simulator.** The width trigger cannot happen there (see Problem).
3. **A debug build path.** Session notes say it lays out in a different order,
   and it did not show the defect. The repro needed an Android release build
   and the exact sequence: Home focused, the Bible tab already mounted, and a
   push to the same reference as the saved position.
4. **A push to another book.** It looks like the same flow, but it always
   worked. The disk read puts the reader's first layout before the verse's
   first render. The suite keeps this case as the device control
   (`apps/mobile/app/__tests__/readerHostRoutes.test.tsx:701-712`).

## Solution

Key the measuring container on the full `measureKey`. A new key then unmounts
the old host views and mounts new ones. The fix is in PR #2427, in the commit
"fix(mobile): show the verse when the fit key changes in one flush".

Before (the code just before that commit):

```tsx
{
  plan.status === "measure" && (
    <View
      style={styles.measuring}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {plan.sizes.map((size) => (
        <View
          key={size}
          testID={`bible-verse-measure-${size}`}
          style={[styles.copy, { width: columnWidth }]}
          onLayout={(event: LayoutChangeEvent) =>
            record(size, event.nativeEvent.layout.height)
          }
        >
          {body(size)}
        </View>
      ))}
    </View>
  )
}
```

After (`apps/mobile/src/components/bible/VerseView.tsx:334-357`):

```tsx
{
  plan.status === "measure" && (
    // A native view reports onLayout only for a new frame, so a new key
    // with the old frame never gets a height. New views always report.
    <View
      key={measureKey}
      style={styles.measuring}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {plan.sizes.map((size) => (
        <View
          key={size}
          testID={`bible-verse-measure-${size}`}
          style={[styles.copy, { width: columnWidth }]}
          onLayout={(event: LayoutChangeEvent) =>
            record(size, event.nativeEvent.layout.height)
          }
        >
          {body(size)}
        </View>
      ))}
    </View>
  )
}
```

The same commit adds `apps/mobile/src/test-utils/fabricLayout.ts` and five
tests that use it (see Prevention).

## Why This Works

- Fabric keeps one `LayoutEventState` for each event emitter. It holds the last
  dispatched frame and a `wasDispatched` flag
  (`react-native/ReactCommon/react/renderer/components/view/BaseViewEventEmitter.h:43-67`).
- `BaseViewEventEmitter::onLayout` returns early when the new frame equals the
  dispatched frame (`BaseViewEventEmitter.cpp:60-65`). A re-render with the
  same frame therefore sends nothing. The emitter also coalesces: while one
  event is in flight, only the latest frame is sent
  (`BaseViewEventEmitter.cpp:42-55`).
- A new React key makes a new host view with a new emitter. The new emitter
  starts with `wasDispatched{false}` (`BaseViewEventEmitter.h:58`), so its
  first frame always dispatches.
- The container key is the full `measureKey`, so each new key gets new copies.
  Each new copy reports its first frame, and its handler closes over the new
  key. So every key that needs heights gets them.
- An old copy's late `onLayout` still saves under its own old key, in its own
  entry (`VerseView.tsx:190-209`).
- The remount costs little. The container exists only while the plan is
  `"measure"`, and it remounts only when `measureKey` changes.

Weaker fixes (analysis, not session attempts):

- **Round `columnWidth` to 32 bits or to device pixels before it goes into
  `measureKey`.** This removes the width trigger only. The scrub trigger
  changes the key by text with the same frame, so it stays.
- **Save heights by frame, or add the frame to the key.** The frame does not
  encode the text or the font, so it cannot identify the verse.
- **Key each copy on `` `${measureKey}|${size}` ``.** This works the same as
  the chosen fix. The container key is one change in one place.

## Prevention

### The rule

When `onLayout` fills a cache keyed by K, give the reporting host view (or a
wrapper around it) the React key K. Use the whole K, not a part of it. Do not
expect `onLayout` for a re-render. Expect it only for a new host view or a new
native frame.

In review, ask one question for each part of K: "Can this part change while
the view's frame stays the same?" Examples are a sub-pixel width change, a
text change with the same height, and a font change with the same metrics. If
the answer is yes for any part, a React key that omits that part is a defect.

To find candidate sites, start from the `onLayout` handlers and look for a
handler that writes into a map or a state keyed by more than the view's React
key:

```sh
git grep -nE "onLayout=\{" -- apps/mobile/src apps/tv/src
```

A sibling rule is in `apps/mobile/CLAUDE.md:446`: "`PlayerSlot` must never
depend on getting exactly one good `onLayout`." That rule covers a measure
callback that the native side drops. This rule covers a re-render that sends
no event.

### Test with the Fabric layout driver

`apps/mobile/src/test-utils/fabricLayout.ts` is a SYNTHETIC native-layout
driver for `react-test-renderer` suites. It models Fabric on Android for
react-native 0.86:

- It rounds each frame to 32-bit floats with `Math.fround`
  (`fabricLayout.ts:46-52`).
- It reports a frame to a host node only once. A `WeakMap` holds the last
  reported frame for each node (`fabricLayout.ts:30-31`, `:53-56`).
- `beat` runs every due `onLayout` in one `act`, then the optional `during`
  callback in the same `act` (`fabricLayout.ts:59-67`). One `beat` is one
  event flush.
- `settle` beats until a beat reports nothing, for at most 8 beats
  (`fabricLayout.ts:27`, `:71-75`).

Give `createNativeLayout` a `frameOf` function. It returns a frame for each
view you lay out, and `null` for all other views. Derive the frame from the
props the view really gets, for example its flattened style width. Do not use
a value that the test expects.

Example 1: a width change below 32-bit precision. This is condensed from
`apps/mobile/app/__tests__/readerHostRoutes.test.tsx:552-587` and `:659-682`.

```tsx
// SYNTHETIC Pixel 9a window: a 64-bit JS width against a 32-bit Yoga width.
const PIXEL_9A = {
  width: 1080 / 2.625,
  height: 2424 / 2.625,
  scale: 2.625,
  fontScale: 1,
}
act(() => {
  Dimensions.set({ window: PIXEL_9A, screen: PIXEL_9A })
})

function frameOf(node: RenderedNode): NativeFrame | null {
  const testID = String(node.props.testID ?? "")
  if (testID === "bible-reader") {
    const { width, height } = Dimensions.get("window")
    return { x: 0, y: 0, width, height }
  }
  if (!testID.startsWith("bible-verse-measure-")) return null
  const { width } = StyleSheet.flatten(node.props.style) as { width: number }
  return { x: 0, y: 0, width, height: VERSE_HEIGHT }
}

const layout = createNativeLayout(frameOf)
const pushed = await mountHost(ReaderRoute, true)
expect(verseOpacity(pushed)).toBe(0) // The verse renders before any layout.
await layout.settle(pushed)
expect(verseOpacity(pushed)).toBe(1)
```

Example 2: a key change in the same flush as the measure. This is condensed
from `apps/mobile/src/components/bible/__tests__/ReaderMovement.test.tsx:1406-1441`.

```tsx
// SYNTHETIC: each verse is 200 points tall, so the frame cannot see the text.
const layout = createNativeLayout((node) =>
  String(node.props.testID ?? "").startsWith("bible-verse-measure-")
    ? { x: 0, y: 0, width: Number(flat(node).width), height: 200 }
    : null,
)
// The measure of John 3:9 and the thumb move to John 3:18 share one flush.
await layout.beat(renderer, () => move(at(0.5), at(0.25)))
await layout.settle(renderer)
expect(verseOpacity()).toBe(1)
```

### Each driver property is necessary

A falsification run on 2026-09-28 used the PR branch. A scratch jest
transformer removed `key={measureKey}` from the measuring container at
transform time, so no tracked file changed. The run then removed one driver
property at a time. The five fit tests are the four tests in the describe
block at `readerHostRoutes.test.tsx:551-713` and the scrub test at
`ReaderMovement.test.tsx:1406-1450`.

| Fix      | Driver                                | Result                                                                                                                     |
| -------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| In place | Full                                  | 5 pass                                                                                                                     |
| Removed  | Full                                  | 4 fail (`readerHostRoutes.test.tsx:680` twice, `:698`, and `ReaderMovement.test.tsx:1441`). The other-book control passes. |
| Removed  | No `Math.fround`                      | Only the scrub test fails. The three width cases pass without the fix.                                                     |
| Removed  | No report-once rule (the old harness) | All 5 pass without the fix.                                                                                                |
| Removed  | One `act` for each `onLayout`         | All 5 pass without the fix.                                                                                                |

What this means for the next test:

- Keep all three driver properties when you reuse the driver.
- Test the width trigger and the text trigger separately. The 32-bit rounding
  catches only the width trigger. A same-frame text change catches only the
  text trigger.
- Send the key-changing event through `beat(renderer, during)`, so that it
  lands in the same flush as the measure.
- Keep a control case that passes with and without the fix, such as the
  other-book push. It shows that the harness drives the real path.

### What the driver cannot prove

The driver is synthetic. It copies the frame check and the rounding from the
react-native 0.86.3 source, but it cannot prove the flush order on a device.

The driver comment calls layout a Default-priority event
(`fabricLayout.ts:59-60`). In react-native 0.86.3, the flag
`fixMappingOfEventPrioritiesBetweenFabricAndReact` defaults to `false`
(`ReactCommon/react/featureflags/ReactNativeFeatureFlagsDefaults.h:254-256`,
`ReactNativeFeatureFlagsDefaults.kt:138`), and `apps/mobile` does not override
it. With that default, `ReactCommon/react/renderer/core/EventQueueProcessor.cpp:81-96`
gives a layout event Discrete priority outside a continuous gesture, and
Default priority during one.

The one-flush result holds for both priorities, by a source read. React
19.2.3's Fabric renderer flushes sync work at the end of an event batch only
for legacy roots (`Libraries/Renderer/implementations/ReactFabric-prod.js:10483-10494`).
It schedules the render of a concurrent root in a microtask
(`ReactFabric-prod.js:2069-2077`, `:2242-2253`). The device repro, not this
source read, is the primary evidence.

So for a change to a measure-and-cache path, also do a device check on an
Android release build with the exact sequence. The session verified this fix
on `emulator-5560` (AVD `Pixel_9a_API_35`, release build) with a repro script:
the Bible tab at John 3:17, then a push to John 3:17. The script counted 0
hidden verse nodes.

## Related Issues

- `docs/solutions/logic-errors/layout-effect-commit-lag-mini-player-shrink-flash.md`:
  another apps/mobile render-timing defect that a green jest suite could not
  see. Its test move (assert the ORDER of events against the real module) is
  the same idea as the driver's one-flush `beat`.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`:
  the META home for "a mock proves branch shape, not the production
  contract". The hand-fired `onLayout` harness is a new worked instance.
- `docs/solutions/ui-bugs/native-animated-stop-report-overwrites-immediate-setvalue.md`:
  a native report that races a JS write, which jest cannot see because it has
  no native side.
- `docs/solutions/integration-issues/expo-screen-orientation-rnscreens-deferral-blocks-fullscreen-rotate.md`:
  records the `PlayerSlot` `measureInWindow` callback that the native side
  drops. That is a sibling failure: a measure that never arrives, where this
  one is a re-render that sends no event.
- `docs/solutions/ui-bugs/animated-sequence-nested-in-parallel-never-runs-on-android-fabric.md`:
  the same fingerprint (Android release build, Fabric, iOS clean, suite
  green) with a different mechanism.
- `docs/solutions/logic-errors/hidden-subtree-breaks-measuring-effects-and-focus.md`:
  a web (jsdom) case of a measuring effect that never fires again on the
  transition that matters.
- PR #2427 (open, not merged as of 2026-09-28): the native Bible reader,
  roadmap `feat-553`.
