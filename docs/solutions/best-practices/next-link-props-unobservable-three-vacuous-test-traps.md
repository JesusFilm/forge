---
title: "next/link's own props are unobservable in tests — three ways a Watch link assertion passes vacuously"
date: 2026-09-12
category: best-practices
module: apps/web
problem_type: best_practice
component: testing_framework
root_cause: inadequate_test_property
resolution_type: test_fix
severity: high
applies_when:
  - Asserting on a next/link prop the framework consumes rather than spreads (prefetch, replace, scroll, shallow, onNavigate)
  - Asserting on a rendered href in an app that configures basePath
  - Converting a raw <a> to next/link, or reviewing a diff that could be reverted with one line
  - Mocking next/link at all, in any apps/web, apps/chat, or apps/admin suite
  - Reaching for a dev-server browser session to confirm prefetch behaviour
tags:
  - testing
  - next-link
  - mocks
  - prefetch
  - basepath
  - vacuous-assertion
  - regression-pin
  - apps-web
related:
  - "docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md"
  - "docs/solutions/best-practices/base-ui-dialog-state-attribute-detection-20260520.md"
  - "docs/solutions/best-practices/nextjs-hmr-reload-breaks-stateful-browser-verification.md"
  - "docs/solutions/best-practices/wcag-contrast-guard-bound-to-variant-artifact-not-property.md"
  - "docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md"
  - docs/solutions/best-practices/whole-source-allowlist-guard-for-defects-no-gate-catches.md
---

# next/link's own props are unobservable in tests

