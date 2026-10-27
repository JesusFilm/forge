---
id: "feat-887"
title: "Release the recovered Shorts editor to production"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-10-28"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, release]
---

## Scope

Ship the recovered editor UI, media workspace, timeline controls, audio envelopes,
shared Manager sidebar and Content Pack retirement together through a reviewed
PR to main. Preserve unrelated local Watch and export work. Reconcile current
main, regenerate GraphQL artifacts and use migration 0163 after main's 0162.
Renumber the recovered roadmap tickets into 817–886 to avoid IDs already used
by newer main work. Content Pack retirement remains feat-816.

## Verification

Run affected contract, composition, Manager, Admin and Mastra checks. Verify
formatting, generated artifacts and roadmap uniqueness before push. Wait for PR
CI before squash merging; observe production deployment commit/status and health
for affected Railway services. Existing editor-loading/request-count tests and
per-feature browser evidence provide frontend loading coverage.
