---
title: Legacy Watch host redirects publication POST to a 405 GET
date: 2026-09-24
category: integration-issues
module: admin-web-watch-revalidation
problem_type: integration_issue
component: service_object
symptoms:
  - Admin publication webhooks receive HTTP 405 while the Web receiver supports POST.
  - A one-off direct POST to the canonical receiver succeeds but later publications still fail.
root_cause: config_error
resolution_type: config_change
severity: high
tags: [watch, revalidation, railway, redirect, cache]
---

# Legacy Watch host redirects publication POST to a 405 GET

## Problem

Admin's `WEB_REVALIDATE_URL` pointed at
`https://watch.jesusfilm.org/watch/api/revalidate`. The legacy host returned a
301 to `https://www.jesusfilm.org/watch/api/revalidate`. The webhook's normal
redirect following converted POST to GET, and Web's POST-only route returned 405. Content publication succeeded in Admin while the public cache could remain
stale.

## Symptoms

- Admin's `web_revalidate.failed` records showed HTTP 405 for experience,
  watch-setting, and route-manifest events.
- A direct authorized POST to the canonical URL returned 200, but that one-off
  refresh did not repair Admin's persisted URL.
- An invalid-token diagnostic POST returned 301 from the legacy host, 405 after
  following its redirect, and 401 directly on the canonical host.

## What Didn't Work

Manually posting to the canonical receiver refreshed the current page only.
Subsequent Admin events kept using the old configured host. The event contract
and authentication token were already correct, so changing the receiver or
rotating its secret would not address the redirect.

## Solution

Set only production Admin `WEB_REVALIDATE_URL` to the canonical `www` URL in
Railway with `--skip-deploys`, then activate it through the normal PR-to-main
Git deployment. Keep `WEB_REVALIDATE_TOKEN` and Web's `REVALIDATION_SECRET`
unchanged and confirm equality in memory without printing values. The repair
was recorded in [PR #2411](https://github.com/JesusFilm/forge/pull/2411).

After Admin deployment `d2620ad26886904b36bc1ea51c3457ee6642fbb5`, the
running service reported the canonical URL. A controlled replay through the
deployed `emitRevalidateWebhook` helper returned HTTP 200 for the three event
shapes. Web HTTP logs independently recorded the corresponding POST 200s. A
published low-traffic Watch route was HIT before one final route-manifest
replay, then MISS on the immediate GET, then HIT after regeneration. No content
was edited or republished in this verification.

## Why This Works

The Admin helper sends a Bearer-authenticated POST and follows redirects by
default. Sending it directly to the receiver avoids the 301 method rewrite.
Web's 200 response follows path invalidation and attempted tag invalidation;
tag failures are reported separately. The HIT → MISS → HIT probe demonstrated
the public cache entry was invalidated and rebuilt.

## Prevention

- Configure production webhook URLs with the final receiver origin and exact
  path. Probe redirect behavior with POST, not only GET or HEAD.
- Verify the running service's revision and effective URL after the normal Git
  deployment. A staged Railway variable alone does not prove runtime activation.
- When checking a Railway variable change, compare **unrendered** values or
  the mutation's exact key set. `variable list --json` returns rendered values:
  a stable template/reference such as the Admin `WORKFLOW_HMAC_SECRET` source
  produced a different rendered 64-character value on each read. Comparing two
  rendered maps falsely suggested an unrelated secret had changed. Never print
  either the source or rendered secret when diagnosing this.
- For a busy public path, an immediate cache HIT can mean another request
  already regenerated it. Use one bounded low-traffic affected route to capture
  HIT → MISS → HIT; label response-time patterns as inference, not proof.

## Related

- [feat-531 roadmap ticket](../../roadmap/platform/feat-531-repair-production-watch-revalidation-endpoint.md)
- [Watch production readiness](../../operations/web-production-readiness.md)
