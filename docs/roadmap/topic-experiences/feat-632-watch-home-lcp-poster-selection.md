---
id: feat-632
title: Watch home deterministic LCP poster selection
status: in-progress
priority: P1
owner: vlad
---

## Goal

Make the Watch home hero's server-rendered poster the same image the browser loads as its LCP image.

## Scope

- Keep first-slide selection deterministic through hydration, independent of browser watch history.
- Emit one high-priority preload for that poster and no preload for later slides or the decorative blurred backdrop.
- Preserve carousel advance behavior after the opening slide.

## Verification

- Test deterministic opening slide selection and that only its hero poster gets image priority.
- Web typecheck, lint, and production build.
- Compare server-rendered image preload URL to the opening poster URL.

## Tracking

- Linear: FGE-157
