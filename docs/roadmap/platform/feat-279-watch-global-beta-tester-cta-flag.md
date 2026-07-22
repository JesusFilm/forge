---
id: "feat-279"
title: "Watch global beta tester CTA feature flag"
owner: "unassigned"
priority: "P2"
status: "in-progress"
start_date: "2026-07-21"
duration: 1
depends_on:
  - "feat-252"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "launchdarkly"
---

## Problem

The floating `Become a beta tester` CTA added by feat-252 is visible on every
Watch route without an operational rollout control. It should be hidden by
default and shown only when a temporary LaunchDarkly release flag evaluates
true, while existing authored beta-tester links continue to open the shared
modal.

## Entry Points - Read These First

1. `apps/web/src/app/api/beta-tester-cta/route.ts` - dynamic, no-store server
   boundary for evaluating the flag without freezing it into static routes.
2. `apps/web/src/components/watch/BetaTesterModalProvider.tsx` - owns the
   global floating CTA and shared modal context.
3. `apps/web/src/lib/feature-flags.ts` - server-only Watch LaunchDarkly helper
   layer.
4. `packages/feature-flags/src/registry.ts` - typed flag registry and safe
   defaults.
5. `docs/solutions/platform/launchdarkly-feature-flag-foundation-20260527.md` -
   established server-side evaluation and fallback pattern.

## Grep These

- `global-beta-tester-cta`
- `BetaTesterModalProvider`
- `featureFlags.watchQuestionPanel`
- `FORGE_WATCH_QUESTION_PANEL_DEFAULT`

## What To Build

1. Add a temporary boolean flag named `forge.watch.globalBetaTesterCta` in the
   Watch LaunchDarkly project with targeting off in every environment.
2. Add the typed registry entry and the server-only Web helper with
   `FORGE_WATCH_GLOBAL_BETA_TESTER_CTA_DEFAULT=false` as the local fallback.
3. Evaluate the flag in a same-origin, force-dynamic, no-store server endpoint.
   Fetch that endpoint after provider hydration with an initial false state so
   static Watch routes remain cacheable and dashboard flips take effect after
   reload or navigation without a rebuild.
4. Do not render the floating CTA when disabled. Keep the provider and modal
   context mounted so authored home/section beta-tester actions still work.

## Constraints

- Do not add a client-side LaunchDarkly SDK or expose the server SDK key.
- Keep the missing-key, timeout, and invalid-variation fallback hidden.
- Do not gate authored beta-tester links or the modal itself.
- Do not eagerly load the Mailchimp iframe or modal chunk.

## Verification

- Focused tests cover default-off and local-override-on flag evaluation.
- Provider tests prove the global CTA is absent when disabled and visible when
  enabled, while a nested beta-tester trigger still opens the modal.
- Browser smoke proves the CTA is absent with the fallback false and visible
  with the fallback true, with a no-store endpoint request and no Mailchimp
  request before activation.
- Web lint, typecheck, focused tests, formatting, and diff checks pass.

## Implementation Progress

The code path is complete: the typed registry and false fallback are wired,
the client provider fails closed while preserving authored triggers, and the
runtime endpoint avoids capturing LaunchDarkly values in the Watch Full Route
Cache. Focused tests, lint, typecheck, browser proof, no-store headers, and warm
page timings pass.

Remaining operational step: create `forge.watch.globalBetaTesterCta` in the
Watch LaunchDarkly project with targeting off in every environment, then verify
the saved dashboard state. The local fallback already hides the CTA while the
remote flag is absent.
