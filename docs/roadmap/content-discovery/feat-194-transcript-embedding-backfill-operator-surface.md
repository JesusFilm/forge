---
id: "feat-194"
title: "Transcript Embedding Backfill Operator Surface"
owner: "nisal"
priority: "P1"
status: "planned"
start_date: "2026-06-18"
duration: 3
depends_on:
  - "feat-192"
blocks: []
tags:
  - "admin"
  - "manager"
  - "mastra"
  - "search"
  - "embeddings"
  - "content-discovery"
  - "operations"
---

## Scope

Add an operator-facing surface for transcript embedding backfills so production
reruns do not require hand-written GraphQL mutations or local CLI/env access.

The surface should trigger the existing Admin-owned transcript embedding
backfill with explicit support for full-catalog runs, scoped runs, and
model-upgrade reruns after embedding architecture changes like feat-192.

## Requirements

- Provide a first-party trigger surface for
  `triggerTranscriptEmbeddingBackfill`, exposed from the most appropriate
  operator app.
- Support generation mode selection: `IDEMPOTENT`, `REPAIR`, `FORCE`, and
  `MODEL_UPGRADE`, with `MODEL_UPGRADE` clearly separated from normal repair.
- Support optional `coreIds` and `languages` filters, while making the omitted
  full-catalog case explicit before launch.
- Show preflight context before launch: target scope, selected mode, expected
  source priority, and warning that scene embeddings are not part of the
  transcript backfill.
- Return or persist the backfill report, including totals, failed outcomes,
  skipped outcomes, `missingArtifacts`, and `sourceGaps`.
- Add a durable status/history view so operators can monitor a launched
  backfill without keeping a browser tab or terminal open.
- Keep trigger auth restricted to existing admin/operator permissions or a
  dedicated workflow-trigger bearer; do not expose service keys to the browser.
- If Manager remains a proxy surface, update
  `/api/admin-embeds/transcript` to pass the `mode` field through to Admin.

## Acceptance Criteria

- An operator can launch a full transcript embedding model-upgrade backfill
  without writing GraphQL manually.
- An operator can launch a scoped transcript embedding backfill by `coreIds`
  and/or `languages`.
- The UI/API makes it clear that transcript backfill is transcript-only and
  does not run legacy scene backfill.
- Backfill progress and final report are visible after the request returns or
  the initiating session disconnects.
- Failed targets, missing Manager transcript artifacts, and subtitle/source
  gaps are visible enough to drive follow-up enrichment work.
- Existing GraphQL mutation behavior remains backwards compatible.
