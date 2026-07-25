---
title: "Keep rotating Watch hero copy out of the page heading outline"
date: "2026-07-23"
category: "ui-bugs"
module: "apps/web Watch homepage"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "The Watch homepage exposed a hidden brand H1 in addition to its authored page-topic H1."
  - "Active and thumbnail carousel titles appeared as H2 elements, so the document outline changed with the selected slide."
  - "Transitioning slides could duplicate hero titles for assistive technology."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "low"
related_components:
  - "apps/web/src/components/home/WatchHomeExperiencePage.tsx"
  - "apps/web/src/components/home/WatchHomeTvCarousel.tsx"
  - "apps/web/src/components/sections/Text.tsx"
tags:
  - "watch-page"
  - "heading-hierarchy"
  - "carousel"
  - "accessibility"
  - "seo"
---

# Keep rotating Watch hero copy out of the page heading outline

## Problem

The Watch homepage carousel owned a visually hidden brand H1, rendered its
active title as H2, and repeated every thumbnail title as H2. That made a
rotating widget compete with the stable, descriptive H1 authored in the
Experience content and added non-section headings to the document outline.

## Symptoms

- Server and hydrated markup could expose more than one H1.
- Selecting a hero slide changed the first H2 in the page outline.
- Thumbnail titles repeated as sibling headings even though their buttons
  already had complete accessible names.

## What Didn't Work

- Pointing the carousel at the visible title with `aria-labelledby` worked
  during normal playback, but the title unmounts in full-player mode. The
  carousel then retained a dangling label reference.
- Keeping carousel titles as headings while hiding only outgoing transition
  copy still left the page outline dependent on the active slide.

## Solution

Let the authored Text block own the page-topic H1 and treat hero copy as widget
content:

- Give the always-present carousel region an `aria-label` derived from the
  localized active-slide copy.
- Let `WatchHomeExperiencePage` recursively inspect Section and Container
  content, rendering the localized page-title H1 only when no authored
  TextBlock already supplies an H1. Keep the first valid authored H1 and
  demote any later authored H1 blocks to H2.
- Render the visible active title as a paragraph while preserving its existing
  typography and animation classes.
- Keep leaving copy under `aria-hidden` and render thumbnail titles as spans
  inside the existing labelled buttons.
- Test server markup, hydrated selection changes, and full-player mode so the
  region stays named without contributing H1-H6 elements.

## Why This Works

The document outline now describes stable page sections: authored Experience
content owns the preferred page H1, with a localized page-level fallback when
that content is unavailable. Section titles remain H2 and media-card titles
remain H3. The carousel has its own accessible name that follows the active
item without turning ephemeral copy into document structure. Because the label
is owned by the region wrapper, it remains valid when the visual overlay
unmounts for full-player playback.

## Prevention

- Keep rotating, tabbed, or selected-item labels out of the document outline
  unless each item introduces a real page section.
- Make a widget's accessible-name owner persist through every visual mode.
- Test the full page composition with and without builder-authored content;
  component-isolated heading tests cannot prove the page-wide invariant.
- Test multiple authored H1 blocks so rendering order determines one stable
  page heading and additional headings are demoted.
- Cover both the normal overlay and any state that unmounts it.
- Pair deterministic DOM tests with desktop and mobile axe checks on the
  rendered page.

## Related Issues

- `FGE-20` (formerly `WAT-254`)
- `docs/roadmap/platform/feat-307-watch-home-heading-hierarchy.md`
