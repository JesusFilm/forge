---
id: "feat-848"
title: "Keep audio fade shading dark in both themes"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, audio]
---

## Scope

`apps/manager/src/features/video-studio/studio.css`: use the existing fixed
`#080808` palette color for `.nle-audio-fade-shade`. `--ds-black` intentionally
inverts to light ink under `:root[data-theme="dark"]`, which brightens the area
removed by the fade. Fade shading must remain dark regardless of UI theme.

## Verification

Check actual stylesheet computed fill/opacity under light and dark themes;
format/diff checks. CSS-only paint change introduces no loading, hydration,
media fetching or initialization work.

## Result

Reused fixed palette black for the shade. Browser checks confirm computed fill
`rgb(8, 8, 8)` at 0.5 opacity in both themes, even when dark theme ink resolves
to `#f0eeeb`. Formatting and diff checks pass.
