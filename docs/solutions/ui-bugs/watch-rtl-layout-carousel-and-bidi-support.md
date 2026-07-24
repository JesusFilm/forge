---
title: "Harden Watch RTL layout, carousel, bidi, and media controls"
category: "ui-bugs"
module: "apps/web"
problem_type: "ui_bug"
component: "frontend_stimulus"
severity: "high"
symptoms:
  - "RTL controls and text could appear on the wrong logical edge."
  - "Carousel keyboard, wheel, and drag behavior could disagree with RTL visual movement."
  - "Mixed-script labels and queries could reorder or truncate their leading content."
  - "Timeline and volume value axes could disagree with pointer and keyboard behavior."
  - "Compact landscape rails could lose safe-area gutters or overflow horizontally."
root_cause: "logic_error"
resolution_type: "code_fix"
tags:
  - "watch"
  - "rtl"
  - "i18n"
  - "bidi"
  - "embla"
  - "carousel"
  - "media-controls"
  - "accessibility"
date: "2026-07-23"
related_components:
  - "apps/web/src/app/[locale]/[htmlLang]/layout.tsx"
  - "apps/web/src/components/DirectionProvider.tsx"
  - "apps/web/src/components/ui/carousel.tsx"
  - "apps/web/src/lib/bidi.ts"
  - "apps/web/src/lib/content-width.ts"
  - "apps/web/src/components/watch/HeroPlayerControls.tsx"
---

# Harden Watch RTL layout, carousel, bidi, and media controls

## Problem

Watch emitted the correct root `lang` and `dir`, but descendants still encoded
physical left-to-right assumptions. On Arabic routes this could put controls on
the wrong edge, make carousel input disagree with visual order, reorder
mixed-script labels, truncate the beginning of Latin text, or let RTL
inheritance reverse the meaning of media value axes.

## Symptoms

- Previous/next controls, chevrons, text, and affordances could appear on the
  wrong logical edge.
- Carousel keys, horizontal wheel gestures, and physical drags could move
  opposite the expected RTL visual direction.
- Arabic/Latin names and queries could reorder punctuation or truncate the
  beginning of a label.
- Timeline and volume fills, pointer geometry, and keyboard meaning could
  disagree after inheriting RTL.
- Narrow or notched landscape layouts could lose the correct gutters or
  overflow horizontally.

## What Didn't Work

- Setting only `<html dir="rtl">` left client primitives without the
  server-resolved direction before hydration.
- Reversing slide arrays could make the rail look correct while corrupting
  semantic index, href, route, and selection identity.
- Passing RTL only to Embla left keys, wheel deltas, controls, icons, and
  gutters under conflicting direction rules.
- Mechanically replacing every physical CSS rule would break intentional media
  crop points, overlay corners, safe-area insets, and value-axis math.
- Applying Unicode isolation at data ingress would leak invisible controls into
  requests, slugs, analytics, persistence, and filenames.
- Mocked carousel callbacks did not prove real drag direction or stable item
  identity; Chromium-only geometry did not cover mobile WebKit.

## Solution

### Seed direction once at the root

The locale layout remains the only direction owner. It resolves
`textDirectionForLocale(htmlLang)`, writes the same value to `<html dir>`, and
seeds `DirectionProvider`. Client components consume that immutable value
without importing locale catalogs or maintaining a second locale store.

Keep `DirectionContext`'s standalone default LTR. Shared components rendered
outside the locale layout retain their previous behavior, while all Watch
routes receive the explicit server value before hydration.

### Give Embla and carousel chrome one contract

The shared `Carousel` passes the inherited direction to Embla and exposes it
through carousel context. Direction then controls:

- horizontal key and wheel interpretation;
- previous/next button placement and chevron orientation;
- logical leading gutters and the real trailing spacer.

Previous and next continue to mean lower and higher document index. Do not
reverse slide arrays, hrefs, route identity, or optimistic selection state.
Keep the bleed, content padding, item gap, viewport clipping, and spacer
lockstep described in
`docs/solutions/design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md`.

### Separate display isolation from raw values

Use `<bdi>` or `dir="auto"` for standalone dynamic labels. Use
`isolateBidiDisplayText()` only where a dynamic value is interpolated into
localized visible or accessible copy.

Never reuse an isolated string for:

- search requests;
- slugs, hrefs, or selection keys;
- analytics or persistence;
- download filenames.

The helper deliberately documents this boundary because Unicode isolation
controls are invisible and otherwise easy to leak.

### Keep media value axes LTR

