---
id: "feat-469"
title: "Resolve sitemap children against the final response URL"
owner: "jaco"
priority: "P2"
status: "not-started"
start_date: "2026-09-09"
duration: 1
depends_on: []
blocks: []
tags: ["rag", "acquisition", "http", "testing"]
---

## Problem

A pre-existing edge case remains after feat-468: `discoverUrls` resolves relative
child sitemap locations against the requested sitemap URL. A redirect into a
different directory can therefore select the wrong child URL. `FetchResult`
does not expose the final response URL. This is separate from the reproduced
GotQuestions/Cru root destination refusal; no affected production source has
been established for this edge case.

## Entry Points — Read These First

- `apps/rag/src/acquisition/discover.ts` — `new URL(rawChild, sm)`.
- `apps/rag/src/contracts/ports.ts` — `FetchResult`.
- `apps/rag/src/adapters/http/http-fetcher.ts` — final `destination`.
- `apps/rag/src/adapters/firecrawl/` — check adapter representation before extending the port.

## Grep These

`FetchResult`, `rawChild`, `destination`, `redirect`.

## What To Build

Reproduce a directory-changing redirect with a relative child. Define final-URL
semantics across fetch adapters and resolve children against the actual sitemap
response location while preserving registered discovery destination boundaries.

## Constraints

Do not infer or widen allowed origins/directories from redirects. Preserve
existing fake and adapter contracts deliberately; no production acquisition.

## Verification

Test the real HTTP adapter with a redirect into a subdirectory, relative child
resolution, and out-of-scope child rejection. Run RAG typecheck, tests, and lint.
