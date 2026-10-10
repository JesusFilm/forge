---
id: "feat-073"
title: "TV App — Scaffolding + GraphQL Wiring"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-04-12"
duration: 3
depends_on:
  - "feat-072"
blocks:
  - "feat-074"
  - "feat-075"
tags:
  - "tv"
  - "graphql"
---

## Problem

With the Expo TV toolchain validated (feat-072), set up the production TV app scaffolding: proper Expo project, Apollo Client wiring, and the SDUI pipeline (normalizer + dispatcher) imported from mobile-v2.

## Entry Points — Read These First

1. `docs/brainstorms/2026-04-10-tv-app-prototype-requirements.md` — Architecture and Code Sharing Strategy sections
2. `apps/mobile-v2/src/lib/apolloClient.ts` — Apollo Client lazy-init pattern to replicate
3. `apps/mobile-v2/src/lib/normalizer.ts` — normalizer to import directly
4. `apps/mobile-v2/src/lib/queries.ts` — queries to import directly
5. `apps/mobile-v2/src/contexts/ExperienceProvider.tsx` — context provider to port
6. `packages/graphql/` — shared typed GraphQL client

## Grep These

- `getApolloClient` in `apps/mobile-v2/src/` — lazy Apollo Client init pattern
- `NormalizedBlock` in `apps/mobile-v2/src/` — normalizer output type usage
- `ExperienceProvider` in `apps/mobile-v2/src/` — context usage pattern

## What To Build

1. Create `apps/tv/` with proper Expo TV config (react-native-tvos alias, config-tv plugin, EXPO_TV=1)
2. Add `apps/tv/` to pnpm workspace and turborepo pipeline
3. Wire Apollo Client (`apolloClient.ts`) following mobile-v2's lazy-init pattern
4. Import `normalizer.ts` and `queries.ts` from mobile-v2 via pnpm workspace path or TypeScript path aliases. If Metro can't resolve cross-app imports, copy the files.
5. Port `ExperienceProvider` — adapt if needed for TV (e.g., no ExperienceSelectionProvider if TV always shows all Experiences)
6. Create `SectionDispatcher.tsx` with PlaceholderRenderer for unhandled blocks
7. Set up Expo Router with two routes: `app/index.tsx` (home) and `app/experience/[slug].tsx` (detail)
8. Verify: app builds, connects to CMS GraphQL, and fetches Experience data

## Constraints

- Do NOT build any UI beyond placeholder screens that log fetched data
- Do NOT add linting/CI yet — that's a follow-up after the prototype is proven
- Import from mobile-v2 first; only copy files if the import approach fails

## Verification

- `cd apps/tv && EXPO_TV=1 npx expo prebuild --clean && npx expo run:ios` succeeds
- Console logs show Experience data fetched from CMS
- Expo Router navigates between home and detail screens via D-pad
- `pnpm build --filter=tv` runs without errors in turborepo
