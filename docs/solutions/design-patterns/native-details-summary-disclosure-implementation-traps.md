---
title: "Native <details>/<summary> disclosure UI: line-clamp, select-to-copy, and jsdom testing traps"
date: "2026-07-20"
category: "design-patterns"
module: "apps/chat"
problem_type: "design_pattern"
component: "frontend_stimulus"
severity: "medium"
applies_when:
  - "Building a collapsed/expandable disclosure with native <details>/<summary> instead of a JS-driven accordion"
  - "Pairing a Tailwind line-clamp utility (e.g. line-clamp-3) with another display utility (block, inline-block, flex) on the same element"
  - "Rendering copyable snippet or citation text inside a <summary> element"
  - "Writing jsdom/RTL tests against <details>/<summary> toggle state, scrollIntoView, or CSS.escape in this repo's vitest environment"
  - "Choosing whether open-state presentation needs a React hook or can live entirely in CSS (Tailwind group-open variants) on an empty-body <details>"
symptoms:
  - "A `line-clamp-3` class combined with a `block` display utility on the same element still computes `webkitLineClamp: 3` via getComputedStyle, but renders the full unclamped text — jsdom class-presence assertions stay green while the clamp is visually defeated"
  - "Drag-selecting text inside an expanded `<summary>` collapses the disclosure, because Chrome fires a click once the mouseup ends the selection — summary activation is that click's default action"
  - "`HTMLElement.prototype.scrollIntoView` is entirely absent in jsdom 26 and throws if called unguarded"
  - "A cross-model reviewer flagged `CSS.escape` as a jsdom crash risk, even though the composed test environment supplies it via @testing-library/jest-dom's css.escape polyfill (raw jsdom has no window.CSS)"
related_components:
  - "apps/chat/src/components/chat/sources-list.tsx"
  - "apps/chat/src/components/chat/sources-list.test.tsx"
tags:
  - "chat"
  - "disclosure"
  - "details-summary"
  - "line-clamp"
  - "tailwind-v4"
  - "jsdom"
  - "select-to-copy"
  - "real-browser-verification"
---

# Native `<details>`/`<summary>` disclosure UI: line-clamp, select-to-copy, and jsdom testing traps

> Merge state: this work is uncommitted on branch `feat/chat-sources-presentation` as of this writing (2026-07-20) and ships with feat-269's PR (not yet opened). All file:line citations reference that worktree tree; re-verify line numbers after merge.

## Context

feat-269 rebuilt the chat sources presentation as a collapsed-by-default "Sources · N" disclosure (`apps/chat/src/components/chat/sources-list.tsx`), with each source's snippet clamped to three lines behind its own per-source `<details>` disclosure. An early draft of this session's work put `className="line-clamp-3 block text-ash …"` on the snippet span — and that `block` silently killed the clamp. (This was an intra-session draft state, never committed: the pre-feature tree had no clamp at all.) Snippets rendered fully expanded (~6 lines; session-measured in headless Chromium: 120px visible height equal to `scrollHeight` — nothing cut off) while every jsdom test asserting the clamp class stayed green. `getComputedStyle` showed the contradiction directly: `webkitLineClamp` was `"3"` but `display` was `"block"` — and `-webkit-line-clamp` is inert unless the box is a `-webkit-box`.

Two verification instincts failed before the browser check caught it:

- **Asserting the clamp via class presence in jsdom.** `expect(snippet).toHaveClass("line-clamp-3")` was the draft's only verification and it passed against the broken UI. Class-presence assertions are mocked-shape evidence: they pin what the JSX emits, not what the browser renders — the repo's mocked-shape-vs-real-contract discipline showing up in CSS form.
- **Trusting the utility names to compose.** `line-clamp-3` and `block` read as orthogonal ("clamp to 3 lines" + "be a block box"), but both set `display`. Tailwind's `line-clamp-3` emits `overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3` — the clamp only functions when the element's display IS `-webkit-box`. A co-applied display utility overrides that, and the other three declarations sit there doing nothing, with no warning from Tailwind, TypeScript, ESLint, or jsdom.

The same feature surfaced three more native-`<details>` traps (select-to-copy collapsing the passage, an empty-body `<details>` technique that reads as a mistake, and a guarded scrollIntoView seam) plus a jsdom capability map for testing the pattern, all resolved in the same tree.

## Guidance

**Trap 1 — a display utility silently defeats `line-clamp-*`.** Remove the display utility from the clamped element; the clamp utility owns `display`. Current tree, `apps/chat/src/components/chat/sources-list.tsx:128-134`:

