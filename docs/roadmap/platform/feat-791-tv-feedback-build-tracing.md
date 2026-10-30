---
id: "feat-791"
title: "Bound production tracing of the local feedback capture path"
owner: "ekkasit"
priority: "P2"
status: "not-started"
start_date: "2026-10-27"
duration: 1
depends_on: []
blocks: []
tags:
  - feedback
  - build
---

## Problem

The 27 October staging build succeeds but Next.js warns that dynamic
`path.resolve` in `apps/tv-feedback/src/server/localConfig.ts` traces the whole
project. The local receiver is disabled in production; its development capture
location should not unnecessarily expand production tracing.

## Work and verification

Inspect the local receiver import graph and Next.js output tracing configuration.
Bound or exclude the development-only path without weakening the runtime guard.
Run feedback tests, typecheck and production build; verify `/tv/local` and local
API routes still return 404 in production. Compare traced output size and build
behavior. Preserve local captures and never publish ignored private files.
