---
id: "feat-445"
title: "Make registry policy tests execute production filtering"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-08-31"
duration: 2
depends_on: ["feat-431"]
blocks: []
tags: ["rag", "acquisition", "testing"]
---

## Problem

Registry tests duplicate the production URL predicate in more than 30 files.
They can stay green when acquisition filtering changes.

## Entry Points — Read These First

1. `apps/rag/src/acquisition/discover.ts` — private `keepUrl` production predicate.
2. `apps/rag/src/registry/everystudent-*.test.ts` — repeated `keeps` helpers.

## Grep These

- `const keeps`
- `function keeps`
- `keepUrl`

## What To Build

Export one pure, dependency-law-compliant crawl-policy predicate. Use it from
`discoverUrls` and every registry policy test. Retain source-specific cases as
data, not copied executable logic.

## Constraints

- Preserve empty `allow`, `articleHints`, and `block` semantics.
- Do not move registry data across bounded-context import boundaries.

## Verification

- A mutation to the production predicate fails representative registry tests.
- `pnpm --filter @forge/rag test`, typecheck, lint, and depcruise pass.