```tsx
{/* No `block` here: line-clamp-3 needs its own
    display:-webkit-box, which a display utility would
    override (and silently unclamp). */}
<span
  data-source-snippet
  className="line-clamp-3 text-ash group-open/snippet:line-clamp-none"
>
```

Post-fix, session-measured in headless Chromium: 60px visible height vs 120px `scrollHeight` — genuinely clamped. (The parent `<summary>` at `sources-list.tsx:126` legitimately keeps `block` — that is a different element; the rule is per-element, not "never use `block` near a clamp".)

The break is emission-order-decided: in a build where the clamp utility happens to win the cascade, the combination LOOKS fine but is a latent break on any Tailwind reorder — treat any co-applied display utility as broken regardless of which currently wins, which is why the fix removes the utility rather than relying on order.

A jsdom regression test pins the fix in the only terms jsdom can observe — the class mix, asserting the absence of every Tailwind display utility alongside the clamp (`apps/chat/src/components/chat/sources-list.test.tsx:127-156`). The denylist must stay exhaustive when copying this pattern — pinning only the historically-seen offenders guards only those regressions:

```ts
expect(snippet).toHaveClass("line-clamp-3")
const displayUtilities = [
  "block",
  "inline-block",
  "inline",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "table",
  "inline-table",
  "flow-root",
  "contents",
  "list-item",
  "hidden",
]
for (const cls of displayUtilities) {
  expect(snippet?.classList.contains(cls)).toBe(false)
}
```

**Trap 2 — select-to-copy collapses a snippet-in-summary disclosure.** The whole passage is the toggle surface (the snippet lives INSIDE its `<summary>`), so Chrome's click at the end of a drag-select that finishes inside the summary would collapse the passage the user is copying. Because summary activation is the click's DEFAULT ACTION, `preventDefault` is sufficient to cancel the toggle — no state, no stopPropagation. Current tree, `sources-list.tsx:52-58`:

```tsx
function handleSnippetSummaryClick(event: MouseEvent<HTMLElement>) {
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed) event.preventDefault()
}
```

Session-verified in headless Chromium: a click ending a text selection leaves the passage open; a plain click still toggles normally. Wire this pattern day one for any snippet-in-summary disclosure — the collapse-on-copy defect is otherwise invisible until a human tries to copy a passage.

