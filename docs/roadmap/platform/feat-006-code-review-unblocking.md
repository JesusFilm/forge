---
id: "feat-006"
title: "Code Review and Unblocking"
owner: "tataihono"
priority: "P0"
status: "not-started"
start_date: "2026-04-01"
duration: 56
depends_on: []
blocks: []
tags:
  - "infrastructure"
---

## Review Focus Per Person

**Nisal PRs** — check for:

- Raw SQL injection risks (parameterized queries, not string interpolation)
- Strapi table naming (they add prefixes — verify actual table names)
- pgvector index type (HNSW, not IVFFlat)
- Bulk operation transaction safety
- Grep: `strapi.db.connection.raw` — every raw SQL call

**Ekkasit PRs** — check for:

- Idempotency in the generation pipeline (re-runs update, not duplicate)
- Rate limiting on LLM calls
- Durable workflow step boundaries (each step should be independently retryable)
- Template validity (all `__component` values match real Strapi components)
- Grep: `getOpenrouter|"use step"|"use workflow"` — AI and workflow calls

**Urim PRs** — check for:

- Server Components vs Client Components (minimize `'use client'`)
- `next/image` usage (no raw `<img>`)
- Data fetching on server, not in useEffect
- Mobile FlatList usage (not ScrollView with .map)
- Grep: `'use client'|useEffect.*fetch|<img ` — anti-patterns

**Vlad PRs** — check for:

- Enrichment step idempotency
- S3 artifact key consistency (`{assetId}/{type}.{ext}`)
- Error handling in LLM calls (retry, fallback, structured output validation)
- Grep: `uploadArtifact|downloadArtifact` — artifact patterns

## Verification

- PRs reviewed within 24 hours
- No one blocked for more than half a day on architecture questions
- Zero runtime errors from merged PRs