The player control row follows the page direction. The timeline slider, time
values, and volume slider are named LTR islands because their pointer math,
fills, previews, and keyboard increments are chronological or magnitude axes.

Do not convert their fill/thumb positioning to logical CSS. ArrowRight remains
forward/increase and ArrowLeft remains backward/decrease in both page
directions. This preserves the custom React chrome ownership documented in
`docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`.

## Why This Works

1. Client carousels could not consume the server-resolved document direction,
   so Embla and custom keys, wheel gestures, controls, and icons did not share
   one direction contract.
2. Reading-order layout used physical left/right utilities instead of logical
   inline utilities.
3. Dynamic names and queries were interpolated without isolating their own text
   direction.
4. Timeline and volume geometry was left-origin math but inherited page RTL.

The server-seeded context gives the document, hydration, Embla geometry, and
custom inputs one direction source. Logical layout rules follow reading order,
while explicitly documented physical islands preserve viewport and value-axis
math. Isolating only final presentation boundaries lets the bidi algorithm
render mixed scripts safely without changing application data.

## Verification

### Automated

- Full Web suite: 154 files, 2,448 passing tests, 2 existing todos.
- Web typecheck passed.
- Web lint passed after formatting the final changed test.
- Production Next build compiled, typechecked, collected page data, generated
  static pages, and pruned ISR output. Local sitemap generation logged the
  expected unavailable-local-Admin warning.

### Browser

Arabic inventory:
`/watch/arabic-modern-standard.html/videos`

- Chromium desktop and 390 x 844 mobile emitted `lang="ar"` and `dir="rtl"`.
- WebKit at 390 x 844 emitted `lang="ar"` and `dir="rtl"`, initialized the
  carousel in RTL, rendered 721 `<bdi>` boundaries, and measured
  `scrollWidth === clientWidth === 390`.
- A real RTL carousel preserved document-order hrefs. ArrowLeft and a rightward
  pointer drag advanced to the higher semantic index; ArrowRight returned to
  the first item.
- Search kept the Latin query `Jesus` raw and computed the input LTR inside the
  RTL page; the clear control stayed at logical end.
- Language and download modals opened without document overflow. Adding
  `dir="auto"` to the selected mixed-script language label preserved its
  beginning under mobile truncation.

Arabic video:
`/watch/jesus.html/arabic-modern-standard.html`

- Player chrome computed RTL while timeline, time, and volume computed LTR.
- Timeline ArrowRight changed 88 to 93 and ArrowLeft restored 88.
- Browser page-error collections were empty. The console contained only
  development messages and the known local Admin route-manifest 503 warning.

English inventory:
`/watch/english.html/videos`

- Root and carousel remained LTR with the same item order and no overflow.
- ArrowRight advanced to the next semantic item.

### Loading performance

Five cold local Chromium contexts compared the same baseline and changed routes:

| Route             | Baseline median LCP | Changed median LCP | Difference |
| ----------------- | ------------------: | -----------------: | ---------: |
| Arabic inventory  |            4,840 ms |           4,628 ms |      -4.4% |
| English inventory |            8,364 ms |           7,424 ms |     -11.2% |

The bounded check passed the plan's no-greater-than-10% median regression gate.

## Prevention

- Assert root direction for LTR, Arabic RTL, and script-sensitive LTR locales.
- Assert carousel options and every horizontal input branch in both directions.
- Assert semantic item/href identity separately from visual movement.
- Assert isolated display copy and unchanged raw request/selection values.
- Assert player LTR islands from the actual slider descendants, not only a
  parent class token.
- For viewer-facing RTL changes, repeat Arabic desktop/mobile geometry,
  overflow, mixed-script truncation, and a representative player interaction.

## Related Issues

- [Embla carousel bleed-alignment pattern](../design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md)
- [Watch sibling-carousel overflow containment](watch-mobile-sibling-carousel-horizontal-rubber-band.md)
- [Mux Player custom React chrome](../design-patterns/mux-player-custom-react-chrome-pattern-20260430.md)
- [Watch language picker and player chrome layout](../design-patterns/watch-language-player-chrome-layout-20260609.md)
- [Watch mobile language modal overflow](watch-mobile-language-modal-overflow-20260619.md)
- [Implementation plan](../../plans/2026-07-23-002-fix-watch-rtl-support-plan.md)
- [Roadmap ticket](../../roadmap/platform/feat-307-watch-rtl-support.md)
- [Linear FGE-42](https://linear.app/jesus-film-project/issue/FGE-42/p1-complete-right-to-left-support-across-watch)
