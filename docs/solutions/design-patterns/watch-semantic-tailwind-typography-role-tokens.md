---
title: "Use semantic Tailwind typography tokens for Watch roles"
date: "2026-07-22"
category: "design-patterns"
module: "apps/web"
problem_type: "design_pattern"
component: "frontend_stimulus"
severity: "low"
applies_when:
  - "A typography adjustment applies to the same role across generated Watch and authored Experience content"
  - "Two text roles share a value now but must remain independently adjustable"
  - "A browser-selected element may be owned by more than one shared renderer family"
tags:
  - "watch-page"
  - "experience"
  - "tailwind"
  - "typography"
  - "semantic-tokens"
  - "media-cards"
  - "design-system"
related_components:
  - "WatchHomeCard"
  - "MediaCollection"
  - "WatchHomeSection"
  - "Watch section styles"
---

# Use semantic Tailwind typography tokens for Watch roles

## Context

A design adjustment to a card visible on `/watch` can cross more ownership
boundaries than its DOM suggests. Authored Experience cards render through
`MediaCollection`, while generated Watch rails render through `WatchHomeCard`.
Section eyebrows are similarly split between authored section components,
generated home sections, and shared synthetic Watch-section styles.

Changing only the component first suggested by a route name leaves visually
equivalent content on the same page with the old typography. Conversely,
replacing every uppercase tracking utility would affect buttons, badges,
promotional copy, and other roles that are not section eyebrows.

## Guidance

Define design values as semantic Tailwind theme tokens, then migrate every
confirmed owner of that semantic role:

```css
@theme {
  --font-weight-media-card-title: 500;
  --tracking-media-label: 0.2px;
  --tracking-eyebrow: 0.2px;
}
```

Keep equal-valued roles separate. `tracking-media-label` and
`tracking-eyebrow` both resolve to `0.2px`, but they represent different
content hierarchies and may diverge later without another renderer-wide
migration.

Use this ownership map before editing:

- Authored Experience card label and title: `MediaCollection`'s `VideoCard`.
- Generated Watch-home card label and title: `WatchHomeCard`.
- Authored Experience section eyebrows: the section components that render
  category or eyebrow copy, including `MediaCollection`, `Text`,
  `RelatedQuestions`, `BibleQuotesCarousel`, and `CarouselVideo`.
- Generated home and synthetic Watch eyebrows: `WatchHomeSection` and the
  shared Watch section-eyebrow class.

Treat the token as viewport-independent unless the design explicitly assigns
different responsive values. A viewport supplied with a visual annotation is
proof context, not automatically a breakpoint rule.

## Why This Matters

Tailwind class strings have no type-level relationship. Local `font-bold`,
`tracking-wider`, and arbitrary tracking utilities can drift even when they
represent the same design-system role. Semantic utilities make the approved
value searchable and central without collapsing distinct renderer or content
ownership boundaries.

Role-based scope also prevents accidental global restyling. Buttons, status
badges, hero labels, and promotional microcopy may intentionally use other
tracking values; sharing uppercase text does not make them section eyebrows.

## When to Apply

- A design annotation says to update all cards, labels, or eyebrows similar to
  the selected element.
- Authored Experience content and generated Watch content render together.
- More than one component family expresses the same typography role with local
  utilities.
- The change must preserve layout, routing, media behavior, and authored copy.

## Examples

Before, equivalent roles encode unrelated implementation values:

```tsx
<div className="font-semibold tracking-wider uppercase">{label}</div>
<h3 className="font-bold">{title}</h3>
<p className="tracking-[0.18em] uppercase">{eyebrow}</p>
```

After, renderers name the role they own:

```tsx
<div className="font-semibold tracking-media-label uppercase">{label}</div>
<h3 className="font-media-card-title">{title}</h3>
<p className="tracking-eyebrow uppercase">{eyebrow}</p>
```

Before declaring the migration complete, grep both the new tokens and the old
inline values. Inspect every old-value hit semantically rather than replacing
it mechanically:

```bash
rg -n 'tracking-eyebrow|tracking-media-label|font-media-card-title' \
  apps/web/src/components/{home,sections,watch}

rg -n 'tracking-wider|tracking-\[[^]]+\]|font-bold' \
  apps/web/src/components/{home,sections,watch}
```

Focused component tests can lock which semantic utility each shared renderer
uses. Browser proof must then confirm the compiled result on representative
authored and generated content: computed `font-weight: 500` for card titles,
computed `letter-spacing: 0.2px` for labels and eyebrows, no horizontal
overflow, and no console errors.

## Related

- [Keep Watch media collection authored copy above media](../ui-bugs/watch-media-collection-authored-copy-order.md)
- [Watch authored carousel variants must render as horizontal rails](../ui-bugs/watch-authored-media-collection-responsive-card-density.md)
- [Grep for inline tier copies before bumping shared layout-token tuples](../conventions/grep-inline-tier-copies-before-bumping-shared-layout-tokens-2026-05-05.md)
- [Embla Carousel bleed-alignment port pattern](embla-carousel-bleed-alignment-port-pattern-20260508.md)
- [Web video thumbnails use one shared white interaction frame](web-video-thumbnail-white-interaction-frame.md)
- [GitHub issue #1647: Optional-state matrix never asserts category labels](https://github.com/JesusFilm/forge/issues/1647)
