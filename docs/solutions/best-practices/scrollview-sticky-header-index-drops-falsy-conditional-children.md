---
title: "A ScrollView sticky index counts React.Children.toArray positions, so a conditional child above it pins the wrong row"
date: 2026-09-28
category: best-practices
module: apps/mobile
problem_type: best_practice
component: frontend_stimulus
severity: medium
resolution_type: test_fix
applies_when:
  - "A React Native ScrollView computes stickyHeaderIndices from a condition over its own children"
  - "A child above the pinned row renders conditionally, such as {flag && <View />} or a .map() result"
  - "The pinned row holds a control that must stay in reach while the list scrolls"
  - "An edit adds, removes, or reorders a child above a sticky header, even when the diff does not touch the index"
  - "A component moves a row from a fixed View outside a ScrollView into the ScrollView as a sticky header"
symptoms:
  - "A later edit above the sticky child pins a different row, and no test goes red"
  - "Under jest, stickyHeaderIndices is an inert prop, because the preset's ScrollView mock renders children without the sticky mapping"
  - "Nothing throws and React Native logs no warning when the index points at the wrong child"
related_components:
  - "apps/mobile/src/components/library/LibraryDownloads.tsx"
  - "apps/mobile/app/__tests__/downloadsScreen.test.tsx"
  - "apps/tv/src/components/ExperienceRenderer.tsx"
  - "apps/tv/app/index.tsx"
tags:
  [
    react-native,
    scrollview,
    sticky-header,
    children-toarray,
    conditional-rendering,
    react-test-renderer,
    testing-discipline,
    mobile,
  ]
---

# A ScrollView sticky index counts React.Children.toArray positions, so a conditional child above it pins the wrong row

## Context

A React Native `ScrollView` pins the children that `stickyHeaderIndices` names.
Each index is a position in `React.Children.toArray(children)`, not a position
in the JSX source. `toArray` drops `false`, `null`, and `undefined` children. So
when a scroll view has conditional children (`{flag && <View />}`), the row that
an index points at depends on which conditions are true.

PR #2444 (branch `feat/mobile-profile-library`, open as of 2026-09-28) met this
hazard. It moved the downloads list into
`apps/mobile/src/components/library/LibraryDownloads.tsx` with an optional
`header` prop. The Select / Cancel row ("the head") moved from a fixed `View`
above the list into the `ScrollView` as a sticky header. The head must pin, so
that Select and Cancel stay in reach while the list scrolls under the Profile
account card.

The `ScrollView` children, in order (`LibraryDownloads.tsx:331-454`):

1. `{hasHeader && <View style={styles.header}>{header}</View>}` (line 331)
2. `{hasRecords && (<View style={styles.head}>…Select / Cancel…</View>)}`
   (lines 334-401)
3. `{isReady && (hasRecords ? <View style={styles.list}>…</View> : <LibraryEmptyState … />)}`
   (lines 404-452)
4. `{footer != null && <View style={styles.footer}>{footer}</View>}` (line 454)

The index is `stickyHeaderIndices={hasRecords ? [hasHeader ? 1 : 0] : undefined}`
(line 328). The expression is correct today. Three reviewers in two
`ce-code-review` runs (correctness, testing, maintainability) flagged it as
untested. If a child is added above the head, or the children are reordered,
the account card or the list pins instead, and every Profile test stays green.

No test caught this because jest cannot see pinning. The `apps/mobile` jest
preset is `jest-expo` (`apps/mobile/package.json:94`), which loads
`@react-native/jest-preset` 0.86.2. That preset replaces `ScrollView` with a
mock (lines 116-119 of its `jest/setup.js`). The mock's `render` puts
`this.props.children` directly into a `View` (lines 49-57 of its
`jest/mocks/ScrollView.js`). It never runs the index mapping, and it never
wraps a child in `ScrollViewStickyHeader`. Under jest, `stickyHeaderIndices` is
an inert prop: the rendered tree is the same for any value.

## Guidance

### 1. Know the mechanism: an index is a `toArray` position

