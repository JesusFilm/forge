---
title: "An unwired optional consent prop disabled all Watch analytics"
date: "2026-09-10"
module: "Web Watch analytics"
problem_type: "integration_issue"
category: "integration-issues"
component: "service_object"
severity: "high"
symptoms:
  - "Configured Watch pages emitted no Google Analytics requests"
  - "Datadog RUM initialization also stopped"
root_cause: "logic_error"
resolution_type: "code_fix"
tags: [web, analytics, consent, regression, caller-contract]
---

## Cause

PR #1976, merged August 31 at 03:23 UTC, added `analyticsConsent = false`
to `GoogleAnalytics` and `DatadogRum`. The production callers in
`apps/web/src/app/[locale]/[htmlLang]/layout.tsx` continued to mount both
without props. Recommendation consent had no analytics signal to supply.
Both integrations became permanently disabled even with valid configuration.

The updated component tests explicitly supplied `analyticsConsent` in successful
cases. They verified an invocation that production never used, allowing the
application-level regression to survive.

## Fix and verification

Revert the two analytics gates to their pre-#1976 environment-configured
initialization. Keep recommendation personalization and withdrawal behavior
unchanged. Tests must exercise the actual no-prop production invocation, along
with missing configuration, route changes, custom events, and RUM rerenders.
The four relevant assertions failed before the fix and passed afterward.

A live browser baseline on `/watch/jesus.html` returned HTTP 200 but no GA
scripts, `gtag`, or analytics requests. A local fixture using the real React
components, Next Script implementation and Datadog SDK restored initialization,
navigation reporting, and custom events. It used synthetic configuration and
intercepted external traffic; this is not proof of production receipt.

Local loading evidence: the bundled fixture shrank from 501,913 to 501,844 bytes.
GA started at 144 ms after a 133 ms load event, with Chromium reporting the
resource as nonblocking. Both scripts retained `afterInteractive` and `async`.
These fixture timings establish loading behavior, not production Web Vitals.

## Prevention

When changing the default behavior of a shared component, search every caller
and exercise at least one caller's real invocation in regression coverage.
An optional prop can preserve TypeScript compatibility while silently changing
all existing callers' behavior. Keep the restored analytics active on configured
deployments under `docs/analytics-and-recommendation-policy.md`; future tickets
and migrations must preserve page views, navigation, Watch events, and Datadog
RUM without a consent prerequisite.

Related: `docs/roadmap/platform/feat-476-restore-watch-analytics.md` and
`docs/solutions/conventions/frontend-change-page-load-performance-verification.md`.
