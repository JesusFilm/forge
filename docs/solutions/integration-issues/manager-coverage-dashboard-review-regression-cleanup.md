---
title: "Manager Coverage Dashboard Review Regression Cleanup"
category: integration-issues
date: 2026-03-28
severity: high
tags:
  - manager
  - next-js
  - strapi-auth
  - dashboard
  - empty-state
  - review
affected_components:
  - apps/manager/src/app/api/videos/route.ts
  - apps/manager/src/app/dashboard/layout.tsx
  - apps/manager/src/features/coverage/coverage-report-client.tsx
  - apps/manager/src/features/nav/dashboard-nav.tsx
related_docs:
  - docs/solutions/platform/videoforge-manager-integration.md
---

# Manager Coverage Dashboard Review Regression Cleanup

## Problem

A manager dashboard refresh introduced a mix of valid UX changes and four regressions in the same slice:

1. The manager dev script no longer used the documented local port.
2. The new CMS shortcut reused the internal-only `STRAPI_URL` in browser UI.
3. Metadata coverage was hard-coded to `none`.
4. The coverage page treated a successful empty `/api/videos` response as a server outage.

The port mismatch was specifically a contract drift problem:

- `apps/manager/package.json` stopped pinning `next dev` to `3002`
- manager docs still documented `3002`
- local `.claude/launch.json` still expected manager on `3002`

That combination breaks local multitarget workflows because manager falls onto Next's default `3000`, which collides with the web app.

## Root Cause

Two patterns caused most of the trouble:

1. **Server-only configuration leaked into the client.** `STRAPI_URL` is correct for server-to-server auth and GraphQL fetches, but not for browser navigation.
2. **Fetch state and data state were collapsed into one signal.** The client used `collections.length === 0` to mean both "no videos exist" and "the server failed."

The metadata regression was simpler: `aiMetadata` was removed from the query while the UI still exposed a Meta coverage report.

## Solution

### Keep browser links separate from internal service URLs

Remove the CMS menu link rather than inventing a public URL contract mid-fix. Keep the user menu limited to information and sign-out until the app has an explicit browser-safe admin URL.

### Restore real metadata coverage

Put `aiMetadata` back in the videos GraphQL query and reuse it when deriving the `meta` coverage state.

### Split empty data from fetch failure

Track video load failure explicitly in the coverage client:

- non-OK or failed `/api/videos` requests set a failure flag and render outage UI
- successful empty responses render a true empty state
- coverage controls are hidden only for actual error states, not merely because collection count is zero

### Remove dev-only artifacts from the slice

Restore manager's `dev` script to port `3002` and drop `.claude/launch.json` from the repo change.

```json
// Before
"dev": "next dev"

// After
"dev": "next dev --port 3002"
```

## Prevention

1. Treat internal service URLs as server-only unless there is a separate browser-safe public URL contract.
2. Model API UI state with at least three outcomes: loading, loaded, and failed.
3. When a UI still exposes a report type, keep the underlying query fields that drive it unless the report is removed in the same slice.
4. Keep local-dev port contracts in one place and mirror them across:
   - app `package.json`
   - app docs
   - checked-in launcher/config files, if any
5. Remove machine-local launch/editor files from the scoped change before opening a PR.

## Related References

- `apps/manager/package.json`
- `apps/manager/CLAUDE.md`
- `docs/solutions/platform/adding-new-apps.md`
