---
title: "Localized Watch inventories use delegated, on-demand English assistance"
date: "2026-08-05"
category: "design-patterns"
module: "apps/web/watch-language-inventory"
problem_type: "design_pattern"
component: "frontend_stimulus"
severity: "medium"
applies_when:
  - "A localized server-rendered surface needs optional English operator guidance without replacing its primary locale"
  - "A dense list or grid needs hover and focus help without hydrating one tooltip per item"
  - "Touch activation must navigate on the first tap while still offering an explicit help surface"
  - "English help must remain usable in non-Latin, RTL, narrow, or zoomed layouts"
related_components:
  - "LanguageInventoryPage"
  - "LanguageCollectionSwitcher"
  - "EnglishAssistTooltipController"
  - "EnglishAssistGuide"
tags:
  [
    watch,
    localization,
    english-assistance,
    tooltip,
    accessibility,
    hydration,
    rtl,
    touch,
  ]
---

# Localized Watch inventories use delegated, on-demand English assistance

## Context

Watch language inventories serve seekers in their own language and script, but
English-speaking ministry users also work across many of those inventories.
Changing the interface back to English would undermine localized discovery and
repeat the same unreadable-interface problem for the primary audience.

The inventory therefore keeps localized visible text, routes, and accessible
names authoritative while exposing optional English action and state guidance.

## Guidance

### Keep English supplementary

- Preserve localized text and existing accessible names. English help must not
  replace `aria-label` or introduce persistent bilingual descriptions.
- Annotate inventory-owned elements with the typed attributes returned by
  `englishAssistAttributes(token)`. The compact token prevents repeated English
  strings in rendered markup; the `title` remains a no-JavaScript fallback.
- Do not add `tabIndex` to structural labels or status badges. They can explain
  themselves on pointer hover without becoming extra keyboard stops.
- Annotate a card as an action only when it really has a route. Static cards do
  not claim to open a video or collection.

```tsx
<Link
  href={localizedRoute}
  aria-label={localizedTitle}
  {...englishAssistAttributes("openVideo")}
>
  {localizedContent}
</Link>
```

### Keep hydration constant

Mount one `EnglishAssistTooltipController` and one `EnglishAssistGuide` per
inventory page. Cards, controls, badges, and labels stay server-rendered markup
with static attributes. The controller uses document-level event delegation and
renders at most one tooltip portal, so help does not add client roots, listeners,
or requests as item count grows.

Attach resize and captured-scroll listeners only while help is visible, and
coalesce positioning in `requestAnimationFrame`. On teardown or a disconnected
target, cancel pending work, remove listeners, close the tooltip, and restore
the target's exact original `title` value.

### Separate pointer, keyboard, and touch behavior

- Mouse and pen hover show the delegated tooltip. A transparent eight-pixel
  bridge keeps it visible while the pointer crosses the target-to-tooltip gap.
- Keyboard interaction enables focus help. Escape dismisses only the tooltip
  and leaves focus on its control.
- Pointer down dismisses visual help before activation, preventing a focus
  tooltip from flashing above an opened dialog.
- Touch hover is ignored. Never consume a video's or collection's first tap to
  reveal help; the separate `EN` guide is the touch help surface.

Suppress the native pointer tooltip only while the custom pointer tooltip is
active. Set `title=""`, rather than removing the attribute, so a titled ancestor
cannot leak a second native tooltip. Restore the exact original value when the
pointer leaves, activation starts, Escape is pressed, the target changes, or
the controller unmounts.

### Keep overlays readable and inside the viewport

Render tooltip and guide content with `lang="en" dir="ltr"`, including inside
an RTL inventory. Give the tooltip max-content width capped by the narrow
viewport, measure it after mounting, choose the side with room, and clamp it to
viewport padding.

The `EN` guide uses the shared Base UI dialog wrapper for focus containment,
Escape and backdrop dismissal, bounded mobile scrolling, and focus return. A
compact centered informational dialog keeps its close control inside and
relative to the popup; the viewport-fixed Watch close-button pattern remains
for full-screen or action-oriented modal surfaces.

## Why This Matters

Replacing localized semantics with English optimizes for operators by making
the primary experience less usable for seekers. Persistent English accessible
descriptions also force bilingual speech on users who did not ask for it.

Per-card tooltip components scale hydration and event work with inventory size.
Static tokens plus one delegated controller keep the assistance layer bounded:
one controller, one guide, one active overlay, and no parallel English metadata
query. Modality-specific behavior also avoids hover-only keyboard exclusion and
touch tooltips that steal navigation's first tap.

## When to Apply

- Localized dense inventories with a secondary operator audience
- Controls that already have correct localized names but need a short visual
  English explanation
- Pages where guidance must survive narrow, zoomed, non-Latin, and RTL layouts
- Surfaces where touch activation must remain immediate

Do not use this pattern when English is the primary interface language, help
must be announced automatically to every assistive-technology user, or help
contains interactive controls. Use explicit localized content or a disclosure
surface in those cases.

## Verification

Component tests should preserve localized copy, names, destinations, and
callbacks while covering focus and hover handoff, Escape, touch first
activation, exact title restoration, ancestor-title blocking, bridge crossing,
disconnected-target cleanup, collision clamping, and animation-frame
repositioning.

Browser proof for the initial implementation covered:

- Latin-script desktop, Arabic RTL, Russian mobile at 320 by 568 CSS pixels,
  compact RTL landscape, and 200 percent page zoom
- Hover persistence, keyboard focus, Escape, guide focus return, and first-tap
  navigation
- No horizontal overflow or overlay escape
- No fetch or XHR added by assistance
- The same two assistance roots and script graph for sparse and dense inventory
  fixtures

## Related

- [Watch language picker, player chrome fade, and measured episode rail overlap](watch-language-player-chrome-layout-20260609.md)
  — the separate multilingual-control pattern for global/player controls.
- [Watch Localized Index + Flat Admin Read Model](../architecture-patterns/watch-localized-index-flat-admin-read-model-20260616.md)
  — the data boundary this client-only assistance preserves.
- [Watch staged client loading](../performance-issues/watch-staged-client-loading-20260611.md)
  — related server-content and bounded-client-initialization guidance.
- [Frontend changes require page-load performance verification](../conventions/frontend-change-page-load-performance-verification.md)
  — required request, script, and hydration proof.
- [Watch modal close buttons must remain viewport-fixed and inside the accessible dialog tree](../ui-bugs/watch-modal-close-button-viewport-accessibility.md)
  — full-screen/action modal close geometry and the compact-dialog exception.
- [Base UI dialog state attribute detection](../best-practices/base-ui-dialog-state-attribute-detection-20260520.md)
  — reliable browser assertions for guide open and close state.