A worked instance of
[mocked-shape-vs-real-contract-discipline](mocked-shape-vs-real-contract-discipline-20260506.md).
That META doc's rule is "the test observes the mock's shape rather than the
framework's behaviour." This is the `next/link` family of it: three separate
mechanisms, hit in a single change ([PR #2244](https://github.com/JesusFilm/forge/pull/2244),
merged), each of which makes a link assertion pass for the wrong reason.

Verified against `next@16.2.4` (`apps/web/node_modules/next/package.json`) by
reading the shipped client source, not from docs or intuition.

## Context

PR #2244 converted every Watch video card from a raw `<a>` to `next/link` —
a 2,284 ms hard navigation became a 399 ms soft one — and added an
intent-gated prefetch latch so a windowed infinite feed would not fan out
into origin renders for slugs nobody asked for.

The suite was large and green throughout. It was also, on the three things
that mattered most, incapable of going red:

- Three independent reviewers flagged the prefetch latch as untested. It was
  not an oversight — `next/link` makes the prop structurally unobservable.
- The card `href` assertions could not see the `/watch` base path, so they
  could not distinguish a correct URL from `/watch/watch/jesus.html`.
- Nothing in the suite could tell a `next/link` from the raw `<a>` it replaced,
  so the entire point of the PR was revertible in one line with no test failure.

Each trap is a different mechanism. Knowing one does not protect you from the
other two.

## Guidance

### Trap 1 — `prefetch` never reaches the DOM

`next/link` destructures its own props out and spreads only the remainder onto
the anchor:

```js
// apps/web/node_modules/next/dist/client/app-dir/link.js:100
const { href: hrefProp, as: asProp, children: childrenProp,
        prefetch: prefetchProp = null, passHref, replace, shallow, scroll,
        onClick, onMouseEnter: onMouseEnterProp, /* ... */ ...restProps } = props;

// apps/web/node_modules/next/dist/client/app-dir/link.js:371
        ...restProps,   // <- prefetch is NOT in here
```

So a suite rendering a real `Link` has no attribute, no property, and no
serialized markup that reflects `prefetch`. The same is true of `replace`,
`scroll`, `shallow`, and `onNavigate`. `renderToStaticMarkup` cannot see them
either.

**Do:** mock `next/link` and reflect the prop onto a data attribute. Assert the
three-valued result — `"false"` (explicitly disabled), `"undefined"` (default
strategy, prop absent), `null` (not a Link at all).

```tsx
vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...rest }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))
```

Prior art in this repo predates the PR:
`apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx:62-75`.
The shipped pins are
`apps/web/src/components/sections/MediaCollection.prefetch.test.tsx:23-38` and
`apps/web/src/components/home/__tests__/WatchHomeCategoryRail.prefetch.test.tsx:19-34`.

**Corollary — a dev-server browser session cannot observe prefetch either.**
Both prefetch paths are hard-disabled outside a production build, and the two
guards do not even use the same condition:

```js
// viewport path — links.js:204-209
function onLinkVisibilityChanged(element, isVisible) {
    if (process.env.NODE_ENV !== 'production') {
        // Prefetching on viewport is disabled in development for performance
        // reasons, because it requires compiling the target page.
        return;
    }

// hover path — app-dir/link.js:334
            if (!prefetchEnabled || process.env.NODE_ENV === 'development') {
                return;
            }
```

So "I hovered a card in `next dev` and saw no RSC request" proves nothing —
same family as
[nextjs-hmr-reload-breaks-stateful-browser-verification](nextjs-hmr-reload-breaks-stateful-browser-verification.md).
Prefetch posture is pinned in unit tests via the mock, or observed under
`next build` + `next start`. Nowhere else.

### Trap 2 — `__NEXT_ROUTER_BASEPATH` is read once at module load

```js
// apps/web/node_modules/next/dist/client/add-base-path.js:13
const basePath = process.env.__NEXT_ROUTER_BASEPATH || ""
```

Top level, outside `addBasePath()`. It is captured when the module is
evaluated — which, in a suite with static imports, is before the first
`beforeEach` and before any `vi.stubEnv`.

A `beforeEach` assignment or a post-import `vi.stubEnv` is therefore **inert**.
The assertion then runs against an unprefixed href and proves nothing about the
production URL — the worst failure mode, because the file reads like it is
pinning the exact thing it is blind to.

**Do:** set the env in `beforeAll` and pull the component in with a dynamic
`await import()` inside the test, so the module graph loads after the
assignment.

```tsx
beforeAll(() => {
  process.env.__NEXT_ROUTER_BASEPATH = "/watch"
})

async function renderCard(/* ... */) {
  const { MediaCollection } = await import("./MediaCollection")
  // ...
}
```

Shipped at `apps/web/src/components/sections/MediaCollection.basepath.test.tsx:23-28`.

**Do:** also stamp the pre-prefix href on the element so one assertion pair
covers both halves of the transform — the input the component hands `Link`, and
the output `Link` produces:

```tsx
// apps/web/src/components/sections/MediaCollection.tsx:779
      data-href={href}
```

```tsx
// MediaCollection.basepath.test.tsx:66-69
expect(dataHref).toBe("/jesus.html") // component hands Link a relative href
expect(href).toBe("/watch/jesus.html") // Link prepends the basePath once
expect(href).not.toContain("/watch/watch/") // ...and only once
```

**Do:** leave a comment at every _other_ suite's href expectations explaining
why they are base-path-relative, or the next person "fixes" them by re-adding
the hand-prefix that produces `/watch/watch/...` in production —
`apps/web/src/components/sections/MediaCollection.test.tsx:163-174`.

### Trap 3 — a mocked Link renders a plain `<a>`

Once `next/link` is mocked to an anchor, no `href`/`target`/`rel` assertion can
distinguish a `Link` from a raw `<a>`. A one-line revert keeps the suite green.

There is a live instance of this in the tree.
`apps/web/src/components/home/WatchHomeCategoryRail.tsx:232-259` renders two
branches on purpose — a plain anchor for `kind === "external"` (client-routing
off-site is wrong, and a new tab needs `noopener`), and a `Link` for everything
else. The test that covers the internal branch:

```tsx
// apps/web/src/components/home/__tests__/WatchHomeCategoryRail.test.tsx:334-346
it("renders an internal destination without target or rel", () => {
  expect(element?.getAttribute("href")).toBe("/partners")
  expect(element?.getAttribute("target")).toBeNull()
  expect(element?.getAttribute("rel")).toBeNull()
})
```

Change `<Link>` at line 247 to `<a>` and every one of those three assertions
still passes. The soft-navigation guarantee is unpinned.

**Do:** make the mock stamp a marker only a Link can carry, and assert it
**positionally** — present on the branches that must client-route, absent on the
branch that deliberately must not.

```tsx
expect(internalTile?.getAttribute("data-prefetch")).not.toBeNull() // is a Link
expect(externalTile?.getAttribute("data-prefetch")).toBeNull() // is a raw <a>
```

`data-prefetch` from Trap 1's mock already serves as that marker — a raw anchor
yields `null`, never `"false"` or `"undefined"`. The positive half shipped
(`WatchHomeCategoryRail.prefetch.test.tsx:84-85`,
`MediaCollection.prefetch.test.tsx:82`); the negative half — asserting the
external branch is _not_ a Link — is the gap this doc closes. Without both
halves the marker degrades into a second prefetch assertion.

**Do:** when the suite renders a _real_ Link, use Trap 2's setup as the marker
instead. Under a configured base path, `href !== data-href` is something only a
real `Link` can produce; a raw `<a href={href}>` makes them equal and the test
goes red.

## Why This Matters

The three traps share a failure mode and differ in blast radius.

Trap 2 is the expensive one. A hand-prefixed href plus `Link`'s own prepend
renders `/watch/watch/jesus.html` on **every card in every rail** — a
site-wide 404 on the primary interaction of `/watch`, shipped past a fully green
suite, invisible to review because the diff looks right and the test looks like
it pins the URL.

Trap 1 is the one reviewers can smell but not fix. Three separate reviewers on
PR #2244 asked why the prefetch latch had no test. Each would have concluded
"the author forgot." The real answer is that no unmocked suite _can_ write that
test, and without knowing that, the next attempt writes a real-`Link` render,
finds no attribute, and quietly drops the coverage again. The latch is the only
thing keeping a windowed infinite feed from prefetching every mounted card, so
losing it is an origin-load incident, not a UX nit.

Trap 3 is the cheapest to hit and the easiest to miss. The PR's entire thesis —
2,284 ms to 399 ms — rests on one JSX tag name, and nothing in ~3,950 tests
was watching it.

Division of labour with its sibling: the marker assertion here protects a
component that already has a suite, at the moment of conversion. It cannot see
a component nobody wrote a test for, or one that does not exist yet. The
whole-source scan in
[whole-source-allowlist-guard-for-defects-no-gate-catches.md](whole-source-allowlist-guard-for-defects-no-gate-catches.md)
covers the file set instead. Use both: the scan says "a raw anchor exists
here", the marker says "this specific element is the element you think it is".

The through-line, and the reason this belongs with the META doc: in all three
the assertion is on the **mock's shape** (an anchor's attributes) rather than
the **framework's behaviour** (what `Link` consumes, transforms, and gates on
`NODE_ENV`). A test can only pin behaviour it can observe, and `next/link`'s
whole value-add is invisible by construction.