**Trap 3 — the empty-body `<details>` technique needs its comment.** The per-snippet `<details>` (`sources-list.tsx:119-146`) has NO body content: the `<summary>` holds everything (clamped snippet + "Show full passage"/"Show less" affordance), and all open-state presentation is pure CSS off the details' `open` attribute via Tailwind group-open variants — clamp release (`group-open/snippet:line-clamp-none`) and label swap. Zero hooks, zero state — which lets the component stay outside `'use client'` per chat's convention (event handlers but no hooks inherit the importer's client context). The technique NEEDS its in-tree comment (`sources-list.tsx:120-122`: "The details body is intentionally empty…") because an empty-bodied `<details>` otherwise reads as an unfinished mistake to the next maintainer.

**Trap 4 — the scrollIntoView seam.** Opening the section at the bottom of the transcript reveals content below the fold, so the toggle handler nudges the opened details into view — behind a `typeof` guard because jsdom lacks the method entirely (`sources-list.tsx:45-50`). The test exercises the guarded branch by assigning an instance-level `vi.fn()` stub (`sources-list.test.tsx:202-216`).

**Accepted tradeoffs (recorded decisions, not bugs):**

- The summary's accessible name is the entire snippet text — screen-reader verbosity inherent to snippet-in-summary. Accepted at this scale; a future revision could move the snippet out of the summary at the cost of a larger DOM and a smaller toggle surface.
- A closed `<details>` still mounts all of its DOM eagerly. Fine at sources-per-turn scale (a handful of entries); contrast the Watch transcript case where hundreds of eagerly-mounted interactive rows were a measured cost — `docs/solutions/performance-issues/watch-transcript-eager-interactive-dom.md`.

## Why This Matters

Multi-line clamping in every current engine is the legacy `-webkit-box` mechanism: `-webkit-line-clamp` only truncates when the element's computed `display` is `-webkit-box` (with `-webkit-box-orient: vertical` and `overflow: hidden`). Tailwind's `line-clamp-*` utilities therefore emit their own `display: -webkit-box` — the utility OWNS the display property as an implementation detail its name doesn't advertise. `block` is a competing `display` declaration at identical specificity, so stylesheet order decides, and in this build `block` won: computed `display: "block"`, `webkitLineClamp: "3"` — three of the four declarations intact and the load-bearing one overridden. Removing the display utility lets `-webkit-box` stand, and the clamp engages (60px vs 120px, measured).

The select-to-copy fix works because the HTML spec routes summary activation through the click's default action — `preventDefault` on a click whose `window.getSelection()` is non-collapsed cancels exactly the toggle and nothing else, which is why no plain-click behavior changes.

Real-browser measurement is the actual contract for visual-constraint utilities: any utility whose effect is geometric (clamp, truncate, sticky, overflow, aspect) needs one browser probe before "done" — `getComputedStyle(el).display === "-webkit-box"` plus `getBoundingClientRect().height < el.scrollHeight` was the whole detection here. Same detection story as the sibling doc `docs/solutions/ui-bugs/sticky-overlay-scroll-container-pointer-events-scroll-padding.md`, where a green 418-test jsdom suite shipped two hit-testing defects.

## When to Apply

- Any native `<details>`/`<summary>` disclosure in this repo — all four traps travel together with the pattern.
- Any element combining `line-clamp-*` with other utilities — audit for a competing display utility and pin the class mix in a test.
- Any `<summary>` containing selectable text — add the selection-guarded `preventDefault` up front.
- Any jsdom test touching details toggling, scroll nudges, or `CSS.escape` — consult the capability map below rather than assuming browser parity.

**jsdom@26 capability map for native `<details>`/`<summary>` testing.** Each entry is an empirical snapshot of the COMPOSED environment as probed this session (jsdom `^26.1.0` per `apps/chat/package.json`, plus chat's vitest setup and its transitive polyfills — none of it a semver contract); re-probe an entry before trusting it after any jsdom or `@testing-library/jest-dom` version change:

- user-event `click` on a `<summary>` DOES toggle `details.open` — interaction tests work in jsdom (`sources-list.test.tsx:50-57`, `158-170`).
- Content inside a CLOSED `<details>` is NOT hidden from RTL role queries — a link inside a closed section is still findable. Do not write closed⇒hidden/`not.toBeInTheDocument` assertions; they'd be asserting jsdom behavior that isn't there. The inverse also holds: do not POSITIVELY rely on finding closed-section content — findability there is a jsdom artifact, not the browser contract (real browsers hide closed-details content from rendering and the a11y tree), so query content only in sections the test has opened.
- `HTMLElement.prototype.scrollIntoView` does not exist at all — production code needs the `typeof` guard, and tests exercise the branch via an instance-level `vi.fn()` stub.
- `CSS.escape` works in this repo's jsdom test environment ONLY because `@testing-library/jest-dom` depends on the `css.escape` polyfill, loaded via chat's `vitest.setup.ts` (`import "@testing-library/jest-dom/vitest"`) — raw jsdom 26 has no `window.CSS`, and vitest core ships no polyfill of its own. A cross-model reviewer flagged a P1 "crash" on this basis; the passing suite refuted it empirically. Corollary: capability claims about the test environment must be probed against the COMPOSED environment (test runner + setup files + transitive polyfills), not the base library's documentation.

## Examples

Before/after of the load-bearing class string on the snippet span:

```
Before (clamp silently dead):  className="line-clamp-3 block text-ash …"
After  (clamp engages):        className="line-clamp-3 text-ash group-open/snippet:line-clamp-none"
```

Measured effect in headless Chromium: before — 120px visible == 120px scrollHeight (nothing clipped); after — 60px visible vs 120px scrollHeight (three lines, clamp live).

## Related Issues

- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — META home: class-presence assertions are branch-shape evidence; the browser measurement is the production contract. This doc is the CSS-utility instance of that discipline.
- `docs/solutions/ui-bugs/sticky-overlay-scroll-container-pointer-events-scroll-padding.md` — sibling apps/chat case of jsdom-green-yet-browser-broken; both defects there were also detectable only via real-browser geometry.
- `docs/solutions/tooling-decisions/tailwind-v4-translate-utility-transition-property.md` — established local precedent for "a Tailwind utility silently clobbers a co-located CSS mechanism" (there: `translate-*` vs a narrowed transition list; here: `block` vs line-clamp's `display:-webkit-box`).
- `docs/solutions/performance-issues/watch-transcript-eager-interactive-dom.md` — the eager-mount contrast case for the "closed details still mounts its DOM" tradeoff accepted here.
- `docs/solutions/best-practices/base-ui-dialog-state-attribute-detection-20260520.md` — sibling browser-verification gotcha: component state lives on attributes (`open`, `data-open`), not on element presence or classList.
