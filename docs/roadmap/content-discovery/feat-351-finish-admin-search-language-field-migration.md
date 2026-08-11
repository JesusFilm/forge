---
id: "feat-351"
title: "Finish Admin search comparison language field migration"
owner: "codex"
priority: "P2"
status: "not-started"
start_date: "2026-08-12"
duration: 2
depends_on:
  - "feat-350"
blocks: []
tags:
  - "admin"
  - "watch"
  - "search"
  - "cleanup"
---

## Problem

Feature 350 deliberately keeps the comparison form on `languageSelection` while
the tolerant server action deploys. The long-term field is
`targetLanguageSlug`, and the temporary `languageSelection` and `locale`
aliases must be removed after the migration window closes.

## Entry Points — Read These First

1. `apps/admin/src/app/dashboard/search/compare/watch-search-comparison.tsx`
2. `apps/admin/src/app/dashboard/search/compare/comparison-actions.ts`
3. `apps/admin/src/app/dashboard/search/compare/page.test.tsx`
4. `apps/admin/src/app/dashboard/search/compare/comparison-actions.test.ts`

## Grep These

- `name="languageSelection"` — current client field to migrate.
- `languageSelection: optionalLanguageSelection` — temporary server alias.
- `locale: z.string()` — ignored legacy form key.
- `name="targetLanguageSlug"` — permanent client field after migration.

If any temporary symbol is renamed before removal, update these grep patterns in
the same PR.

## What To Build

0. Confirm feat-350 is deployed to every Admin container and no previous strict
   action instance remains before changing the client field.
1. Change the rendered selector to `targetLanguageSlug`; keep both server aliases
   for already-open tabs during one normal Admin release cycle.
2. After that release cycle drains, remove `languageSelection` and legacy
   `locale` acceptance plus their compatibility tests.
3. Keep the adjacent-version contract test until the aliases are removed, then
   replace it with a strict permanent-field test.

## Permanent KEEP List

- The selector remains one combined language dropdown.
- `targetLanguageSlug` remains the submitted field.
- The server resolves the canonical BCP-47 locale from the language catalog.
- Conflicting or unknown language values fail closed.
- Public Watch search traffic and Typesense latency remain unchanged.

## Constraints

- Do not combine step 0 and alias removal into one rolling deployment.
- Do not restore a client-controlled locale field.
- Do not modify the normal Admin search page or public Watch search surface.

## Verification

- `git grep -nE 'languageSelection|locale: z\\.string' -- apps/admin/src/app/dashboard/search/compare`
- `pnpm --filter @forge/admin test -- src/app/dashboard/search/compare/page.test.tsx src/app/dashboard/search/compare/comparison-actions.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `/home/vscode/forge/node_modules/.bin/eslint apps/admin/src/app/dashboard/search/compare/comparison-actions.ts apps/admin/src/app/dashboard/search/compare/comparison-actions.test.ts apps/admin/src/app/dashboard/search/compare/watch-search-comparison.tsx apps/admin/src/app/dashboard/search/compare/page.test.tsx`
- Submit an explicit language and Auto-detect comparison from
  `/dashboard/search/compare` after each rollout phase.