In react-native 0.86.3, `ScrollView.render` converts its children with
`React.Children.toArray`
(`apps/mobile/node_modules/react-native/Libraries/Components/ScrollView/ScrollView.js:1688`).
It then maps over that array and wraps the child at each listed index in the
sticky header component (`ScrollView.js:1690-1717`). The check
`child ? stickyHeaderIndices.indexOf(index) : -1` (line 1692) runs on the
`toArray` output, so `index` is the compacted position. The layout handler
`_onStickyHeaderLayout` makes the same `toArray` call to find the next header
(`ScrollView.js:1124-1142`).

What takes a slot in `toArray` (checked with a `node -e` script against react
19.2.3 in `apps/mobile`):

| Child                                     | Takes a slot?                          |
| ----------------------------------------- | -------------------------------------- |
| `false`, `true`, `null`, `undefined`      | No                                     |
| `0`, `""`, or any other string or number  | Yes                                    |
| An array, such as a `.map()` result       | Yes, one slot for each item            |
| A Fragment (`<>…</>`)                     | Yes, one slot for the whole Fragment   |
| An element whose component renders `null` | Yes, because `toArray` does not render |
| A JSX comment (`{/* … */}`)               | No, because the compiler removes it    |

Two hazards follow from the table:

- A `.map()` above the sticky child moves the index by the length of the list.
- A number guard such as `{count && <View />}` leaves `0` in the slot when
  `count` is zero. Keep each `&&` guard boolean, as `hasHeader` and
  `hasRecords` are.

`LibraryDownloads` has a JSX comment between the header and the head (line
333). The comment takes no slot, and the passing test shows that index 1
resolves to the head.

### 2. Compute the index from the flags that gate the children above it

Use the same booleans in the index expression and in the JSX. Do not write a
literal that is correct for only one state.

```tsx
const hasHeader = header != null
const hasRecords = isReady && offlineRecords.length > 0
// ...
<ScrollView stickyHeaderIndices={hasRecords ? [hasHeader ? 1 : 0] : undefined}>
  {hasHeader && <View style={styles.header}>{header}</View>}
  {hasRecords && <View style={styles.head}>{/* Select / Cancel */}</View>}
```

Pass `undefined` when the sticky child is absent. Otherwise the index points at
the next child that moved into that slot. For `LibraryDownloads` with a header
and no records, a fixed `[1]` pins the empty state (or the footer, before the
downloads load).

Wrap a caller-supplied slot in a host `View` that renders whenever its flag is
true (line 331). Then the slot depends on `hasHeader` alone, not on the value
the caller passes. An unwrapped `{hasHeader && header}` drops out of `toArray`
if a caller passes `false`, while `hasHeader` (`header != null`) still counts
it.

### 3. Pin the index with a test that resolves the pinned child

A render test cannot see pinning. So resolve the child that the index points
at with the same `toArray` mapping, and assert that it holds the control that
must stay on screen. The helpers are `pinnedChild()` and `elementHasLabel()`
in `apps/mobile/app/__tests__/downloadsScreen.test.tsx`. (Note, 2026-09-29:
they moved there from `app/(tabs)/__tests__/librarySelection.test.tsx` when the
list moved to the root Downloads screen, which renders no header above the
Select row.)

```tsx
import { Children, isValidElement, type ReactNode } from "react"
import { ScrollView } from "react-native"

/** The stickyHeaderIndices the downloads list passes to its one ScrollView. */
function stickyIndices(renderer: TestInstance): number[] | undefined {
  const views = renderer.root.findAll((node) => node.type === ScrollView)
  expect(views.length).toBe(1)
  return views[0]!.props.stickyHeaderIndices as number[] | undefined
}

/** Does this element subtree hold a control with this label? */
function elementHasLabel(node: ReactNode, label: string): boolean {
  if (!isValidElement(node)) return false
  const props = node.props as {
    accessibilityLabel?: string
    children?: ReactNode
  }
  if (props.accessibilityLabel === label) return true
  return Children.toArray(props.children).some((child) =>
    elementHasLabel(child, label),
  )
}

/** The child that pins. RN's ScrollView maps stickyHeaderIndices onto
 *  Children.toArray, which drops `false` slots, so this does the same. */
function pinnedChild(renderer: TestInstance): ReactNode {
  const indices = stickyIndices(renderer)
  expect(indices?.length).toBe(1)
  const view = renderer.root.findAll((node) => node.type === ScrollView)[0]!
  return Children.toArray(view.props.children as ReactNode)[indices![0]!]
}
```

