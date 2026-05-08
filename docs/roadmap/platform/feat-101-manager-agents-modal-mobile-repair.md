---
id: "feat-101"
title: "Manager Agents Modal Mobile Repair"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-22"
duration: 1
depends_on:
  - "feat-091"
  - "feat-093"
blocks:
  - "feat-102"
tags:
  - "manager"
  - "agents"
  - "mobile"
  - "modal"
  - "styling"
---

## Problem

The `New automation` modal feels broken on small screens. The desktop-sized dialog shell, oversized mobile header, and roomy stepper/content spacing make the first viewport feel cropped and unstable, and the modal can expose horizontal overflow.

## Entry Points — Read These First

1. `apps/manager/src/components/ui/modal-shell.tsx` — shared modal backdrop, panel, and header behavior.
2. `apps/manager/src/features/agents/agents-page.tsx` — automation modal header copy and shell usage.
3. `apps/manager/src/features/agents/automation-form.tsx` — mobile stepper, form section spacing, and footer actions.

## Grep These

- `ModalPanel`
- `ModalHeader`
- `agents-create-title`
- `StepperNav`
- `Choose the workflow to automate`

## What To Build

1. Make the automation modal read like a clean mobile sheet instead of a cramped desktop dialog.
2. Prevent horizontal overflow inside the modal on small screens.
3. Tighten mobile spacing and typography while preserving the existing desktop design direction.

## Constraints

- Keep the current Studio visual language.
- Preserve the step flow and modal interaction model.
- Avoid broad restyling of unrelated modals unless the shared shell change is clearly beneficial.

## Verification

- `pnpm --filter @forge/manager lint`
- Browser check at `http://localhost:6302/dashboard/agents`
- Confirm the mobile `New automation` modal no longer overflows horizontally and the first screen reads cleanly.

## Completion Notes

- Tightened the shared modal shell on small screens with mobile-first inset spacing, smaller radius, and `overflow-x-hidden`.
- Updated the agents modal header so the title block can shrink next to the close button without forcing a broken layout.
- Reduced mobile stepper and section spacing inside the automation form so the first screen reads cleanly on narrow viewports.
- Verified the repaired modal on the local mobile agents route.
