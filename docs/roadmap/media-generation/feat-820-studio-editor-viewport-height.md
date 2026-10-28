---
id: "feat-820"
title: "Fit the Studio editor to the window height"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-19"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

Fix whole-window vertical scrolling on the short editor. Relevant code:
`apps/manager/src/features/video-studio/studio.css`, Manager shell markup in
`apps/manager/src/features/shell/manager-shell.tsx`, shared shell styles in
`apps/manager/src/app/globals.css`.

## Reproduction

Using the actual shell and editor CSS, a 720px viewport produces a 769px document:
the breadcrumb occupies 68px, the editor enforces a 700px minimum, and the shell
adds a bottom border. Measure document scrollHeight against innerHeight.

## Constraints and verification

Scope layout changes to the mounted editor. Preserve scrolling on other pages,
inside the inspector, timeline and sidebar, and in asset dialogs. Use CSS layout
without resize listeners or additional initialization. Check multiple viewport
sizes, collapsed sidebar and short windows; run format and whitespace checks.

## Result and verification evidence

Scoped the shell to `100dvh` only when it contains `.nle-editor`. Grid rows
allocate the remaining height after the real breadcrumb header, including the
stacked navigation below 900px. Removed the editor's 700px and workspace's 290px
minimums. Timeline height is bounded to half of the editor, with its own scroll
area. Sidebar and inspector retain internal scrolling.

Browser measurements using the actual shell/editor styles:

- Before: 1280×720 viewport, document height 769px.
- After: document height equals viewport height at 1280×720, 1280×600,
  800×600 and 1440×900, including collapsed sidebar.
- With overflowing panel fixtures at 1280×600, inspector scrollHeight 1428px
  versus clientHeight 196px; timeline 900px versus 222px. Document remains 600px.

Prettier and diff whitespace checks pass. The running real Manager preview
recompiled the CSS successfully. This is CSS-only: no added JavaScript, requests,
resize listeners, hydration or media initialization. Native grid sizing avoids
measuring header heights in JavaScript. Browser fixture remains a temporary
internal diagnostic; the shared preview continues to run the actual application.

## Durable layout rule

Editor workspaces should fill the shell's remaining grid row with `min-height: 0`.
Do not subtract a guessed header height from `100vh` or impose a fixed desktop
minimum on the editor root. Scope viewport constraints so document-style pages
keep their normal page scrolling.
