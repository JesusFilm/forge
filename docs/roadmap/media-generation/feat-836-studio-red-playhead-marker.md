---
id: "feat-836"
title: "Use a red playhead line with a top ruler triangle"
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

Replace the timeline's black diamond marker with a red triangle at the very top
of the ruler and a one-pixel red line through the tracks. Keep ruler numbers
below the handle, preserve the 16px drag hit area and keyboard seeking. Reuse
Manager's existing brand red token.

## Verification

Browser-check triangle/line placement against the 48px ruler and visible numbers,
keyboard seeking and no horizontal overflow. Formatting/diff checks. CSS-only
change adds no media requests or client initialization.

## Outcome

Playhead starts at ruler y=0 with a 14×10px downward triangle and 1px brand-red
line extending from its tip through the tracks. The 16px invisible drag target
and keyboard handler remain unchanged. Focus uses a shadow around the triangle.
Browser measurements confirm ruler numbers begin at y=33, below the triangle;
computed line color is rgb(239,51,64), width 1px. ArrowRight reaches frame one;
viewport and scroll width both 1263px (no phantom overflow).

Formatting and diff whitespace checks pass. Actual-component resource trace
still has one metadata, two waveform and three image requests, all after load;
marker movement adds none. This changes CSS only, with no new initialization or
media work. Durable rule: put the visual handle at ruler top while retaining a
separate larger transparent drag target; keep the time labels below its height.

Follow-up: increased the line to 2px at the user’s request and shifted it left
by 1px to keep its center aligned with the triangle tip. CSS-only adjustment;
formatting and whitespace checks passed.

Join repair: start the line at y=8px so it overlaps the 10px triangle by 2px.
This bridges the antialiased tip instead of relying on two shapes meeting at
a zero-area point. The line remains 2px wide and centered. Formatting and diff
checks passed; no runtime or loading changes.
