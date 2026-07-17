---
title: "A runtime env flag read in a static Next.js App Router server component bakes at build — needs force-dynamic"
date: 2026-06-26
category: runtime-errors
problem_type: runtime_error
component: development_workflow
root_cause: config_error
resolution_type: code_fix
severity: high
module: apps/chat
related_components:
  - apps/web
  - apps/admin
tags:
  - nextjs
  - app-router
  - force-dynamic
  - static-optimization
  - feature-flag
  - env
  - railway
---

## Problem

A deployment-wide feature flag read from `process.env` inside an otherwise-static
Next.js App Router **server component** is folded into the build-time prerender.
Flipping the flag on the deploy platform (Railway env var) then has **no effect
until a rebuild** — the served page keeps the value baked at build time.

## Symptoms

- An operator flips a server-side env flag (e.g. `SEEKER_CHAT_ENABLED`) on
  Railway, redeploys env only, and the page behaves as if the flag never changed.
- The page reads correct values immediately after a full rebuild, masking the
  bug as "works on deploy."
- `next build` route summary shows the route as `○ (Static)` instead of
  `ƒ (Dynamic)`.
- No error anywhere — silent. The team concludes "the flag wiring is broken."

## What Didn't Work

- Assuming a bare `process.env.X` read forces dynamic rendering. It does **not**.
  Next.js statically optimizes a server component that uses no dynamic API
  (`cookies()`, `headers()`, `searchParams`, `export const dynamic`), and folds
  the env read into the prerendered HTML at build time.
- Choosing a server-read boolean prop _specifically to avoid_ `NEXT_PUBLIC_*`
  build-time baking — correct instinct, but without `force-dynamic` the server
  read bakes at build too, so the rebuild-to-flip problem is not actually solved.

## Solution

Pin the route to per-request rendering with the route-segment config export, so
the env read happens at request time on every load:

```tsx
// apps/chat/src/app/page.tsx
import { AppShell } from "@/components/shell/app-shell"
import { isSeekerChatEnabled } from "@/config/env"

// force-dynamic is load-bearing: without it Next folds isSeekerChatEnabled()'s
// process.env read into the build-time prerender, so flipping the env on the
// platform won't change the served page until a rebuild.
export const dynamic = "force-dynamic"

export default function HomePage() {
  return <AppShell seekerEnabled={isSeekerChatEnabled()} />
}
```

Verify at build time: the route summary must list the route as `ƒ (Dynamic)`,
not `○ (Static)`.

```
Route (app)
┌ ƒ /                 <- dynamic: env read happens per request
└ ƒ /api/seeker
```

## Why This Works

`force-dynamic` opts the route segment out of static optimization, so the
component function (and its `process.env` read) runs on every request against
the live process environment. A Railway env change produces a new process on
redeploy, so the request-time read returns the new value without a rebuild.
Equivalent forcing happens implicitly if the component calls a dynamic API
(`cookies()`/`headers()`), but an explicit `export const dynamic = "force-dynamic"`
is clearer when the only reason for dynamism is a runtime env read.

## Prevention

- When a server component reads a runtime-mutable env var that must take effect
  without a rebuild, add `export const dynamic = "force-dynamic"` (or read
  through a dynamic API) — do not rely on the bare `process.env` read.
- Add a build-time check to the plan/verification: confirm the route renders as
  `ƒ (Dynamic)` in the `next build` summary, and manually verify "flip env →
  served HTML changes without rebuild."
- This is distinct from `NEXT_PUBLIC_*` (which bakes at build by design and is
  client-visible). A server-read boolean prop keeps the value server-side AND
  runtime-flippable **only** when the route is dynamic.
- Applies to every Next.js App Router app in the monorepo (apps/web, apps/admin,
  apps/chat), not just the app where it was first hit.
