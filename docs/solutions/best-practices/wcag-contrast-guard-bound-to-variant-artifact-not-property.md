---
title: "A contrast guard bound to one UI variant's rendered artifact is deleted, not re-pointed, when the variant changes"
date: 2026-09-07
category: best-practices
module: apps/mobile
problem_type: best_practice
component: testing_framework
root_cause: inadequate_test_property
resolution_type: test_fix
severity: high
symptoms:
  - 'A contrast test throws "no scrim rendered" after the treatment constant moves from scrim to frosted'
  - "4 of 62 cases fail because the gradient-lookup helper finds no node once no LinearGradient renders"
  - "The active treatment's tint constant carries a comment claiming it meets the WCAG 4.5:1 floor, and no test asserts it"
  - "Lowering that tint from 0.54 to 0.53 (4.42:1, below the floor) leaves the whole suite green"
applies_when:
  - "A guard locates what it checks by querying for a rendered node or prop shape rather than the property it protects"
  - "A surface has mutually exclusive rendering variants and only one variant's shape is covered"
  - "An accessibility or compliance constant is hand-derived and its rationale lives only in a comment"
  - "Switching a variant needs no test-file change, so the suite cannot report that a guard stopped running"
related_components:
  - BibleQuotesCarouselRenderer.tsx
  - bibleCardTreatment.ts
tags:
  - testing
  - accessibility
  - wcag-contrast
  - test-coupling
  - coverage-gap
  - meta-pattern
  - mobile
  - react-native
---

# A contrast guard bound to one UI variant's rendered artifact is deleted, not re-pointed, when the variant changes

## Context

`apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx` draws a
backdrop between a Bible-quote card's video still and its overlaid text, so
the text stays readable against an arbitrary frame. The component supported
two backdrop treatments behind one module constant — a `LinearGradient` scrim
(`CARD_TREATMENT === "scrim"`) and a solid translucent tint layered under a
blur (`CARD_TREATMENT === "frosted"`) — and a WCAG AA 4.5:1 contrast test
(labelled AE13, in
`apps/mobile/src/components/sections/__tests__/BibleQuotesCarouselRenderer.test.tsx`)
was meant to guard both.

It did not. The test located its subject with
`renderer.root.findAll((n) => Array.isArray(n.props.colors))[0]`, which only a
`LinearGradient` node satisfies, and threw `no scrim rendered` when it found
none. While the two treatments were being compared on a device, the constant
sat at `"frosted"`, and the suite then gave `4 failed, 58 passed, 62 total` —
the guard was not weak, it was gone, and nothing in the test output said so
directly; the error read as "the component broke," not "the treatment you're
on was never tested."

That failing state was a working-tree state during development, never a
committed revision: the parent commit renders the scrim unconditionally and
has no treatment constant at all. So the counts above are reported from the
session that produced the fix and cannot be reproduced by checking out a
prior commit. The _coverage_ gap they exposed is the durable part, and that
is reproducible — see the falsification below.

The deeper defect was not the four red cases. Grepping every test file in the
package for `frosted` returned zero hits: the active path had never had
contrast coverage, in either direction. It carried a hand-derived constant,
`FROSTED_TINT = "rgba(0, 0, 0, 0.54)"`, whose own comment asserted 0.54 was
the least black tint that still cleared 4.5:1 for white text over a
pure-white still — a specific, falsifiable numeric claim, backed by nothing
that could falsify it. Lowering the value to 0.53 left the entire suite
green — and 0.53 is genuinely below the floor: black at that alpha over a
white still grounds at rgb(119.8), giving white text 4.42:1, where 0.54
grounds at rgb(117.3) and gives 4.59:1.

## Guidance

**Before:** the guard located its subject by the artifact one branch happens
to render.

