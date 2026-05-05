---
title: Grep for inline tier copies before bumping shared layout-token tuples
date: 2026-05-05
category: conventions
module: apps/web/shared-layout-tokens
problem_type: convention
component: rails_view
severity: low
applies_when:
  - Bumping or modifying shared layout-token tuples (responsive padding/bleed/spacer constants) in apps/web
  - Reviewing PRs that touch CONTENT_WIDTH_CLASSES, CAROUSEL_BLEED_CLASSES, CAROUSEL_CONTENT_PADDING, or CAROUSEL_END_SPACER
  - Adding a new responsive ladder breakpoint that other consumers may have inlined
symptoms:
  - Carousel right-edge visibly asymmetric vs left content padding at xl/2xl breakpoints
  - "Inline `px-4 sm:px-8 lg:px-10` (or `pr-`/`pl-` variants) found in components alongside imports of the matching constant"
related_components:
  - apps/web/src/lib/content-width.ts
  - apps/web/src/components/watch/BibleQuotesSection.tsx
  - apps/web/src/components/watch/SiblingCarousel.tsx
tags:
  - tailwind
  - design-tokens
  - responsive-design
  - cross-component-coupling
  - watch-page
  - layout
  - shared-constants
---

# Grep for inline tier copies before bumping shared layout-token tuples

## Context

`apps/web/src/lib/content-width.ts` defines a tuple of four Tailwind class constants coupled by a layout contract — every breakpoint must use the same numeric tier across all four, or carousel-bleed math breaks:

```ts
export const CONTENT_WIDTH_CLASSES = `${CONTENT_WIDTH_ALIGN_CLASSES} px-4 sm:px-8 lg:px-12 xl:px-16 2xl:px-24`
export const CAROUSEL_BLEED_CLASSES =
  "-mx-4 sm:-mx-8 lg:-mx-12 xl:-mx-16 2xl:-mx-24"
export const CAROUSEL_CONTENT_PADDING =
  "pl-4 sm:pl-8 lg:pl-12 xl:pl-16 2xl:pl-24"
export const CAROUSEL_END_SPACER = "w-4 sm:w-8 lg:w-12 xl:w-16 2xl:w-24"
```

The contract is: at each breakpoint (`base / sm / lg / xl / 2xl`), all four constants use the matching tier from `4 / 8 / 12 / 16 / 24`. Together they let a carousel bleed edge-to-edge while its first card aligns with the padded content edge and its last card has symmetric trailing space.

The drift hazard: not every consumer uses the shared `Carousel` component. Some (e.g. `apps/web/src/components/watch/BibleQuotesSection.tsx`) use a custom `flex` + `overflow-x-auto` scroll list and inline-copy the per-breakpoint ladder for one slot — typically the trailing right-edge `pr-*` — because the `CAROUSEL_END_SPACER` slot pattern doesn't fit a custom scroll layout. Those inline copies are open-coded duplicates of the tuple's shape. They do not import the constant, so when the tuple is bumped (a new breakpoint tier added or an existing tier changed), they silently stay on the old ladder.

## Guidance

**Rule.** Before bumping any constant in the lockstep tuple in `apps/web/src/lib/content-width.ts`, grep `apps/web/src` for the OLD per-breakpoint values across all relevant Tailwind utility prefixes. Every inline match outside `content-width.ts` is a candidate drift site that must be bumped to the new ladder, even if it isn't importing the constant.

**The lockstep tuple (bibliography).**

- `CONTENT_WIDTH_CLASSES` — `px-*` on the outer content container
- `CAROUSEL_BLEED_CLASSES` — negative `-mx-*` to undo the parent's padding so the carousel can bleed to the viewport edge
- `CAROUSEL_CONTENT_PADDING` — `pl-*` on the scrolling track so the first card re-aligns with the padded content edge
- `CAROUSEL_END_SPACER` — `w-*` on a trailing spacer so the last card has symmetric trailing space matching the leading padding

**Why lockstep.** The carousel-bleed math is: outer padding (`px-N`) + negative margin (`-mx-N`) cancel to produce a viewport-width track. The track is then re-padded on the leading edge (`pl-N`) so card 0 aligns with the content edge, and a trailing spacer (`w-N`) restores symmetry. If any one of the four tiers diverges from the rest at a given breakpoint, you get visible asymmetry — first card misaligned with the surrounding content, or last card hugging/overshooting the right edge.

**The grep.** Substitute the OLD tier values (the ones being changed) into this command, run from the repo root:

```bash
grep -rEn "(px|pl|pr|-mx|w)-(4|8|10)([\s\"\`])" apps/web/src
```

Treat any hit outside `apps/web/src/lib/content-width.ts` as suspect. Inspect each: if it's mirroring the bleed/padding/spacer shape, bump it to the new ladder in the same commit.

## Why This Matters

Drift in this tuple is a silent failure mode:

