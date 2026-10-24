---
title: "Watch download modal safeguards can regress independently"
date: "2026-07-24"
category: docs/solutions/ui-bugs
module: apps/web
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "The single-video download modal opened without a visible poster"
  - "Download was enabled without the viewer confirming the Terms of Use"
  - "Quality choices exposed file sizes that the product no longer wanted shown"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - "Watch download poster resolution"
  - "Watch download session gate"
  - "Watch download proxy"
tags:
  - "watch-page"
  - "download-modal"
  - "terms-of-use"
  - "poster"
  - "quality-selector"
  - "regression-test"
---

# Watch download modal safeguards can regress independently

## Problem

The Watch single-video download modal lost three user-facing parts of its
contract at once: its poster, mandatory Terms confirmation, and product-approved
quality labels. Because file selection and the account gate still worked, the
modal looked functional while allowing downloads without the required consent.

## Symptoms

- The media summary rendered an empty or fallback image instead of the authored
  editorial poster.
- The Download action was enabled as soon as a quality was available.
- The selected quality and dropdown options included MB or GB values.
- Opening the modal could issue background `HEAD` requests solely to discover
  those file sizes.

## What Didn't Work

- Treating account authentication as the only download safeguard did not replace
  the separate per-open Terms confirmation required by the product flow.
- Falling back to Mux before the authored image could hide the editorial poster
  even when Watch data supplied one.
- Repairing missing size metadata with proxy `HEAD` requests preserved copy the
  product no longer wanted and added unnecessary modal-open network traffic.
- A full local Watch-route smoke was not reliable with an incompatible Admin
  snapshot. Rendering the actual modal component with representative production
  props provided browser evidence without replacing its implementation.

## Solution

Model the three safeguards as independent contracts:

1. Resolve the authored poster first, upgrading supported image-delivery
   dimensions when possible, and use Mux only as the fallback.
2. Keep a modal-local Terms agreement state. Require it in `canDownload`, reset
   it whenever the outer modal closes, and let the nested Terms dialog accept or
   cancel without closing the download modal.
3. Render only localized quality names. Remove size formatting and the proxy
   probing pipeline rather than hiding only one copy surface.

The effective enablement condition remains explicit:

```ts
const canDownload = tosAgreed && selected != null && !authChecking
```

The account/session check still runs when Download is clicked. The Terms
agreement is an additional UI prerequisite, not a replacement for server-side
authorization.

## Why This Works

The regression combined independent data, consent, and presentation concerns.
Giving each concern its own assertion prevents a working quality selector or
auth check from masking a broken poster or missing agreement. Resetting consent
on close also prevents one acceptance from silently authorizing later modal
sessions.

## Prevention

- Assert that Download starts disabled and becomes enabled only after Terms
  acceptance.
- Cover nested Terms cancel, close, backdrop, Escape, and accept behavior while
  confirming the outer modal remains open.
- Reopen the modal in tests and assert that consent and explicit quality
  selection reset.
- Assert that no rendered quality label contains MB or GB and that opening the
  modal issues no size-discovery `HEAD` requests.
- Test poster precedence at both the resolver and Watch-page-to-modal prop
  boundary.
- Browser-smoke the actual modal component at desktop and mobile widths when
  the full Watch route is blocked by local data or service incompatibility.

## Related Issues

- [base-ui Dialog open/close state: inspect data-open / data-closed, not element presence](../best-practices/base-ui-dialog-state-attribute-detection-20260520.md)
- [Watch staged client loading](../performance-issues/watch-staged-client-loading-20260611.md)
- [feat-310: Restore Watch download modal safeguards](../../roadmap/platform/feat-310-watch-download-modal-safeguards.md)
