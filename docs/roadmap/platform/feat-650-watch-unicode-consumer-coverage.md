---
id: "feat-650"
title: "Complete Unicode Watch URL consumer support"
owner: "unassigned"
priority: "P2"
status: "backlog"
start_date: ""
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
---

## Problem

Watch route construction and public admission support lowercase Latin content
slugs with diacritics, but legacy URL canonicalization, recommendation href
validation, search manifest validation, and sitemap audits still use ASCII-only
checks. This drops some canonicalization and consumer behavior for valid
published content slugs.

## Entry Points — Read These First

1. `apps/web/src/lib/url-canonicalize.ts` — legacy Watch URL normalization.
2. `apps/web/src/lib/routes.ts` — canonical recommendation href validation.
3. `apps/web/src/lib/watch-search-client.ts` — search result manifest validation.
4. `apps/web/src/lib/watch-sitemap-audit.ts` — sitemap audit URL validation.
5. `apps/web/src/lib/url-shape.ts` — shared content slug grammar.

## What To Build

1. Apply the existing lowercase Latin slug grammar consistently to canonical
   legacy Watch paths while preserving one canonical percent-encoding form.
2. Allow valid published Unicode content slugs in recommendation hrefs, search
   result manifests, and sitemap audits.
3. Keep public language slugs ASCII and validate every URL against existing
   route manifest or content admission rules.
4. Add focused tests for each consumer, including malformed encodings and
   non-Latin lookalike slugs.

## Constraints

- Preserve exact Admin-published slugs; do not transliterate or normalize them.
- Do not relax route manifest admission or expose arbitrary Unicode paths.
- Do not add unadmitted contextual episode URLs to the sitemap.

## Verification

- Focused canonicalizer, recommendation, search manifest, and sitemap audit
  tests.
- Web typecheck plus focused lint, format, and diff checks.
