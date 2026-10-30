---
id: "feat-844"
title: "Keep crop numeric inputs compact"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

Give all four crop inputs a consistent compact width. Center top and bottom
inputs over the diagram instead of stretching across its grid column.

## Verification

Check computed widths in narrow and expanded inspector layouts. CSS-only change;
no rendering, initialization, media or resource-loading changes.

## Outcome

All crop inputs are 48px wide and centered within their grid cells. Browser
computed widths confirm 48px for all four fields at inspector widths 200px,
245px and 560px. Formatting and whitespace checks pass. No JavaScript or resource
loading changes.