## When to Apply

- **Any assertion on a `next/link` prop the framework consumes** — `prefetch`,
  `replace`, `scroll`, `shallow`, `onNavigate`. Mock and reflect, or do not
  claim coverage.
- **Any href assertion in an app with a configured `basePath`** (`apps/web` has
  `/watch`). Either accept base-path-relative hrefs and say so in a comment, or
  set `__NEXT_ROUTER_BASEPATH` in `beforeAll` + dynamic-import. There is no
  third option.
- **Any `<a>` to `<Link>` conversion, and any review of one.** Ask directly:
  which test goes red if this tag name is reverted? If the answer is none, the
  conversion is unprotected.
- **Any component with a deliberate mixed-element branch** (internal `Link` vs
  external `<a>`, or a non-interactive `<div>` fallback). Assert the marker
  positionally across all branches — the negative is what makes the positive
  mean something.
- **Any prefetch observation in a browser.** `next build` + `next start` only.
  A dev-server session is structurally incapable of showing it.

Applies to every Next.js app in the monorepo, not just `apps/web` — the
mechanisms are in `next` itself.

## Examples

### The discriminating cases the latch actually needs

Reflecting `prefetch` is necessary but not sufficient: three of the five pins
below would pass against a naive `onPointerEnter` latch. The two that would not
are the ones worth writing.