```ts
// apps/mobile/src/components/sections/__tests__/BibleQuotesCarouselRenderer.test.tsx (pre-fix)
function scrim(renderer: TestInstance) {
  const node = renderer.root.findAll((n) => Array.isArray(n.props.colors))[0]
  const colors = node?.props.colors as string[] | undefined
  const locations = node?.props.locations as number[] | undefined
  if (colors == null || locations == null) throw new Error("no scrim rendered")
  return { colors, locations }
}
```

Switch the module constant to the other branch and this helper throws. The
test doesn't fail with a wrong number — it fails to find its subject at all,
which is what let the frosted path carry zero equivalent coverage from the
moment it was added: nobody saw a red assertion about contrast, they saw an
error that looked like breakage in an unrelated render path.

**After:** two changes, made together, close the gap for good rather than
just for today's two branches.

1. Pull the discriminator and its constants into their own leaf module so
   each branch is independently mockable, and drop the option that never had
   a legitimate value:

```ts
// apps/mobile/src/lib/bibleCardTreatment.ts
/** `none` is deliberately absent: 8 of 10 measured stills fail 4.5:1 bare. */
export type BibleCardTreatment = "scrim" | "frosted"

export const CARD_TREATMENT: BibleCardTreatment = "frosted"

/**
 * 0.54 is the FLOOR, not a preference: the least tint clearing 4.5:1 for opaque
 * white over a pure-white still. Blur cannot help — it removes DETAIL, not
 * luminance. Black rather than the card colour, which reaches the floor sooner.
 */
export const FROSTED_TINT = "rgba(0, 0, 0, 0.54)"
```

Note the `8 of 10` in that first comment: it comes from sampling ten real
stills during the work, and nothing in the repo can reproduce it. It is the
same kind of unpinned empirical claim this doc is about — tolerable here only
because it justifies _removing_ an option rather than certifying one as safe.
The `0.54` beneath it is the claim that needed a test, and now has one.

2. Replace the gradient-specific helper with one that reads the _guarded
   property_ — the opaque colour the text actually sits on — off whichever
   tree renders, falling back to a fixed worst-case background rather than a
   sampled one, since a real still can legitimately be pure white:

```ts
// apps/mobile/src/components/sections/__tests__/BibleQuotesCarouselRenderer.test.tsx
/** A still can be pure white, so that is what any backdrop must survive. */
const WORST_STILL: Rgba = { r: 255, g: 255, b: 255, a: 1 }

/**
 * The opaque colour the text actually sits on, whichever backdrop renders.
 * Read off the tree, so changing CARD_TREATMENT RE-POINTS this guard rather
 * than deleting it — the failure that made the guard treatment-agnostic.
 */
function backdrop(renderer: TestInstance): Rgba {
  const gradient = renderer.root.findAll((n) =>
    Array.isArray(n.props.colors),
  )[0]
  if (gradient != null) {
    const colors = gradient.props.colors as string[]
    return parseColor(colors[colors.length - 1] as string)
  }
  const tints = renderer.root
    // Host nodes only: a composite and its host carry the same props, so an
    // unfiltered scan counts the one tint twice.
    .findAll(
      (n) =>
        typeof n.type === "string" &&
        typeof flatStyle(n).backgroundColor === "string",
    )
    .map((n) => parseColor(flatStyle(n).backgroundColor as unknown as string))
    .filter((c) => c.a < 1)
  if (tints.length !== 1) {
    throw new Error(`expected exactly one tint, found ${tints.length}`)
  }
  return composite(tints[0] as Rgba, WORST_STILL)
}
```

`backdrop()` throwing `expected exactly one tint, found 2` on its first run
surfaced a second, unrelated gotcha: the project's shared test renderer
(`apps/mobile/src/test-utils/rnTestRenderer.ts:22-27`) returns both the
composite and its host node for one rendered element, each carrying the same
props — so an unfiltered scan double-counts a single tint. The strict
"exactly one" assertion is what surfaced this rather than silently walking
into the wrong node; a looser `tints[0]` would have picked _a_ value and
stayed green regardless of which one.

