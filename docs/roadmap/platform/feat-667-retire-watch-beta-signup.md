---
id: "feat-667"
title: "Retire Watch beta program signup"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "platform"
---

## Problem

The owner confirmed on 2026-10-08 that the beta testing program has ended and authorized removing all Watch beta signup entry points. PR #2673's request timeout is superseded by removing the request itself.

## Entry Points — Read These First

- `apps/web/src/components/WatchChromeShell.tsx` — global provider.
- `apps/web/src/components/home/WatchHomePromo.tsx` — homepage invitation.
- `apps/web/src/components/sections/CTASection.tsx` — authored signup links.
- `apps/web/src/components/watch/WatchQuestionPanel.tsx` — beta modal coordination.
- `apps/web/src/lib/feature-flags.ts` and `packages/feature-flags/src/registry.ts` — retired flag.

## What To Build

Remove the floating signup button, homepage invitation, signup modal/provider, runtime endpoint, and flag configuration. Suppress authored CTA sections targeting `https://mailchi.mp/jesusfilm/beta`, including query, fragment, and trailing-slash variants. Preserve other CTA destinations, feedback, search, question panels, analytics, and shared modal playback coordination.

## Verification

Run affected Web tests, shared feature flag tests, typechecks, lint, formatting, and diff checks. Verify local Watch homepage and series page have no beta signup or flag request. Compare warm series page request timings before and after the change.

## Completion Evidence

- Removed the global provider, modal, homepage invitation, runtime endpoint, Web env/helper, and shared registry flag.
- Suppressed authored signup sections for the retired URL, including trailing slash, query, and fragment variants; unrelated CTA destinations are covered by regression tests.
- 53 affected Web tests and 22 shared feature flag tests pass; both package typechecks pass.
- Local series and homepage render without beta signup, while feedback remains available. Browser resource timing records confirm zero beta flag requests. Warm series response median: 94 ms before, 83 ms after (development server comparison, not production Web Vitals).
- Beta translations remain as unused historical catalog entries; the global beta namespace is no longer sent to the client.

## Scope and Operational Notes

This ticket covers Watch web. Mobile and TV signup surfaces are outside this PR. The removed Web flag and environment override are no longer evaluated; any remaining LaunchDarkly flag or Railway override can be archived separately after merge.

Claude Code independently reviewed the complete diff through the authenticated Team seat and found no blocking code findings. Historical documentation now points to this retirement decision.
