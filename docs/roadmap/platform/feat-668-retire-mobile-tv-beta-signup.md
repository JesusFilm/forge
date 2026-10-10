---
id: "feat-668"
title: "Retire mobile and TV beta program signup"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags: [mobile, tv, platform]
---

## Problem

The owner confirmed the beta testing program has ended. During the Watch web retirement review (feat-667 / PR #2678), Claude Code found separate mobile and TV signup surfaces still pointing to the retired program. This follow-up records that remaining scope; it does not claim these apps were changed by the Watch PR.

## Entry Points — Read These First

- `apps/mobile/CLAUDE.md` and `apps/tv/CLAUDE.md` — package guidance.
- `apps/mobile/src/components/home/HomeMissionSection.tsx` — beta mission card and external signup action.
- `apps/tv/src/components/home/QrPanel.tsx` — signup label and QR code.
- Search mobile and TV source for `BETA_SIGNUP_URL`, `BETA_CTA_LABEL`, `mailchi.mp/jesusfilm/beta`, and beta actions before implementing.
- Mobile's beta button also hosts a push test-ID reveal; inspect `apps/mobile/src/lib/push/testIdReveal.ts` and callers so removal does not strand useful diagnostics.

## What To Build

Remove retired signup entry points from mobile and TV, including mission cards, signup actions, and QR panels. Preserve unrelated ministry content, navigation, and any diagnostic functionality still required by active app workflows. Audit callers and focus/layout behavior before removing components or constants.

## Verification

Run affected app tests, typechecks, lint, formatting, and PR checks. Verify mobile homepage and mission screens have no signup action. Verify TV homepage has no retired signup QR code and remote focus navigation still works. Check page-loading performance for affected frontend initialization or rendering changes.
