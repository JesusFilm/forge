---
id: "feat-779"
title: "Keep Node crypto polyfills out of every Watch client bundle"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "performance"
---

## Current scope (October 29, 2026)

Main retired the three client controls that caused the original crypto import
in PR #2957. Preserve those deletions. This PR now adds a source-graph
regression guard only; it makes no runtime or asset changes relative to main.
The October 20 performance measurements below describe the original repair,
not an additional saving from merging this version.

- `apps/web/src/__tests__/no-node-crypto-in-client-graph.test.ts` walks local
  static imports, re-exports and literal dynamic imports from client roots.
- Server Action boundaries are excluded because clients receive references.
- A synthetic client import of the real server consent module proves the
  guard detects the historical leak without restoring retired UI.
- Verify with `pnpm --filter @forge/web exec vitest run src/__tests__/no-node-crypto-in-client-graph.test.ts --maxWorkers=2`,
  scoped ESLint, Prettier and `git diff --check`.

## October 30 guard correction

Independent review R1-P2-1 found that the import matcher could consume a
side-effect import together with a later `from` statement and miss the first
dependency. Match the quoted side-effect alternative first, then read the
appropriate capture for either form.

The real server consent-module regressions fail before the fix and pass after
it for both a following value import and a following re-export. Multiline
imports/re-exports and erased type declarations remain covered. All six guard
tests pass. This remains a local TS/TSX source-graph heuristic, not emitted
bundle certification; no runtime code or retired UI is restored. New-candidate
independent review, normal commit hooks and current-head CI remain pending.

## Historical implementation requirement

## Problem

Every Watch route (home, video, series, inventory, languages, history,
what's-new, 404) loads one client chunk of about 450 KB decoded (91 KB brotli
locally, 135 KB as served by production on 2026-10-20) that contains only the
browser polyfills for Node's `crypto` module: `crypto-browserify`, its
`stream`/`buffer` shims, `pbkdf2`, `ripemd160`, `secp256k1`, `publicEncrypt`.
No Watch browser code uses any of it.

The cause is one import edge. The locale root layout renders
`RecommendationConsentShell`, and that client component, plus
`RecommendationCookieSettingsTrigger` and
`RecommendationPersonalizationControl`, import three event and channel names
from `apps/web/src/lib/recommendation-consent.ts`. That module also holds the
server-side consent cookie helpers and imports `createHash` and `randomBytes`
from `node:crypto`. Turbopack resolves the whole module graph for the client
and substitutes the polyfill.

Found during the 2026-10-19 overnight website audit, round 01. Evidence is
in `docs/reports/2026-10-20-watch-website-audit-round-01.md`.

## Entry Points — Read These First

1. `apps/web/src/lib/recommendation-consent.ts` — server cookie helpers plus
   the three browser event/channel constants.
2. `apps/web/src/components/recommendations/RecommendationConsentShell.tsx`,
   `RecommendationCookieSettingsTrigger.tsx`,
   `RecommendationPersonalizationControl.tsx` — the client importers.
3. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` — renders the shell on
   every Watch route, which is why every route pays.

## Grep These

- `from "@/lib/recommendation-consent"` in files that start with `"use client"`
- `from "node:crypto"` under `apps/web/src/lib`
- `pbkdf2` in `apps/web/.next/static/chunks/*.js` after `next build`

## What To Build

- Move `RECOMMENDATION_CONSENT_CHANGED_EVENT`,
  `RECOMMENDATION_CONSENT_CHANNEL` and
  `RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT` into a dependency-free
  `apps/web/src/lib/recommendation-consent-events.ts`.
- Re-export them from `recommendation-consent.ts` so server callers and
  tests keep working unchanged.
- Point the three client components at the new module.
- Pin the boundary with a source test: no `"use client"` module under
  `apps/web/src` may import a module that imports `node:crypto`.

## Constraints

- Do not change consent, profile, recommendation or analytics behaviour. The
  values of the three constants must stay byte-identical (the channel name is
  shared across already-open tabs).
- Do not add `server-only` to `recommendation-consent.ts` in this change;
  the source test is the guard, and widening the import surface is out of
  scope.

## Verification

- `pnpm --filter @forge/web exec vitest run src/lib src/components/recommendations src/components/home`
- `pnpm --filter @forge/web typecheck` and `lint`
- `next build`: `grep -l pbkdf2 .next/static/chunks/*.js` returns nothing.
- Matched `next start` lab runs (same harness, same profile) on `/watch`,
  `/watch/whats-new` and the 404 template before and after: script bytes and
  script execution time drop; FCP/LCP/CLS do not regress.
