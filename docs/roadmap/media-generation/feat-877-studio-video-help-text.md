---
id: "feat-877"
title: "Remove shared video browsing help text"
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

Remove the introductory shared-video browsing paragraph from the Videos tab in
`apps/manager/src/features/video-studio/library.tsx`.

## Verification

Formatting and diff checks. Copy removal adds no initialization, requests or media
work; the existing video browsing and image/audio upload behavior stays intact.

## Result

Removed the introductory paragraph. Formatting and diff checks pass.
