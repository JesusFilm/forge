---
id: "feat-790"
title: "Migrate installed TV beta feedback to the recreated staging hostname"
owner: "ekkasit"
priority: "P1"
status: "not-started"
start_date: "2026-10-27"
duration: 1
depends_on:
  - "feat-789"
blocks: []
tags:
  - tv
  - feedback
  - release
---

## Problem

The original Railway web service was deleted on 25 October 2026. The recreated
staging service uses `https://web-staging-7801.up.railway.app`. Existing store beta
artifacts still contain the former `web-staging-920a.up.railway.app` URL. The
simulator recovery deliberately does not rebuild or upload release artifacts.

## Work

- Inspect `apps/tv/src/lib/feedbackUrl.ts`, `apps/tv/src/components/feedback/useFeedbackQr.ts`
  and EAS environment configuration for `EXPO_PUBLIC_TV_FEEDBACK_URL`.
- Coordinate any release configuration change and new TestFlight/Google Play beta
  builds with the owner. Simulator success does not authorize store releases.
- Preserve normal native verification. New staging currently allows Apple build
  15 and Android version 11, based on the latest verified beta artifacts. Update
  allowlists deliberately for future releases; never use simulator authorization
  in a release build.
- Verify real Apple DeviceCheck and Play Integrity, phone QR claim, annotated
  media and confirmed Linear receipt. Obtain approval for new real test tickets.
- Keep the rotated credentials and current Turnstile widget; both staging
  hostnames are in its provider allowlist. Never place secrets in the TV app.

## Evidence

The current recovery record is `apps/tv-feedback/DEPLOYMENT.md` and the local
`.local-tools/feedback-staging-20261027/` directory in the feature worktree.
