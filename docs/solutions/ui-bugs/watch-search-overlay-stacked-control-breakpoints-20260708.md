---
title: "Watch search overlay stacked controls need one breakpoint contract"
date: "2026-07-08"
category: "ui-bugs"
module: "apps/web watch search overlay"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "At intermediate widths, the search field and language selector stacked into two rows while the mobile logo and close button used the desktop layout."
  - "Search results could start underneath the language selector in the stacked-but-wide layout."
  - "The close button could visually intrude into the connected language selector at small desktop widths."
  - "The reset X inside the language selector kept dark-overlay styling after the selector became a white pill."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/web/src/components/SearchOverlay.tsx"
  - "apps/web/src/components/watch/LanguageCombobox.tsx"
  - "apps/web/src/components/search/VideoCard.tsx"
tags:
  [
    watch,
    search-overlay,
    responsive,
    language-selector,
    breakpoints,
    hover-preview,
  ]
---

# Watch search overlay stacked controls need one breakpoint contract

## Problem

The Watch search overlay evolved from a single search field into a paired search
field plus language selector. The controls became connected at tablet/desktop
widths and stacked at narrower widths, but the surrounding chrome and result
offsets still used older `sm` assumptions.

That left a middle-width state where the UI was neither mobile nor desktop:
the controls were stacked, the logo was hidden, the close button was positioned
like desktop chrome, and results could scroll under the language selector.

## Symptoms

- A viewport below `md` but above `sm` showed two stacked controls without the
  mobile logo.
- The close button appeared too high or too close to the language selector
  depending on the exact width.
- Results began underneath the second control because `.search-overlay-scroll`
  reduced its top offset at `sm`, before the controls actually joined into one
  row at `md`.
- When the semantic language override was active, the reset X inside the
  language selector had light-on-dark styling even though the selector had
  changed to a white pill.
- At some connected widths, the language selector and close button shared too
  little horizontal space, making the close button feel like it belonged inside
  the selector.

## What Didn't Work

- **Changing only the control row.** Making the search field and language
  selector share one line at `md` solved the primary layout goal, but it left
  logo visibility, close positioning, and result offsets on `sm` breakpoints.
- **Keeping the selector visually standalone on mobile.** Once the desktop
  selector became a white connected surface, the dark mobile selector looked
  like a different component rather than the same control stacked underneath.
- **Relying on fixed `max-w-[810px]` near the close button.** At small desktop
  widths, centering the whole row could leave the selector edge too close to
  the close button.
- **Preserving only static poster changes during the `origin/main` merge.**
  Session history noted that Admin image URL changes must not suppress Mux hover
  previews; the conflict resolution needed to keep both the blur placeholder
  work and the `MuxHoverPreview` path.

## Solution

Treat the search controls, logo, close button, and result scroll body as one
responsive system with one breakpoint contract:

- Below `md`, show the mobile logo and keep the search field and language
  selector stacked as matching white rounded pills.
- At `md` and wider, hide the logo and connect the two controls into a single
  white pill with a subtle divider.
- Keep result offsets tall until `md`, because below `md` there are two control
  rows.
- Keep the connected row left-aligned with a safe max width until `xl`, so the
  close button keeps its own lane at tablet and small desktop widths.

```tsx
const searchOverlayScrollTopClass = queryLanguageSuggestion
  ? "top-72 md:top-60"
  : searchLanguageControlVisible
    ? "top-60 md:top-48"
    : "top-44 md:top-32"
```

Use the same breakpoint for the logo and close button:

```tsx
<Link className="... md:hidden" />

<WatchModalViewportCloseButton
  positionClassName="top-6 right-4 translate-y-2 md:top-12 md:right-10 md:translate-y-0"
/>
```

Use scoped combobox trigger overrides so the shared `LanguageCombobox` can
remain dark/standalone in subtitle dialogs while the search overlay adopts the
white search-control surface:

```tsx
const semanticLanguageTriggerClassName = [
  "!h-[52px] !min-h-[52px] !rounded-[35px] !border-0 !bg-white !text-stone-950 shadow-xl",
  "md:!rounded-l-none md:!rounded-r-[35px] md:!border-l md:!border-stone-200 md:!shadow-none",
  semanticLanguageOverrideActive ? "pr-14" : null,
]
  .filter(Boolean)
  .join(" ")
```

Finally, preserve the media layering contract on search result cards: the
static image/blur placeholder layer may change independently from the Mux
animated hover preview. The card should keep the red outline overlay above both
layers and still mount `MuxHoverPreview` when `playbackId` exists.

## Why This Works

The bug was not a single bad class; it was inconsistent ownership of the
responsive state. The controls moved to a `md` contract, but the supporting
chrome still assumed `sm`. Aligning all dependent surfaces to the same
breakpoint removes the in-between state entirely.

The result offset fix follows the same rule. The scroll body only gets the
shorter top offset when there is one row of controls. When there are two rows,
it reserves enough vertical space for both pills.

The safe-width rule protects the close button at widths where the connected
control is present but the viewport is not wide enough to center an 810px row
comfortably:

```tsx
className = "md:mx-0 md:max-w-[calc(100vw-11rem)] xl:mx-auto xl:max-w-[810px]"
```

That keeps the right edge of the language selector away from the fixed close
button without sacrificing the centered desktop layout on wide screens.

## Prevention

- When a responsive control changes layout at a breakpoint, search for every
  dependent breakpoint: logo visibility, close button position, result offsets,
  dropdown width, and mobile-only spacing.
- Verify live geometry at the edge widths, not only canonical mobile/desktop:
  `700px`, `768px`, `900px`, `1024px`, and one wide desktop width.
- For shared components like `LanguageCombobox`, prefer scoped override props
  at the call site over changing the base component's visual language globally.
- Add tests that assert breakpoint class contracts (`md:top-*`, `md:hidden`,
  connected-row classes), then use browser geometry checks for pixel-level
  clearance that jsdom cannot prove.
- During merges that touch card media, preserve separate responsibilities:
  poster source, blur placeholder, animated Mux preview, and hover outline each
  need their own layer.

## Related Issues

- [Next.js Search Overlay UI — Patterns and Pitfalls](../best-practices/nextjs-search-overlay-ui-patterns-20260415.md)
- [Watch semantic search must wait for language metadata before query-language confirmation](watch-semantic-search-language-metadata-confirmation-race.md)
- [Admin image enrichment with localized metadata and durable human overrides](../best-practices/admin-image-enrichment-localized-media-workflow-20260504.md)
