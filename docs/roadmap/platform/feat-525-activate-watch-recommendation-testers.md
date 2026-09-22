---
id: "feat-525"
title: "Activate and verify the three-person Watch recommendation pilot"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-21"
duration: 1
depends_on:
  - "feat-524"
blocks: []
tags:
  - "web"
  - "recommendations"
  - "launchdarkly"
---

## Problem

The tester-link code and LD targets are prepared, but production activation
requires the normal merged deployment, a signing secret, and browser evidence.
Code completion must not be mistaken for a working production pilot.

## Entry Points — Read These First

1. `docs/operations/watch-recommendation-tester-access.md`
2. `apps/web/scripts/create-recommendation-tester-link.ts`
3. `apps/web/src/lib/homepage-recommendations-flag.ts`

## Grep These

- `WATCH_RECOMMENDATION_TESTER_SECRET|WATCH_FOR_YOU_ENABLED`
- `forge.watch.homepageRecommendations|HomepageRecommendationsBlock`

## What To Build

- Verify feat-524 was merged and deployed through PR-to-main.
- Prevent edge script injection into the activation bridge with a scoped
  `no-transform` response, then verify the public HTML after deployment.
- Provision the dedicated Web signing secret through the service's normal
  secret-management process, then verify canonical origin and LD SDK environment.
- Issue private links for the three existing opaque targets; do not place
  links, JWTs, or secrets in repository evidence.
- Extend activation and cookie validity to 30 days from link issuance, as
  requested on 2026-09-22. Repeat activation must not move that deadline;
  existing signed expirations and per-request LD revocation remain effective.
- Verify false availability in a fresh browser, true after targeted activation,
  and false again after removing a disposable verification target.
- Verify the homepage block publication state and complete publication through
  the authorized content rollout before asserting the row is visible.

## Constraints

- No direct production deployment from a worktree or public rollout.
- Preserve all existing recommendation operational and publication controls.
- Confirm recipients/channel authorization before sending links to other people.
- Distinguish HTTP/VM tests from real-browser production evidence.

## Verification

Record deployed SHA, configuration presence (never values), LD environment,
availability outcomes, and browser redirect/cookie behavior in the operations
document. Check ordinary Watch loading and confirm only the existing
recommendation row changes for eligible testers. Keep this ticket open until
the real three-person pilot is verified.

## Progress — 2026-09-22 NZ

Tester exchange and edge-isolation releases are deployed; the signing secret
is configured and the three HTTP activations succeeded. The missing English
homepage block was restored through the deployed Admin publishing service,
preserving all existing content. Public GraphQL and Watch HTML contain it.
Canonical revalidation succeeded after the configured legacy-host webhook
returned 405; feat-531 tracks that separate configuration repair.

The Watch Production SDK key deployed through PR #2372. Live HTTP verification
at 22:13 UTC on 2026-09-21 returned availability true and six served cards for
all three testers, with false availability and denied delivery for an
untargeted signed identity. Anonymous availability remained false.

The owner subsequently requested longer-lived links. Activation and cookie
validity are being extended to 30 days from issuance, preserving manual LD
revocation and existing signed expiry dates. Replacement links must follow
the normal deployment and live verification.

Still required: observe real cards in the browser. Successful HTTP delivery
does not establish browser rendering. See the operations document for release
IDs, public HTTP measurements, and verification limits.
