---
id: "feat-637"
title: "Report Watch collection download handoffs accurately"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-07"
duration: 2
depends_on: ["feat-321"]
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "download"
---

## Problem

The browser anchor path marks a file completed immediately after issuing a click,
even though Web cannot observe whether the browser accepted or saved it. This
can show a false all-downloads-finished message when automatic downloads are
blocked.

## Entry Points - Read These First

1. `apps/web/src/components/watch/collection-download-queue.ts`
2. `apps/web/src/components/watch/collection-download-queue.test.ts`
3. `apps/web/src/components/watch/CollectionDownloadModal.tsx`
4. `apps/web/src/components/watch/__tests__/CollectionDownloadModal.test.tsx`
5. `apps/web/messages/en.json` and `apps/web/messages/es.json`

## Grep These

- `runCollectionDownloadQueue`
- `browserFallback`
- `completedCount`
- `failedCollectionDownloadItems`

## What To Build

- Track browser handoffs separately from files saved through the directory API.
- Use accurate browser delivery language and explain multiple-download permission.
- Preserve per-item target resolution failures and retry behavior, including
  mixed browser and directory delivery across retries and resume.
- Cover 10-item Highest, High, and Low batches and browser delivery language in
  English and Spanish.

## Constraints

- Do not claim that a browser anchor click confirms the file was saved.
- Preserve retryable target-resolution and upstream availability failures.
- Preserve the direct redirect architecture from feat-321; do not proxy file
  bodies through Web.

## Verification

- Focused queue and modal tests.
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter roadmap generate:readme`
