---
id: "feat-633"
title: "Localize Watch video titles on language variants"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-07"
duration: 1
depends_on: []
blocks: []
tags:
  - "watch"
  - "seo"
  - "i18n"
---

## Problem

Language-variant Watch pages without an authored Search title use the English
brand-only fallback, so translated pages for the same video collapse to the
same document title.

## Entry points

- `apps/web/src/lib/experience-metadata.ts`
- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
- `apps/web/src/lib/experience-metadata.test.ts`

## Scope

Thread the locale-resolved video title into the metadata model and append the
selected language's native name on non-English variants. Preserve explicit
Search title overrides, the English title format, and `VideoObject` identity.

## Verification

- Unit coverage for locale-resolved title, native language descriptor, and
  explicit Search title precedence.
- Focused Web metadata tests, typecheck, lint, and formatting.
- Compare English, Spanish, and French production page titles before release.
