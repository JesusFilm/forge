---
id: "feat-476"
title: "Restore Watch analytics after consent regression"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-09-10"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "analytics"
  - "observability"
---

## Problem

PR #1976 added optional `analyticsConsent = false` gates to Google Analytics
and Datadog RUM. The Watch layout passes neither prop, and the recommendation
consent shell has no analytics signal. Configured deployments therefore stopped
initializing both integrations after the August 31 merge.

## Entry Points - Read These First

1. `apps/web/src/components/GoogleAnalytics.tsx` - bootstrap and route tracking.
2. `apps/web/src/components/DatadogRum.tsx` - browser observability initialization.
3. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` - actual production callers.
4. `docs/plans/2026-09-10-002-fix-watch-analytics-plan.md` - bounded rollback.

## Grep These

- `analyticsConsent`
- `GoogleAnalytics`
- `DatadogRum`

## What To Build

Restore the pre-#1976 environment-configured initialization for both analytics
components. Cover their no-prop production callers, missing configuration,
navigation, custom events, and duplicate initialization.

## Constraints

- Preserve explicit recommendation personalization, reset, and deletion controls.
- Keep the restored GA page views, navigation, Watch events, and Datadog RUM in place under `docs/analytics-and-recommendation-policy.md`.
- Preserve GA's `afterInteractive` loading and the static Watch layout.
- Use the normal PR-to-main production deployment path.

## Verification

- Run the analytics, Watch layout, Watch event, and recommendation consent tests.
- Run Web typecheck, lint, and changed-file formatting checks.
- Check browser resource timing and async script loading with synthetic analytics
  configuration; report local proof separately from production recovery.

## Completion Notes

- Reverted the two unwired analytics gates to their pre-#1976 implementations.
- Four regression assertions failed before the revert; all 51 focused tests
  passed afterward, including Watch event and recommendation cookie tests.
- The real-component browser fixture initialized GA and RUM, recorded navigation
  and custom events, and retained asynchronous, nonblocking GA loading.
- Production baseline confirmed no GA script, `gtag`, or analytics requests on
  `/watch/jesus.html`. Post-merge recovery evidence belongs in the PR.
