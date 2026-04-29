---
title: "Manager Tailwind visual parity from a reference branch"
category: ui-bugs
date: 2026-04-29
tags:
  - manager
  - tailwind
  - visual-parity
  - browser-verification
---

# Manager Tailwind Visual Parity From A Reference Branch

## Problem

A Tailwind migration made the current Manager branch visually drift from a known-good reference branch. The target was not a redesign: `http://localhost:9002` needed to match `http://localhost:9102` as closely as possible across desktop and mobile screens.

## Symptoms

- Coverage, Agents, Jobs, and Job Detail looked close but not identical.
- Some branch-local functional work, especially API cache and mock-CMS behavior, needed to stay intact while restoring the older visual layer.
- Login screenshots could differ because the auth background is intentionally randomized.

## Solution

Run both branches locally against the same CMS data source, then restore UI files from the reference branch and reapply only the current branch's functional deltas.

Use a reference commit or branch as the visual source of truth:

```bash
git restore --source=<reference-commit> -- apps/manager/src/app/dashboard apps/manager/src/features apps/manager/src/components/ui apps/manager/src/app/globals.css
```

Do not blindly restore API routes or cache modules. In this case, the current branch owned newer cache and mock-CMS behavior under paths such as:

- `apps/manager/src/app/api/coverage-snapshots/cache.ts`
- `apps/manager/src/app/api/languages/cache.ts`
- `apps/manager/src/app/api/videos/cache.ts`

After restoring the visual files, preserve data behavior explicitly:

- Keep mock gateway support from `getCmsGateway()` for local single-process Manager runs.
- Keep stable SWR cache helpers for languages, coverage snapshots, and filtered video coverage.
- Keep branch-only UI behavior such as automation dry-run controls if `main` has added it since the reference branch.

## Verification

Use rendered browser output, not code inspection alone. Compare the same routes at both ports and at both desktop and mobile sizes:

- `/dashboard/coverage`
- `/dashboard/agents`
- `/dashboard/jobs`
- `/dashboard/jobs/[id]`
- `/dashboard/design-system`

When content is deterministic, screenshot hashes should match. If a screen intentionally randomizes media, as login did here, verify code parity and layout rather than expecting byte-identical screenshots.

Run the Manager checks after the visual restore and after any conflict resolution:

```bash
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/manager lint
pnpm --filter @forge/manager test -- src/app/api/coverage-snapshots/route.test.ts src/app/api/languages/route.test.ts src/app/api/videos/route.test.ts src/app/api/videos/route.mock.test.ts src/app/login/page.test.ts
git diff --check
```

## Prevention

- Treat visual parity branches as source restoration tasks first, then adaptation tasks.
- Keep API/cache routes out of broad UI restores unless the reference branch is also the desired runtime source.
- Compare mobile and desktop before declaring parity.
- If the branch is old, merge current `main` before final review so roadmap IDs, mock-data behavior, and lockfile changes do not surprise the PR at merge time.

## Related

- `docs/solutions/platform/restoring-upstream-ui-verbatim.md`
