---
id: feat-152
title: Clean web Next build output before Railway deploys
status: "in-progress"
priority: high
area: platform
tags:
  - web
  - watch-page
  - deployment
  - i18n
depends_on:
  - feat-151
blocks: []
---

## Problem

Production `watch.jesusfilm.org` can keep serving stale prerendered watch HTML
after a successful `@forge/web` deployment. The Russian visible chrome fix
landed, but the target URL still returned `x-nextjs-cache: STALE` with old
English labels in the RSC payload.

## Entry Points

- `apps/web/package.json`
- `apps/web/scripts/clean-next-build.mjs`

## What To Build

Ensure `@forge/web` removes `.next` before `next build` so Railway/Nixpacks
cannot package stale runtime-generated ISR output from a previous deployment.

## Verification

- `pnpm --filter @forge/web build`
- Production smoke for `/watch/parable-of-the-pharisee-and-tax-collector.html/russian.html`
  should show Russian visible chrome after redeploy.
