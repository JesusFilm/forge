---
title: "Roadmap frontmatter type drift can crash Next.js static page-data collection"
date: 2026-07-07
category: build-errors
module: apps/roadmap
problem_type: build_error
component: tooling
symptoms:
  - "Railway build failed during `pnpm --filter roadmap build`"
  - "Next.js reported `Failed to collect page data for /person/[person]`"
  - "Local reproduction failed with `TypeError: a.start_date.localeCompare is not a function`"
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags:
  - roadmap
  - nextjs
  - frontmatter
  - gray-matter
  - railway
  - static-generation
---

# Roadmap frontmatter type drift can crash Next.js static page-data collection

## Problem

`apps/roadmap` builds static pages from markdown files under `docs/roadmap/`.
Some roadmap frontmatter values had drifted from the parser's assumed types:
dates parsed as `Date` objects, durations and statuses were legacy strings, and
relationship fields were not always shaped like string arrays. During
`next build`, the `/person/[person]` static route sorted feature data and crashed
before Railway could build the image.

## Symptoms

- Forge/Railway deployment stopped in **Build > Build image**.
- The failing command was `pnpm --filter roadmap build`.
- Next.js surfaced `Failed to collect page data for /person/[person]`.
- Local reproduction narrowed the immediate crash to
  `TypeError: a.start_date.localeCompare is not a function`.

## What Didn't Work

- Looking only at the route component was misleading. The page was fine; the
  failure came from data parsed during `generateStaticParams` and page-data
  collection.
- Normalizing one malformed ticket would have unblocked only the current build.
  The real boundary was `apps/roadmap/lib/features.ts`, where untrusted markdown
  frontmatter crossed into typed feature data.
- Coercing all scalars with `String(value)` made the build more tolerant but
  created bad routes and owners when required fields such as `id`, `title`, or
  `owner` were accidentally booleans or numbers.

## Solution

Harden the parser boundary in `apps/roadmap/lib/features.ts` and keep source
docs tidy:

```ts
function normalizeString(value: unknown): string {
  if (typeof value === "string") return value.trim()
  return ""
}

function normalizeStartDate(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ""
    return normalizeDateString(value.toISOString().slice(0, 10))
  }
  return typeof value === "string" ? normalizeDateString(value.trim()) : ""
}

function normalizeDateString(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ""

  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ""

  return date.toISOString().slice(0, 10) === value ? value : ""
}
```

The hotfix also normalized:

- legacy priorities such as `high`, `medium`, and `low`
- legacy statuses such as `completed`, `implemented`, `planned`, and
  `cancelled`
- durations written as strings like `3 days`
- relationship fields so only arrays of strings become `depends_on`, `blocks`,
  or `tags`

The source files that triggered the build failure were cleaned up so new docs
match the current schema.

## Why This Works

Next.js static generation executes data-loading paths at build time. For the
Roadmap app, markdown frontmatter is deployment input, not trusted TypeScript
data. Normalizing at the parser boundary keeps every generated route and sort
operation working with stable primitives, while strict required-string handling
prevents accidental boolean or numeric frontmatter from becoming real owner or
route slugs.

Date validation matters separately from type normalization. A string like
`soon` has the right JavaScript type but still poisons timeline math. The
round-trip `YYYY-MM-DD` check rejects invalid strings and impossible dates
before they can reach the timeline and static markdown generators.

## Prevention

- Treat `apps/roadmap/lib/features.ts` as the only trust boundary for roadmap
  markdown. Route components should receive already-normalized `Feature` data.
- When a build fails during `Collecting page data`, reproduce with the exact
  filtered app build command before editing the route:

  ```bash
  pnpm --filter roadmap build
  ```

- Add parser-boundary checks for malformed frontmatter when changing roadmap
  schemas. Useful fixtures include YAML dates, numeric durations, scalar
  relationship fields, legacy statuses, and invalid date strings.
- Keep deployment smoke tied to the Railway command, not just TypeScript or
  lint:

  ```bash
  pnpm --filter roadmap lint
  pnpm --filter roadmap build
  ```

- When the hotfix also adds plan or solution markdown, run the repo-level
  formatter check before pushing:

  ```bash
  pnpm run format:check
  ```

## Related Issues

- [Railway + Next.js monorepo deployment: standalone mode pitfalls and runtime file access](../deployment/nextjs-pnpm-monorepo-railway-standalone.md)
