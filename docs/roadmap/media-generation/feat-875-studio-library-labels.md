---
id: "feat-875"
title: "Rename Studio library navigation"
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

In `apps/manager/src/features/video-studio/library.tsx`, rename Source library to
JFP Library and Shared assets to Media Library. The shared navigation definition
also supplies the content heading. Update video insertion guidance to match.

## Verification

Existing workspace tests, formatting and diff checks. Labels only; no changes
to rendering structure, initialization, media requests or loading behavior.

## Result

Navigation, headings and video guidance use the requested names. All eight
workspace tests pass; formatting and diff checks pass. No loading work changed.
