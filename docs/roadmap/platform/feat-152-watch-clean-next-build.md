---
id: feat-152
title: Prune stale web ISR output after Railway builds
status: "complete"
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

Production `watch.jesusfilm.org` can keep serving stale runtime-generated watch
HTML after a successful `@forge/web` deployment. The Russian visible chrome fix
landed, but the target URL still returned `x-nextjs-cache: STALE` with old
English labels in the RSC payload.

## Entry Points

- `apps/web/package.json`
- `apps/web/scripts/prune-next-isr-output.mjs`

## What To Build

Ensure `@forge/web` removes concrete `.next/server/app/<locale>/...` ISR output
after `next build` so Railway/Railpack cannot package stale runtime-generated
pages from a previous deployment. Keep the compiled dynamic route entries such
as `.next/server/app/[locale]/[htmlLang]/[...rest]` intact.

## Verification

- `pnpm --filter @forge/web build`
- Production smoke for `/watch/parable-of-the-pharisee-and-tax-collector.html/russian.html`
  should show Russian visible chrome after redeploy.

## Completion Notes

- Shipped stale ISR pruning in PR #1082.
- Triggered the watched `@forge/web` service path in PR #1083.
- Fixed runtime locale propagation by passing explicit locale messages to the
  watch layout provider in PR #1084.
- Verified production `watch.jesusfilm.org` returns Russian visible chrome for
  `/watch/parable-of-the-pharisee-and-tax-collector.html/russian.html`.