```tsx
// apps/web/src/components/sections/MediaCollection.prefetch.test.tsx:115-143

// Discriminates MOVEMENT from ENTRY. `pointerenter` also fires when the
// windowed feed scrolls a card under a stationary pointer, which is not
// intent — reverting onPointerMove -> onPointerEnter turns ONLY this red.
it("does not arm on pointer entry alone", () => {
  /* ... */
  expect(/* data-prefetch */).toBe("false")
})

// Discriminates the POINTER TYPE. A touch scroll drags `pointermove` across
// every card it passes, so without the hover-capable check one flick arms the
// whole rail — exactly the fan-out the latch exists to prevent.
it("does not arm on touch movement, which is scrolling rather than intent", () => {
  /* ... */
  expect(/* data-prefetch */).toBe("false")
})
```

The production latch they pin is
`apps/web/src/components/sections/MediaCollection.tsx:822-842` (the `useState`

- `event.pointerType !== "mouse"` guard) and `:869`
  (`prefetch={prefetchArmed ? undefined : false}`).

### Holding two axes apart so the fixture is not self-satisfying

Same file family, different lesson, and it was found by the same review pass.
The dub-language pin originally rendered a Spanish item inside a Spanish page,
so deleting the item-language branch fell through to the page language and
produced an identical URL. The axes are now held apart, with a companion
covering the fallback:

```tsx
// apps/web/src/components/sections/MediaCollection.basepath.test.tsx:81-109
// page language English + item dub Spanish -> only the item's own dub
// can produce this result
expect(href).toBe("/watch/jesus.html/spanish-castilian.html")

// companion: no item dub, page language Spanish -> only the page language can
expect(href).toBe("/watch/jesus.html/spanish-castilian.html")
```

### Falsification is the only proof

Every guard added in PR #2244 was falsified by reintroducing the bug it
prevents — the basepath pin by re-adding the hand-prefix, the movement pin by
restoring `onPointerEnter`, the touch pin by dropping the `pointerType` check.
For this trap family falsification is not a nicety: a vacuous link assertion is
_indistinguishable from a working one_ by reading, because the passing output is
identical. Run it red once or you have not tested it.

## Related

- [mocked-shape-vs-real-contract-discipline-20260506.md](mocked-shape-vs-real-contract-discipline-20260506.md)
  — the META home. Add a "next/link prop observability" row to its worked-instances
  table (line 115) and a `related:` entry.
- [base-ui-dialog-state-attribute-detection-20260520.md](base-ui-dialog-state-attribute-detection-20260520.md)
  — the same "you are inspecting the wrong observable" lesson for base-ui Dialogs
  (`data-open`/`data-closed`, not element presence).
- [nextjs-hmr-reload-breaks-stateful-browser-verification.md](nextjs-hmr-reload-breaks-stateful-browser-verification.md)
  — the companion for browser-side verification: `next build` + `next start`,
  never `next dev`.
- [wcag-contrast-guard-bound-to-variant-artifact-not-property.md](wcag-contrast-guard-bound-to-variant-artifact-not-property.md)
  — same `root_cause: inadequate_test_property`, a guard bound to a rendered
  artifact rather than the property it meant to hold.
- [nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md](nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md)
  — the adjacent URL-contract drift class across builders, tests, and middleware.
- [PR #2244](https://github.com/JesusFilm/forge/pull/2244) — merged; the squash
  rewrote the branch SHAs, so cite the PR rather than a commit.
- Plan: `docs/plans/2026-09-09-1733-fix-watch-client-side-navigation-plan.md`