3. Pin the constant as a floor, not just a lower bound. A test asserting only
   `ratio >= 4.5` does not prove `FROSTED_TINT` sits _at_ the value its
   comment claims — a much darker tint would satisfy the same assertion
   forever, and the comment's claim to be a floor would be unverifiable text.
   Add the missing ceiling on the tightest region:

```ts
it("keeps the backdrop at the floor, so lowering it cannot pass (AE13)", () => {
  const renderer = render([stillQuote()])
  const ground = backdrop(renderer)
  const worst = Math.min(/* ratio per text region, computed against `ground` */)
  // The tightest region clears the floor but is NEAR it. Without the upper
  // bound a backdrop could be darkened arbitrarily and still pass, so the
  // constant would stop being the floor its own comment claims it is.
  expect(worst).toBeGreaterThanOrEqual(4.5)
  expect(worst).toBeLessThan(5.0)
})
```

4. Give the _other_ branch its own render coverage by mocking the
   discriminator, so shipping either treatment can no longer make the other
   invisible to the suite — and open with an anti-vacuous case proving the
   mock actually took effect, since a silently-ignored `jest.mock` would
   otherwise make every case below it pass by accident:

```ts
// apps/mobile/src/components/sections/__tests__/BibleQuotesCarouselRenderer.scrim.test.tsx
jest.mock("../../../lib/bibleCardTreatment", () => ({
  ...jest.requireActual("../../../lib/bibleCardTreatment"),
  CARD_TREATMENT: "scrim",
}))
// ...
describe("BibleQuotesCarouselRenderer — scrim geometry", () => {
  it("renders the gradient rather than the frosted tint", () => {
    // Anti-vacuous: without this, every case below would pass by construction
    // if the treatment mock stopped taking effect.
    expect(scrim(render([PASSAGE_QUOTE])).colors).toHaveLength(3)
  })
  // ...
})
```

Falsification actually performed, not just asserted: setting `FROSTED_TINT`
to `rgba(0, 0, 0, 0.53)` turns both the region-clears-4.5:1 case and the
floor-pinning case red; restoring `0.54` turns them green again. That is the
evidence the guard is live on the shipped path, not just plausible-looking.

Fix landed on PR #2177, in the commit headed "apply Bible quote card frame
review findings" — CI green, unmerged as of this writing. Full mobile app
suite after the fix: 182 test files, 2854 tests passing; `tsc --noEmit` and
`eslint .` clean.

## Why This Matters

A guard whose test locates its subject by _the artifact one branch renders_
is not weaker on the other branch — it is absent, and it fails in a way that
reads as unrelated breakage rather than as missing coverage. That shape lets
a real defect (here, a tint 0.01 short of the AA floor) ship silently,
because nothing exercises the arithmetic that would catch it. The confident
comment on `FROSTED_TINT` — "the least tint clearing 4.5:1" — made the risk
worse, not better: it read as a proven fact to every future reader, when it
was actually an untested assumption. The fix that only reads the guarded
_property_ (composited colour) rather than the _artifact_ (a specific node
shape) survives future branch additions without another silent regression,
and the mirrored per-branch test file means adding treatment #3 cannot
quietly drop coverage of treatment #1 or #2 either.

## When to Apply

A guard is variant-bound — and at risk of this failure — whenever all of
these hold:

- The thing under test (contrast, focus order, an accessibility label, a
  security header, a serialization shape) is produced by more than one code
  path selected by a runtime or build-time discriminator (a feature flag, a
  platform check, an A/B variant, a config constant).
- The test locates its subject by matching a specific rendered/emitted
  _artifact_ shape (a node with a `colors` array prop, a header with an exact
  name, a specific DOM class) rather than by the abstract property the guard
  actually cares about.
- Only one branch is exercised in CI today, so the coverage gap on the other
  branch(es) is invisible until someone flips the discriminator.

The detection question to ask of any such guard: _if I flip the
discriminator, does this test throw "not rendered" / "not found," or does it
follow the change and keep asserting the same property?_ A guard that throws
is bound to the wrong thing.

The two-part remedy, applied in order:

