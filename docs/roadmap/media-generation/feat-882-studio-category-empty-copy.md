---
id: "feat-882"
title: "Tailor media drop-zone copy to each category"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

Give JFP, Videos, Images and Audio their own empty-state descriptions and icons.
Explain that supported media is sorted automatically, while uploaded media never
becomes JFP catalog footage. Preserve file-type validation and existing upload
behavior. Copy/icon changes add no requests or initialization.

## Verification

Existing workspace/loading tests, formatting, lint and diff checks.

## Result

JFP explains catalog availability and where personal uploads go. Videos describes
clips, Images describes photos/stills/graphics, and Audio describes music,
voiceovers/sound effects. Each uses its category icon, a relevant heading and copy
that explains automatic sorting of other supported media. Existing type/size
validation stays authoritative. All thirteen workspace/loading tests pass; lint,
format and diff checks pass. No loading work changed.
