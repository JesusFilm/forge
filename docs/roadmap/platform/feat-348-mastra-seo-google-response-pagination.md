---
id: "feat-348"
title: "Bound Mastra SEO Google response pages"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-10"
duration: 1
depends_on:
  - "feat-345"
blocks: []
tags:
  - "platform"
  - "mastra"
  - "seo"
  - "search-console"
  - "analytics"
  - "reliability"
---

## Problem

The production SEO dry run authenticates successfully with Search Console and
GA4, but both clients request up to 25,000 rows in one response while enforcing
a 2 MB response ceiling. Valid Google payloads can therefore be rejected as
`parse_error` before pagination begins. The clients need byte-budget-aware page
sizes that preserve the existing response-size guard.

## Entry Points — Read These First

1. `apps/mastra/src/services/google-search-console-client.ts` — Search Analytics pagination.
2. `apps/mastra/src/services/google-analytics-client.ts` — GA4 report pagination.
3. `apps/mastra/src/services/seo-http.ts` — bounded response parsing.

## Grep These

- `boundedSeoProviderPageSize`
- `response_too_large`
- `requestedPageSize`
- `readSeoJsonResult`

## What To Build

1. Derive a conservative provider page size from the configured response-byte budget.
2. Preserve the configured total-row caps and Google pagination offsets.
3. Test multi-page collection and request bounds for both providers.
4. Re-run the production workflow in `dry_run` and verify no operator-facing mutations occur.

## Constraints

- Never raise or bypass `SEO_MAX_RESPONSE_BYTES` to make a provider page pass.
- Retry an oversized page at the same `startRow` or `offset`; advance only after parsing a valid page.
- Preserve the configured total-row caps even after the page size shrinks.
- Keep production in `dry_run`; provider recovery must not enable proposal persistence, draft writes, ticket creation, approvals, or content changes.

## Verification

- Focused Google provider tests pass.
- Mastra typecheck and lint pass.
- Production dry run reports usable GSC and GA4 coverage while persisting zero proposals, drafts, tickets, approvals, or content changes.
