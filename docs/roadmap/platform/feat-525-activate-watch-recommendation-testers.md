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
