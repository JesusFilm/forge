---
id: "feat-102"
title: "Manager Agents Modal Mobile Typography Tightening"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-04-22"
duration: 1
depends_on:
  - "feat-101"
blocks: []
tags:
  - "manager"
  - "agents"
  - "mobile"
  - "modal"
  - "typography"
---

## Problem

The repaired mobile automation modal still feels oversized typographically. The modal title, supporting copy, and recipe-step heading take up too much vertical space on narrow screens.

## Entry Points — Read These First

1. `apps/manager/src/features/agents/agents-page.tsx`
2. `apps/manager/src/features/agents/automation-form.tsx`

## What To Build

1. Reduce the modal title size on mobile.
2. Tighten the supporting modal copy line height.
3. Reduce the recipe-step heading size on mobile while preserving desktop scale.

## Verification

- `pnpm --filter @forge/manager lint`
- Browser check at `http://localhost:6302/dashboard/agents`
- Confirm the mobile modal first viewport reads smaller and tighter without losing hierarchy.

## Completion Notes

- Reduced the mobile `New automation` title scale in `apps/manager/src/features/agents/agents-page.tsx`.
- Tightened the modal supporting copy line height for the small-screen header block.
- Reduced the recipe-step heading size in `apps/manager/src/features/agents/automation-form.tsx` while preserving desktop scale.
- Verified the updated mobile modal locally.