1. Read the guarded _property_ off the tree (or the response, or the log
   line) generically — falling back across every known branch shape — rather
   than assuming one branch's structure.
2. Extract the discriminator into its own small, mockable module, and give
   every branch a companion test file (or case) that pins it to that branch
   and opens with an anti-vacuous assertion that the mock took effect.

Separately, treat any assertion that claims a constant sits exactly _at_ a
threshold as incomplete until it has both bounds. A one-sided `>=` proves
sufficiency, never tightness — add the corresponding `<` (or equivalent) so
a value drifting far past "just enough" is caught as a hidden margin loss,
not celebrated as extra safety.

## Examples

**Contrast guard (this session).** Before: `scrim()` finds `n.props.colors`,
throws `no scrim rendered` when `CARD_TREATMENT` is `"frosted"`. After:
`backdrop()` tries the gradient shape first, falls back to the single
translucent host-view tint composited over a fixed worst-case background,
and both branches get their own render suite via a mocked discriminator
module (`apps/mobile/src/lib/bibleCardTreatment.ts`).

**The same shape in other guard types, to generalise past this one card:**

- _Focus order._ A keyboard-navigation test that asserts on
  `document.activeElement.dataset.testid` after simulating Tab presses is
  bound to one layout. A responsive variant that reorders DOM nodes (e.g. a
  mobile layout using `order` in CSS rather than DOM order) silently escapes
  the same assertion, which still finds _an_ active element and may still
  pass — just not on the intended element. The remedy is the same: assert on
  the intended _reading/tab order property_ (e.g. a recorded sequence of
  visible labels) rather than on one DOM shape, and give each layout
  breakpoint its own case.
- _Security header._ A test asserting `response.headers.get("X-Frame-Options")
=== "DENY"` on one route is bound to that route's specific middleware
  stack. A second route added later, protected instead by a
  `Content-Security-Policy: frame-ancestors 'none'` directive, has the same
  protective _property_ (can't be framed) via a different artifact, and the
  first test gives zero signal about it.
- _Serialization invariant._ A round-trip test that inspects
  `JSON.parse(output).colors[2]` to check an envelope invariant is bound to
  the shape of one encoder. A second encoder (e.g. a binary/CBOR path added
  for a size-sensitive client) carries the same invariant under a different
  wire shape, and the JSON-shaped assertion cannot see it at all.

In each case, the fix is not "add more assertions" — it's "assert on the
abstract property, and make the branch selector itself a first-class,
per-branch-testable seam" so a future branch addition cannot quietly inherit
zero coverage the way the frosted treatment did here.

## Related

- [`mocked-shape-vs-real-contract-discipline-20260506.md`](mocked-shape-vs-real-contract-discipline-20260506.md) — the META home for tests that pass for the wrong reason. This case is an instance of that law with a carrier the table did not yet list: the query that LOCATES the subject is itself variant-specific, so the guard stops finding anything rather than failing. That doc's worked-instance table is the right place for a pointer back here.
- [`../logic-errors/hidden-subtree-breaks-measuring-effects-and-focus.md`](../logic-errors/hidden-subtree-breaks-measuring-effects-and-focus.md) — the same variant-coverage gap in a different failure mode. There a visibility flip left 22 tests passing vacuously; here the flip threw loudly. Loud was not better: the throw named a missing gradient and said nothing about the newly-active branch having no coverage at all.
- [`base-ui-dialog-state-attribute-detection-20260520.md`](base-ui-dialog-state-attribute-detection-20260520.md) — loose sibling. Same instinct (probe the semantic property, not an incidental artifact) applied to browser verification of dialog state rather than to unit-test binding.
- [`missing-artwork-frame-fallback-derivative-recipe-and-authored-first-20260826.md`](missing-artwork-frame-fallback-derivative-recipe-and-authored-first-20260826.md) — same feature neighbourhood (a video's Mux still becomes a card background), different problem class. Linked for orientation only.

Shipped in PR #2177 (`apps/mobile`), unmerged as of this writing.