- **No compile signal.** Tailwind class strings are opaque to TypeScript. There is no way for the type system to know that `pr-4 sm:pr-8 lg:pr-10` is "the old shape of `CAROUSEL_CONTENT_PADDING`." A renamed constant or a deleted import would surface immediately; a value bump inside a string literal will not.
- **No lint signal.** No off-the-shelf ESLint rule understands the lockstep contract between four named constants and arbitrary inline class strings.
- **Visual-only failure.** The asymmetry can reach ~14px at the largest breakpoint (xl/2xl), which is small enough to escape casual review and large enough to look wrong on a desktop hero. It rarely shows on the developer's local viewport unless they specifically resize to `2xl`.
- **Detection is per-component.** Without a deliberate grep, the only catchers are (a) eyes-on review at every relevant breakpoint, (b) screenshot tests, or (c) a code reviewer who happens to remember the contract. None of those scale.

The grep is the cheapest enforcement mechanism available and runs in under a second. Multi-agent code review caught the BibleQuotesSection drift after the fact in PR #883; a one-line grep before the constant change would have caught it without spinning up reviewers.

## When to Apply

Run the grep and audit before any of these changes:

- Adding a new breakpoint tier to any of the four constants (e.g., introducing a `2xl:` step).
- Removing a breakpoint tier from any of the four.
- Changing the numeric value at any tier (e.g., `lg:px-10` → `lg:px-12`).
- Introducing a new constant into the lockstep tuple — it now needs the same audit going forward.
- Any future similar lockstep tuple of Tailwind class constants that consumers might inline-copy. The pattern generalises: whenever a shared layout token exists as a class-string constant AND consumers may open-code its shape, drift is possible.

Skip the grep only if the constant being changed is genuinely never inline-copied anywhere — but verify that with the grep itself, don't assume it.

## Examples

**Drift case — BibleQuotesSection.** `apps/web/src/components/watch/BibleQuotesSection.tsx:60` carried an inline trailing-edge ladder mirroring the old `CAROUSEL_CONTENT_PADDING`:

```tsx
// Before (drifted: pr-* still on old 4/8/10 ladder while pl-* via constant moved to 4/8/12/16/24)
className={`flex w-full ... -ml-4 ${CAROUSEL_CONTENT_PADDING} pr-4 sm:pr-8 lg:pr-10 ...`}

// After (matches the bumped tuple)
className={`flex w-full ... -ml-4 ${CAROUSEL_CONTENT_PADDING} pr-4 sm:pr-8 lg:pr-12 xl:pr-16 2xl:pr-24 ...`}
```

The inline `pr-*` existed because BibleQuotesSection uses a custom `flex` + `overflow-x-auto` scroll list rather than the shared `Carousel` component, so the `CAROUSEL_END_SPACER` slot wasn't an obvious fit. The right fix is to bump the inline ladder to match the tuple — or, when feasible, refactor the component to consume the constant.

**Recommended grep invocation.** Before bumping the tuple from the old `4/8/10` ladder to the new `4/8/12/16/24` ladder:

```bash
grep -rEn "(px|pl|pr|-mx|w)-(4|8|10)([\s\"\`])" apps/web/src
```

Realistic output highlighting a drift site:

```
apps/web/src/lib/content-width.ts:7:export const CONTENT_WIDTH_CLASSES   = ... px-4 sm:px-8 ...
apps/web/src/lib/content-width.ts:8:export const CAROUSEL_BLEED_CLASSES   = "-mx-4 sm:-mx-8 ..."
apps/web/src/lib/content-width.ts:9:export const CAROUSEL_CONTENT_PADDING = "pl-4 sm:pl-8 ..."
apps/web/src/lib/content-width.ts:10:export const CAROUSEL_END_SPACER      = "w-4 sm:w-8 ..."
apps/web/src/components/watch/BibleQuotesSection.tsx:60:    ... pr-4 sm:pr-8 lg:pr-10 ...
```

The first four hits are the source of truth. The last hit — an inline `pr-*` ladder in a consumer — is the drift site. Bump it in the same commit as the constant change.

## Related

- [`docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md`](../best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md) — strong sibling pattern: when a cross-cutting contract changes, grep for inline copies at every quote-site. This doc is the layout-token specialization of the same general rule.
- [`docs/solutions/developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md`](../developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md) — companion same-session learning: use Chrome-MCP `getBoundingClientRect` measurement (not eyeballing) when iterating on shared layout. Complementary; this doc covers the _change-time_ check, that doc covers the _iterate-time_ check.
- [`docs/solutions/design-patterns/always-render-cta-section-with-placeholder-row-20260505.md`](../design-patterns/always-render-cta-section-with-placeholder-row-20260505.md) — same-session learning on a different concern (always-render CTA with placeholder fallback). Cross-references the same `WatchBody` and `BibleQuotesSection` files.
- PR #883 — `feat(web): widen watch-page gutters and inter-column gap` — the change that surfaced this drift class.
