# Recommendation and analytics policy

Product decision: September 10, 2026. This document supersedes consent
prerequisites in earlier recommendation and analytics plans, tickets, research
recommendations, and runbooks.

## Delivery health and accepted coverage

Owner decision: October 2, 2026. This section supersedes interpretations in
earlier reports, plans and tickets that treat empty/partial recommendation rows
or unobserved co-watch cards as unresolved delivery bugs by themselves.

Recommendations are working as intended when they return eligible cards where
available and handle insufficient supply with a valid partial row, empty result
or supported fallback. Missing translations, transcripts, exact-audio inventory,
approved fallback pools or supported co-watch edges are accepted coverage
limitations. They do not block proceeding with the product. Expanding coverage
is optional product work under the existing coverage tickets, not a prerequisite
for calling delivery healthy or a reason to reopen completed repairs.

Classify observations using their recorded cause:

| Observation                                                                                                                | Classification and action                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Empty/partial result because required content or eligible matches are unavailable                                          | Accepted coverage limitation. Report the affected context; no bug or release blocker based on row size alone.                              |
| Co-watch has no supported edges and the normal recommendation fallback succeeds                                            | Expected fallback. Zero contributed co-watch cards alone is not a delivery failure or a gate on proceeding.                                |
| Server/GraphQL error, retrieval or complete-service timeout, failed issuance/persistence, or broken player availability    | Reliability issue. Investigate and repair; a fallback or HTTP 200 must not hide a recorded internal error.                                 |
| Reproduced incorrect filtering, wrong language/audio, invalid publication/playback or other eligibility-contract violation | Correctness defect. Preserve the existing contracts and repair the demonstrated behavior.                                                  |
| No reason or incomplete diagnostics                                                                                        | Unknown cause. Perform a bounded check before classifying it; neither a defect nor catalogue absence is established by an empty row alone. |

The bounded semantic composer may fill remaining slots with eligible reserves;
when none remain, serve the existing cards unchanged. Curated fallback remains
empty-only for seeded delivery. Preserve exact language/audio, active embedding
contracts, publication/playability, family exclusions, canonical deduplication,
privacy and the complete-service deadline. Coverage acceptance does not authorize
relaxing those rules or manufacturing co-watch viewing evidence.

For audits, report delivery reliability separately from coverage and generator
usage. “No co-watch cards observed” is a usage observation; report actual cards
only with their provenance, without turning that observation into a delivery
blocker. Refresh/authority lifecycle verification remains an operational task.
Require fresh error evidence or a reproduced contract defect to reopen a
completed delivery repair. Historical pre-fix reports describe their dated
window, not the current deployment. A bounded search returning no candidates
does not prove the entire catalogue lacks a match, and the request ledger cannot
rule out errors that occurred before a ledger row was written.

The owner accepted the post-repair observations in the
[October 2 coverage disposition](reports/2026-10-02-recommendation-coverage-acceptance.md).
The exact-audio and Chinese identity defects were repaired and deployed in
[PR #2527](https://github.com/JesusFilm/forge/pull/2527).

## Roadmap scope after October 2 closeout

The owner's final closeout request authorizes retiring obsolete or optional
recommendation programme work. The path-specific authority and evidence live in
the [closeout record](reports/2026-10-02-recommendation-roadmap-closeout.md).
Apply that record before historical implementation plans. Preserve existing
semantic/profile/co-watch delivery, controls, analytics and operational
contracts. A cancelled study leaves usefulness unmeasured; a cancelled generator
does not remove existing product behavior. Capacity and refresh lifecycle gates
remain separate from accepted coverage limitations.

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
