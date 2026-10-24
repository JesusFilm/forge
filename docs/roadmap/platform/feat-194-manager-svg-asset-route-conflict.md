---
id: "feat-194"
title: "Manager SVG asset route conflict"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-16"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "manager"
  - "assets"
---

## Problem

Local Manager smoke testing logs Next.js route conflicts for
`/jesusfilm-sign.svg` and `/favicon.svg` because both `apps/manager/public`
and App Router route handlers provide the same paths.

## Entry Points -- Read These First

1. `apps/manager/public/jesusfilm-sign.svg`
2. `apps/manager/public/favicon.svg`
3. `apps/manager/src/app/jesusfilm-sign.svg/route.ts`
4. `apps/manager/src/app/favicon.svg/route.ts`
5. `apps/manager/CLAUDE.md` -- Manager shell asset runtime-image note.

## What Changed

- Kept the App Router SVG route handlers because Manager docs note they protect
  the shell when the runtime image omits `apps/manager/public`.
- Removed the duplicate public SVG files so Next no longer sees conflicting
  public-file and page-file ownership for the same paths.

## Verification

- Local Manager dev smoke should load `/jesusfilm-sign.svg` and `/favicon.svg`
  without Next's conflicting public file/page file error.
