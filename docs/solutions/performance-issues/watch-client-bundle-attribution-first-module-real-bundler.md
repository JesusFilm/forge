---
title: "Attribute a Watch client chunk by its first module and measure it in the real Turbopack build"
date: "2026-10-20"
category: performance-issues
module: apps/web
problem_type: performance_issue
component: frontend_stimulus
severity: medium
symptoms:
  - "A large shared chunk (Node crypto polyfill, zod, micromark) loads on every Watch route"
  - "The most visible importer looks responsible, but deferring it does not remove the chunk"
  - "A proxy bundler (esbuild) predicts a big tree-shaking win that the real build does not deliver"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - recommendation-consent.ts
  - env.ts
  - RelatedQuestions
tags:
  - bundle-size
  - turbopack
  - use-client
  - attribution
  - watch
---

## October 29 source update

Main retired the three recommendation controls that supplied this historical
import edge. PR #2821 now keeps the source-graph guard without restoring those
controls or their event module. The attribution method below still applies to
future client/server boundary leaks; the old control paths are historical
examples, not setup instructions.

## Problem

The 2026-10-20 overnight audit chased three big client chunks on Watch:

- the Node crypto polyfill (461 KB decoded)
- zod (285 KB)
- micromark (113 KB)

Two of the first guesses were wrong. Each would have cost a PR that saved
little or nothing.

## What was actually true

- **Crypto polyfill (#2821).** Three client components imported plain
  constants from `lib/recommendation-consent.ts`. That module also imports
  `node:crypto` for server work, so the client graph pulled the whole
  polyfill. The fix moved the constants to a module with no server
  imports. Result: about 136 KB less script on the wire per route.
- **zod.** It looked like a search cost, because search was the most
  visible importer. But the chunk's FIRST module was `env.ts` (t3-env),
  loaded by `DatadogRum` and `GoogleAnalytics` in the root layout.
  Deferring search would have removed nothing.
- **zod/mini.** esbuild shook it to 24 KB. Turbopack kept zod's whole core
  namespace and every locale, because `import * as core` re-exports
  `* as locales`. The real build saved about 4 KB br. The change was
  rejected. `experimental.turbopackModuleFragments` panicked the build.
- **micromark (#2833).** `RelatedQuestions` was `"use client"` only for
  accordion state. Rendering the Markdown on the server and using native
  `<details>` removed micromark from the home and catch-all entries.
  Result: about 35 KB less on the wire.

## Rules

1. Attribute a chunk by its first module and by its import chain from a
   route entry. Do not attribute it by whichever importer you noticed.
2. Measure in the real `next build` (Turbopack). Count route entry JS from
   the client-reference manifests. Proxy bundlers disagree on namespace
   re-exports.
3. Keep constants that client code needs in plain modules with no server
   imports. A shared constants file that also imports `node:*` drags a
   polyfill into every client graph that touches it.
4. A server component that imports a non-component value from a
   `"use client"` file gets a client reference, not the value. Move shared
   constants out before you drop or add a directive.
5. Verify the result in the built output (for example, `grep` the chunks
   for `pbkdf2`), and add a graph test that fails if the import comes back.

## References

- PRs #2821, #2833. Rejected `zod/mini` patch notes are in
  `docs/reports/2026-10-20-watch-overnight-audit.md`.
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
