# Recommendation and analytics enablement

Product decision: September 10, 2026. This document supersedes consent
prerequisites in earlier recommendation and analytics plans, tickets, research
recommendations, and runbooks.

## Enablement

Recommendations, anonymous recommendation profiles, profile learning, and
product analytics operate when their environment configuration and applicable
feature flags enable them. They require no prior consent, consent prompt,
consent receipt, or separate consent approval. An absent or undecided
personalization choice keeps the configured default behavior active.

Viewer controls for disabling personalization, reset, and deletion remain
effective. A saved choice to disable personalization affects profile use and
learning; it does not disable contextual recommendations or product analytics.
Retain integrity checks, retention, erasure, privacy-generation fencing,
payload minimization, and authenticated access controls. OAuth authorization
and unrelated content/download requirements have their own contracts.

Existing implementation names such as `RecommendationConsentTransition`,
`RecommendationConsentShell`, consent receipt fields, and SDK
`TrackingConsent.GRANTED` may remain in technical descriptions. They describe
runtime interfaces, not a requirement to obtain consent. This documentation
change does not rename those interfaces or claim that every existing runtime
check has been removed.

## Required Watch analytics

The analytics restored by [PR #2229](https://github.com/JesusFilm/forge/pull/2229)
must remain in place on configured deployments:

- GA initialization and the initial page view.
- Page views after client-side navigation.
- Existing Watch playback and interaction events, including search, language,
  download, and Share events.
- Datadog RUM initialization, views, actions, errors, and resource telemetry.

Keep `GoogleAnalytics` and `DatadogRum` mounted in the shared Watch layout.
Missing provider configuration keeps the relevant integration inactive; an
unwired consent prop or a recommendation preference must never do so.
Instrumentation migrations must preserve equivalent delivery throughout their
rollout and rollback. A migration flag selects the collector implementation;
turning it off restores the working collector rather than stopping analytics.
Removing or disabling this baseline requires an explicit product decision.

## Verification when analytics changes

Exercise the actual layout invocation and configured/unconfigured states in
`apps/web/src/components/__tests__/GoogleAnalytics.test.tsx`,
`apps/web/src/components/__tests__/DatadogRum.test.tsx`, and
`apps/web/src/app/[locale]/[htmlLang]/layout.test.tsx`. Preserve Watch event
coverage in `apps/web/src/components/watch/__tests__/WatchEventRecorder.test.tsx`.

Verify async, nonblocking loading and page-load performance. After deployment,
check provider receipt of an initial page view, a navigation page view, and a
real Watch interaction, plus fresh Datadog RUM events for the deployed release.
A mounted component or queued `dataLayer` entry alone does not prove delivery.

The September 10 production proof recorded HTTP 204 for GA `page_view` and
`share_opened`, HTTP 202 for Datadog intake, and indexed RUM events for release
`09c74a94840e08dd951082ff3a0c2d94b139d717`.
