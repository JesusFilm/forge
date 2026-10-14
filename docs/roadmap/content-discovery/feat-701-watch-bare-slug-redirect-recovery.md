---
id: "feat-701"
title: "Recover Watch bare slug and legacy duplicate links"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-14"
duration: 1
depends_on: []
blocks: []
tags: ["web", "watch", "routing"]
---

## Problem

Related Linear FGE-203 / W-070. On 2026-10-14 production
`/watch/jesus` redirects to `/watch/jesus.html/jesus.html`, whose HTTP 200
response has `Page not found` title and `noindex`. The canonical
`/watch/jesus.html` serves the content. The bare Easter route has the same
legacy duplicate redirect. This ticket covers link recovery only.

## Entry Points — Read These First

- `apps/web/src/lib/url-canonicalize.ts`: Rule 5, `canonicalizeWatchPath`.
- `apps/web/src/proxy.ts`: `classifyOneSegmentAdmission`, duplicate episode gate.
- `apps/web/src/lib/url-canonicalize.test.ts` and `apps/web/src/proxy.test.ts`.

## Grep These

- `Rule 5`, `classifyOneSegmentAdmission`, `parentSlug ===`
- `legacy duplicate`, `equal-name episode`

## What To Build and Constraints

- Append `.html` once for safe bare slugs; preserve query parameters and
  reserved routes. Do not duplicate the slug.
- Recover legacy equal-segment links only when the same one-segment admission
  contract admits a destination, including known language-gap sentinels.
- Keep exactly admitted episodes ahead of duplicate recovery.
- Use temporary 307 recovery: a stale manifest cannot justify permanent
  steering of an equal-name episode.
- Preserve Unicode URL admission, unsafe URL rejection, and manifest-outage
  behavior. No rendering, hydration, media or client initialization changes.

## Verification

- Node 24: 317 tests pass across `src/proxy.test.ts`,
  `src/lib/url-canonicalize.test.ts`, and `src/lib/routes.test.ts`.
- The equal-name episode test fails when exact episode admission is bypassed,
  then passes after restoring the guard.
- Web typecheck, touched ESLint, Prettier, normal commit hooks, fresh CI and
  exact Web preview deployment.
- Read-only production redirect chain after normal PR deployment. Native browser confirms the
  current duplicate destination is a missing page while the direct canonical
  page renders JESUS. No playback validation claim.

## Remaining Issue Acceptance

FGE-203 also requests direct rejection of unknown bare slugs. This PR keeps
one redirect before rejection: the cached manifest lacks freshness provenance
and must not veto newly published content based on a stale snapshot. This
narrow ticket does not complete all FGE-203 acceptance. Keep that issue open.
