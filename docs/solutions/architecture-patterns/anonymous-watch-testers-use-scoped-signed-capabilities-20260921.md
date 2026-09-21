---
title: "Identify anonymous Watch testers with a scoped signed capability"
date: "2026-09-21"
category: "architecture-patterns"
module: "apps/web homepage recommendation targeting"
problem_type: "architecture_pattern"
component: "authentication"
severity: "medium"
applies_when:
  - "A private feature pilot needs stable tester targeting without an exposed login flow"
  - "A runtime flag must remain independent of statically cached Watch pages"
tags:
  - "watch"
  - "launchdarkly"
  - "tester-access"
  - "signed-cookie"
---

# Identify anonymous Watch testers with a scoped signed capability

## Context

Existing account-session helpers do not prove a product exposes a login flow.
Watch visitors could not acquire the account identity that an email-based
homepage recommendation flag rule expected. The pilot needed browser targeting
without introducing visible authentication UI.

## Guidance

Keep tester eligibility separate from account identity. An operator issues a
short-lived, origin-bound signed link with an opaque UUID and feature scope.
Exchange it for a distinct-purpose signed HttpOnly cookie. Send only the
verified UUID in a dedicated LD context kind; never treat an email/query/local
storage value as authenticated identity or create an account session for it.

`apps/web/src/lib/recommendation-tester-token.ts` pins algorithm, issuer,
audience, scope, and maximum lifetimes using `jose`. Activation and session
audiences differ so a copied link token cannot be used directly as a cookie.
Repeat activation cannot extend the original seven-day bound. No issuance
endpoint exists; the operator CLI reads a separate server secret.

Keep bearer tokens out of HTTP URLs: a standalone HTML route reads a fragment,
clears it from history, posts it under the existing bounded same-origin JSON
policy, and redirects to a fixed destination. The bridge loads no analytics or
app assets, uses restrictive CSP, and is private/no-store. Normal Watch pages
and their configured analytics stay unchanged.

The shared recommendation gate validates the cookie only on dynamic API
requests, then evaluates the existing LD flag. A verified cookie is eligibility
to evaluate a tester context; it never bypasses LD or the environment kill
switch. The existing account/anonymous fallback remains intact.

## Limits and verification

These links are bearer capabilities and are reusable until expiry. Their
holders can share tester eligibility. Use them for a preview of public-content
features, not private account authorization. Removing an LD target stops later
evaluations after SDK propagation; it does not erase already rendered cards.

Test the real signing-to-cookie-to-availability chain, invalid/missing secrets,
cross-origin activation, token confusion, expiry, and per-request revocation.
Test the emitted bridge script through timeout and failed-network paths. A
mocked LD decision and a local HTTP smoke prove different boundaries from a
live browser using production LD; record those limits separately.

The release review also caught a test-harness detail: parse the generated HTML
with `DOMParser` in a jsdom test before extracting its script for VM execution.
Regex extraction missed HTML case and closing-tag whitespace rules. CodeQL's
separate code-scanning check reported that matcher after the main CI gate
passed. Check both the CI gate and security annotations before merging;
the successful build and test jobs alone did not establish merge readiness.

Check the public edge response as well as the origin. The first production
probe found Cloudflare's analytics beacon appended to the bridge with the
origin's CSP nonce, despite the origin emitting only its own inline script.
Use `Cache-Control: private, no-store, max-age=0, no-transform` on this isolated
HTML response and verify the public response contains only the bridge script.
Cloudflare documents that `no-transform` prevents automatic beacon injection:
[Web Analytics setup](https://developers.cloudflare.com/web-analytics/get-started/).
Retain the existing cache restrictions; this exception belongs only to the
credential bridge, not normal Watch pages or their configured analytics.

## Related

- [Tester operations and release verification](../../operations/watch-recommendation-tester-access.md)
- [Keep runtime flags out of static routes](../integration-issues/watch-runtime-feature-flag-static-route-cache.md)
- [Kill-switch completeness follows data lifetime](kill-switch-completeness-follows-data-lifetime.md)
