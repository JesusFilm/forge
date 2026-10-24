---
id: "feat-712"
title: "Restore legacy Experience block read compatibility"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-10-16"
duration: 1
depends_on:
  - "feat-711"
blocks: []
tags:
  - "admin"
  - "cms"
  - "experience"
  - "production"
---

## Problem

Production Experience rows written before raw block image URLs were retired can
still contain `imageUrl` or `backgroundImageUrl`. The current strict block
schema rejects those saved rows, preventing the Admin editor and feat-711 page
duplication from reading otherwise valid locale content.

## Scope

- Sanitize only persisted canonical and revision block JSON before strict
  validation.
- Keep new editor, GraphQL, and MCP writes strict: raw image URLs remain
  rejected.
- Preserve every current field, including `mediaUrl`, and avoid applying schema
  defaults to duplicated saved JSON.
- Add regression coverage for canonical reads, active drafts, duplication, and
  source immutability.

## Verification

- `pnpm --filter @forge/admin exec vitest run src/services/experience.service.test.ts src/services/experience-persisted-blocks.test.ts src/domain/blocks.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
