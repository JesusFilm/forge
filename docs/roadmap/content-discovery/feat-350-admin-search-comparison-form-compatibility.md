---
id: "feat-350"
title: "Keep Admin search comparison forms compatible during deploys"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-11"
duration: 1
depends_on:
  - "feat-349"
blocks:
  - "feat-351"
tags:
  - "admin"
  - "watch"
  - "search"
  - "reliability"
---

## Problem

The language dropdown initially renamed the submitted form field. During a
rolling deployment, a new browser form could reach an older strict server
action, causing every comparison to fail input validation before search ran.

## Entry Points — Read These First

1. `apps/admin/src/app/dashboard/search/compare/watch-search-comparison.tsx`
2. `apps/admin/src/app/dashboard/search/compare/comparison-actions.ts`
3. `apps/admin/src/app/dashboard/search/compare/comparison-actions.test.ts`

## Grep These

- `languageSelection` — the current form field retained for the server-first
  compatibility deployment.
- `targetLanguageSlug` — the long-term field accepted now for pre-dropdown tabs
  and a later client migration.
- `Conflicting language selections` — rejects ambiguous dual submissions.

## What To Build

- Keep the rendered selector named `languageSelection` in this deployment so
  requests still parse on the immediately previous strict server action.
- Make the new action accept `languageSelection`, `targetLanguageSlug`, and the
  legacy `locale` key during the migration window.
- Reject submissions where both language fields are present with different
  values.
- Ignore client-provided locale values and resolve the canonical BCP-47 locale
  from the selected language slug on the server.

## Constraints

- Keep the private comparison page compatible across rolling deployments.
- Deploy the tolerant server action before renaming the rendered form field.
- Ignore the legacy client-provided locale and derive the canonical locale on
  the server.
- Do not change public Watch search traffic, Typesense calls, or latency.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/search/compare/page.test.tsx src/app/dashboard/search/compare/comparison-actions.test.ts src/services/watch-search-language-options.service.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `/home/vscode/forge/node_modules/.bin/eslint apps/admin/src/app/dashboard/search/compare/comparison-actions.ts apps/admin/src/app/dashboard/search/compare/comparison-actions.test.ts apps/admin/src/app/dashboard/search/compare/watch-search-comparison.tsx apps/admin/src/app/dashboard/search/compare/page.test.tsx`
- Render the comparison form and verify its field set parses against the
  immediately previous strict `languageSelection` action schema.
- After deployment, submit representative multilingual comparisons from
  `/dashboard/search/compare` and confirm both result panes render without the
  generic input error.