Five details make the helpers work:

- `node.type === ScrollView` finds the scroll view. The test and the component
  both import `ScrollView` from `react-native`, and under the preset both names
  resolve to the one mock class.
- `pinnedChild` reads the `props.children` that the component passed to
  `ScrollView`. On a device, `ScrollView.render` gives the same elements to
  `toArray`.
- `elementHasLabel` walks element props, not rendered output. It finds the
  `Pressable` with `accessibilityLabel="Select downloads"` inside the head
  element, and it goes through Fragments by their `children` prop.
- The walk sees only elements that the component under test created in its own
  JSX. If the control moves into a child component's render, the walk cannot
  find it. Then assert on that child component's type or props.
- `stickyIndices` asserts a count (`views.length`), not a node array. In this
  repo's jest render suites, a failing `toEqual` diff of react-test-renderer
  nodes can exhaust jest's heap (auto memory [claude]). The test file states
  that rule at line 437.

Assert every state of the gate that the production caller can reach:

- With records, the pinned child holds "Select downloads". After the test
  enters selection mode, the pinned child holds "Cancel selection" ("pins the
  Select row, not the account card, while the list scrolls", lines 342-354).
- With no records, `stickyIndices(renderer)` is `undefined` ("shows the empty
  state under the account card with no downloads", line 446).
- Before the downloads load (`isReady` is false), `stickyIndices(renderer)` is
  `undefined` ("shows only the account card and privacy link until downloads
  load", line 471).

When more than one condition sits above the sticky child, render one case for
each reachable combination of those conditions. A test renders only the state
it sets up. A new child whose condition is false in every test case does not
fail the test, but it can still move the index on a device.

### 4. Falsify each assertion once

Each falsification ran on a copy of the file, and the copy was restored after
the run:

- `hasRecords ? [0] : undefined` pins the account card. It failed "pins the
  Select row, not the account card, while the list scrolls".
- `[hasHeader ? 1 : 0]` pins a row even with no records. It failed the
  empty-state case and the not-yet-loaded case.

After the restore, the suite passed 13 of 13 tests. The full `apps/mobile` jest
run passed 342 suites and 5,824 tests.

### What the test does not prove

- It does not prove that the row pins on screen, or that a tap lands on it.
  Jest has no layout and no hit testing. On Fabric, `ScrollViewStickyHeader`
  debounces its translate value into the shadow tree (15 ms on Android, 64 ms
  on other platforms), so that hit testing follows the pinned position
  (`ScrollViewStickyHeader.js:129-157`). On 2026-09-28, the user tapped Select
  on the pinned row on an Android phone (Galaxy S20), and the tap worked.
- It does not enter the no-header branch (`hasHeader ? 1 : 0` gives `0`). The
  only caller, `apps/mobile/app/(tabs)/profile.tsx:9-13`, always passes
  `header`, so production cannot reach that branch today. Add a no-header case
  when a second host renders `LibraryDownloads` without a header.

### Alternative considered: a fixed-index slot

The maintainability reviewer suggested that the component always render the
header slot (an empty `View` when there is no header), so the head always has
index 1. PR #2444 did not adopt that change. A fixed slot removes only the
header condition. A new child above the head, or a reorder, still moves the
index with no error. The behavioral test catches all of those changes. The two
approaches can go together: a fixed slot removes the ternary, but it still
needs the test.

## Why This Matters

A wrong sticky index fails with no signal. Nothing throws, React Native logs no
warning, and every render test stays green, because the jest mock ignores the
prop. On a device, the wrong row pins. Here, the account card would stay at the
top, and the Select / Cancel row would scroll away with the list.

The hazard comes from edits that do not touch the index line. The index is
correct for the child order on the day that someone writes it. A later edit
above the sticky child (a banner, a `.map()`, a moved footer) changes the
mapping, but the diff does not show line 328. A reviewer who reads only the
diff has no reason to check the index.

The test changes that silent shift into a named failure. It asserts the
contract ("the Select row pins"), not the number ("index 1"). So it stays
correct when a valid change moves the index, and it fails only when the wrong
row pins.

## When to Apply

- A `ScrollView` sets `stickyHeaderIndices`, and one or more conditional
  children (`&&`, a ternary to `null`, or a `.map()`) come before the sticky
  child.
- A component takes an optional slot prop (`header`, `banner`, `footer`) that
  renders as a `ScrollView` child above a sticky row.
- You move a row into a `ScrollView` as a sticky header, where before it was a
  fixed `View` outside the scroll view.
- You add, remove, or reorder children in a `ScrollView` that already pins a
  row. Check the index even when the diff does not touch it.

The other sticky `ScrollView`s in the repo are in the same hazard class, but
they have a lower risk today:

- `apps/tv/src/components/ExperienceRenderer.tsx:268` sets
  `stickyHeaderIndices={header != null ? [0] : undefined}`. The pinned child
  (line 270) is the first child and uses the same condition, so no child above
  it can move it. The hazard returns if someone adds a child before the header.
- `apps/tv/app/index.tsx:624` sets `stickyHeaderIndices={[0]}`, and its first
  child, `<View>{topBar}</View>` (line 631), is unconditional. A new child
  before the top bar would pin the wrong row.

TV sticky headers have a separate hazard that this guidance does not cover.
tvOS drops `nextFocus*` hints on sticky-header children, so bridge D-pad Down
with a `TVFocusGuideView` (auto memory [claude]). See
`docs/solutions/design-patterns/tv-sticky-header-nextfocus-asymmetry-bridge-20260619.md`.

## Examples

Before: the index is correct, but no test holds it.

```tsx
<ScrollView stickyHeaderIndices={hasRecords ? [hasHeader ? 1 : 0] : undefined}>
  {hasHeader && <View style={styles.header}>{header}</View>}
  {hasRecords && <View style={styles.head}>{/* Select / Cancel */}</View>}
  {/* list or empty state */}
  {footer != null && <View style={styles.footer}>{footer}</View>}
</ScrollView>
```

A later edit that breaks the pin. `StorageBanner` is a hypothetical example,
not code in the repo:

```tsx
<ScrollView stickyHeaderIndices={hasRecords ? [hasHeader ? 1 : 0] : undefined}>
  {hasHeader && <View style={styles.header}>{header}</View>}
  {showStorageBanner && <StorageBanner />}
  {hasRecords && <View style={styles.head}>{/* Select / Cancel */}</View>}
  {/* ... */}
</ScrollView>
```

When the banner shows, index 1 pins the banner, and the head scrolls away. The
diff does not touch line 328, and every render test that only counts or finds
nodes still passes.

After: the test that fails on that edit, provided a test case renders the
banner.

```tsx
it("pins the Select row, not the account card, while the list scrolls", async () => {
  const renderer = await renderProfile("ios")

  expect(elementHasLabel(pinnedChild(renderer), "Select downloads")).toBe(true)

  await enterSelection(renderer)
  expect(elementHasLabel(pinnedChild(renderer), "Cancel selection")).toBe(true)
  await unmount(renderer)
})
```

The no-records states assert that nothing pins:

```tsx
// No Select row exists, so nothing may pin.
expect(stickyIndices(renderer)).toBeUndefined()
```

## Related

- `docs/solutions/design-patterns/tv-sticky-header-nextfocus-asymmetry-bridge-20260619.md`:
  a different sticky-header hazard, D-pad focus on tvOS, not index mapping.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`:
  the general rule that a green test can leave a contract unchecked. Here the
  jest mock makes the prop inert, and only a test that resolves the pinned
  child checks the contract.
- PR #2444: the move of the downloads list to the Profile tab, which added the
  `pinnedChild` test.
