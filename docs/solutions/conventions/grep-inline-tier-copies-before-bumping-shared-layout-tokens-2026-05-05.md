---
title: Grep for inline tier copies before bumping shared layout-token tuples
date: 2026-05-05
last_refreshed: 2026-05-08
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
  - "Inline `px-`/`pr-`/`pl-` ladder found in components alongside imports of the matching constant"
related_components:
  - apps/web/src/lib/content-width.ts
  - apps/web/src/components/sections/BibleQuotesCarousel.tsx
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
export const CONTENT_WIDTH_CLASSES = `${CONTENT_WIDTH_ALIGN_CLASSES} px-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12`
export const CAROUSEL_BLEED_CLASSES =
  "-mx-4 sm:-mx-6 lg:-mx-8 xl:-mx-10 2xl:-mx-12"
export const CAROUSEL_CONTENT_PADDING =
  "pl-4 sm:pl-6 lg:pl-8 xl:pl-10 2xl:pl-12"
export const CAROUSEL_END_SPACER = "w-4 sm:w-6 lg:w-8 xl:w-10 2xl:w-12"
```

The contract is: at each breakpoint (`base / sm / lg / xl / 2xl`), all four constants use the matching tier from a single ladder. Whatever the current ladder is (the snapshot above shows `4 / 6 / 8 / 10 / 12` as of 2026-05-08; PR #883 had `4 / 8 / 12 / 16 / 24`), the four constants must always agree at every breakpoint. Together they let a carousel bleed edge-to-edge while its first card aligns with the padded content edge and its last card has symmetric trailing space.

The drift hazard: a consumer of one of these constants may also inline-copy a related ladder slot — typically the trailing right-edge `pr-*` — because the slot doesn't have a constant of its own at the time of writing. Those inline copies are open-coded duplicates of the tuple's shape. They do not import the constant, so when the tuple is bumped (a new breakpoint tier added or an existing tier changed), they silently stay on the old ladder.

## Guidance

**Rule.** Before bumping any constant in the lockstep tuple in `apps/web/src/lib/content-width.ts`, grep `apps/web/src` for the OLD per-breakpoint values across all relevant Tailwind utility prefixes. Every inline match outside `content-width.ts` is a candidate drift site that must be bumped to the new ladder, even if it isn't importing the constant.

**The lockstep tuple (bibliography).**

- `CONTENT_WIDTH_CLASSES` — `px-*` on the outer content container
- `CAROUSEL_BLEED_CLASSES` — negative `-mx-*` to undo the parent's padding so the carousel can bleed to the viewport edge
- `CAROUSEL_CONTENT_PADDING` — `pl-*` on the scrolling track so the first card re-aligns with the padded content edge
- `CAROUSEL_END_SPACER` — `w-*` on a trailing spacer so the last card has symmetric trailing space matching the leading padding

**Why lockstep.** The carousel-bleed math is: outer padding (`px-N`) + negative margin (`-mx-N`) cancel to produce a viewport-width track. The track is then re-padded on the leading edge (`pl-N`) so card 0 aligns with the content edge, and a trailing spacer (`w-N`) restores symmetry. If any one of the four tiers diverges from the rest at a given breakpoint, you get visible asymmetry — first card misaligned with the surrounding content, or last card hugging/overshooting the right edge.

**The grep.** Substitute the OLD tier values (the ones being changed) into this command, run from the repo root. Tier values vary per bump — the example below uses the values being removed in the bump it documents:

```bash
# Adapt the alternation to the OLD tier values being removed in the bump.
# Example: bumping the ladder from 8/12/16/24 → 6/8/10/12, the OLD values
# leaving the tuple are 16 and 24 (8 and 12 stay):
grep -rEn "(px|pl|pr|-mx|w)-(16|24)([\s\"\`])" apps/web/src
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

**Historical drift case — BibleQuotesSection (PR #883).** `apps/web/src/components/watch/BibleQuotesSection.tsx:60` once carried an inline trailing-edge ladder mirroring `CAROUSEL_CONTENT_PADDING`:

```tsx
// Before (drifted: pr-* still on old 4/8/10 ladder while pl-* via constant moved to 4/8/12/16/24)
className={`flex w-full ... -ml-4 ${CAROUSEL_CONTENT_PADDING} pr-4 sm:pr-8 lg:pr-10 ...`}

// After PR #883 (matches the bumped tuple at the time)
className={`flex w-full ... -ml-4 ${CAROUSEL_CONTENT_PADDING} pr-4 sm:pr-8 lg:pr-12 xl:pr-16 2xl:pr-24 ...`}
```

This drift existed because BibleQuotesSection used a custom `flex` + `overflow-x-auto` scroll list rather than the shared `Carousel` component, so the `CAROUSEL_END_SPACER` slot wasn't an obvious fit and a hand-rolled `pr-*` ladder filled in. The right fix at the time was to bump the inline ladder to match the tuple. **Update (2026-05-08):** BibleQuotesSection has since been refactored to use the Embla `Carousel` primitive and now consumes `CAROUSEL_END_SPACER` as a trailing slide — it no longer carries inline tier copies. The drift incident is preserved here as the canonical illustration; the lesson generalizes to any future component that mirrors the tuple's shape inline.

**Recommended grep invocation.** Before any bump, run the grep with the OLD tier values being removed. For the May-2026 reduction from `4/8/12/16/24` to `4/6/8/10/12`, the OLD values leaving the tuple are `16` and `24`:

```bash
grep -rEn "(px|pl|pr|-mx|w)-(16|24)([\s\"\`])" apps/web/src
```

The first hits will be `content-width.ts` itself (the source of truth). Any other hit is a candidate drift site — inspect it and bump in the same commit if it mirrors the tuple's shape.

## Related

- [`docs/solutions/design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md`](../design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md) — companion design pattern. Documents the recipe for porting custom `<ul overflow-x-auto>` lists to the Embla `Carousel` primitive while preserving lockstep-tuple alignment. Eliminates the hand-rolled inline-`pr-*` drift class entirely when adopted.
- [`docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md`](../best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md) — strong sibling pattern: when a cross-cutting contract changes, grep for inline copies at every quote-site. This doc is the layout-token specialization of the same general rule.
- [`docs/solutions/developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md`](../developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md) — companion same-session learning: use Chrome-MCP `getBoundingClientRect` measurement (not eyeballing) when iterating on shared layout. Complementary; this doc covers the _change-time_ check, that doc covers the _iterate-time_ check.
- [`docs/solutions/design-patterns/always-render-cta-section-with-placeholder-row-20260505.md`](../design-patterns/always-render-cta-section-with-placeholder-row-20260505.md) — same-session learning on a different concern (always-render CTA with placeholder fallback). Cross-references the same `WatchBody` and `BibleQuotesSection` files.
- PR #883 — `feat(web): widen watch-page gutters and inter-column gap` — the change that surfaced this drift class.
