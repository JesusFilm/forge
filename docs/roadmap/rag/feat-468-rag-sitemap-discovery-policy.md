---
id: "feat-468"
title: "Separate sitemap discovery destinations from article filters"
owner: "jaco"
priority: "P1"
status: "complete"
start_date: "2026-09-09"
duration: 1
depends_on: []
blocks: []
tags: ["rag", "acquisition", "security", "testing"]
---

## Problem

The production GotQuestions acquisition report shows zero resolved URLs because
`/sitemap.xml` fails the article-only `.html` destination allow-list. Current
`discoverUrls` applies this same list to root fetches and child sitemap admission.

## Entry Points — Read These First

- `apps/rag/src/acquisition/discover.ts` — sitemap fetch policy and child recursion.
- `apps/rag/src/adapters/http/http-fetcher.ts` — redirect and private-address guards.
- `apps/rag/src/registry/types.ts` — crawl policy contract.
- `apps/rag/src/registry/{gotquestions,cru}.ts` — restrictive article policies.
- `apps/rag/src/adapters/http/discovery-policy.test.ts` — real-adapter regression coverage.

## Grep These

`destinationPolicy`, `allowPatterns`, `seenSitemaps`, `sitemapsFetched`.

## What To Build

Reproduce with the real HTTP adapter and registry policies. Separate discovery
transport authorization from content selection without weakening article filters
or redirect/private-address guards. Verify registered roots and recursive children,
including Icelandic path boundaries. Use `docs/plans/rag-sitemap-discovery-policy.md`
for the bounded correction and validation decisions.

## Constraints

Local investigation and tests only; no production acquisition, corpus changes,
or direct deployment. Preserve existing skipped-sitemap behavior and fetch caps.

## Verification

Real-adapter tests with deterministic DNS and transport, existing discovery and
HTTP security suites, complete RAG tests, typecheck, lint, dependency boundaries,
status check, and repository formatting. Public sitemap-only smoke may validate
discovery without loading database or provider credentials.

## Resolution

Separated sitemap transport admission from article selection. Registered sitemap
origins and parent directories bound root/child fetches and redirects; existing
HTTP safety checks and article allow/block/hints remain intact. The local audit
found four refused roots among 57 registered roots: GotQuestions English and the
three Cru sitemaps. Other host-wide policies and the Icelandic path already
admitted their roots.

Twenty real-HTTP-adapter regressions failed before the correction and pass after
it. Public sitemap-only discovery on 2026-09-09 resolved 10,598 GotQuestions URLs
from 10,891 entries, and 2,746 Cru URLs from 4,377 entries across three sitemaps.
No database, corpus write, provider call, or production acquisition was performed.
Local correctness and adversarial reviews found no new blocking issue; feat-469
tracks the separate pre-existing relative-child-after-redirect edge case.
The transport/filter distinction and testing lesson are retained in the existing
`apps/rag/docs/ops/corpus-maintenance.md` runbook.

Validation: 840 tests passed, 2 skipped; typecheck, lint, dependency boundaries,
and lifecycle schema checks passed. Repository formatting passed before commit.

[Forge PR #2210](https://github.com/JesusFilm/forge/pull/2210).
