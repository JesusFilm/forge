---
title: "Watch recommendation consent refresh must recover from transient delivery admission"
date: "2026-08-27"
category: "ui-bugs"
module: "apps/web Watch recommendations"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "Choosing Accept all can show Personalization could not be enabled even though the consent and profile requests succeeded."
  - "The recommendation block can switch to its unavailable state immediately after a profile-change refresh."
  - "Waiting and reloading makes the same personalized delivery work, which makes the failure appear intermittent."
root_cause: "async_timing"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/admin recommendation delivery admission"
  - "apps/web recommendation profile consent"
tags:
  - "watch"
  - "recommendations"
  - "personalization"
  - "consent"
  - "admission"
  - "single-flight"
  - "retry"
  - "race"
---

# Watch recommendation consent refresh must recover from transient delivery admission

## Problem

Accepting personalization writes the consent/profile cookies and announces a
profile change so the Watch recommendation block can replace its contextual
slate. That refresh can overlap the delivery request already running for the
same anonymous session. Recommendation Admission correctly rejects the second
request as `in_flight`, but the Watch client used to treat that transient result
as terminal and showed an unavailable error even though personalization was
successfully enabled.

This fix is pending in [PR #1976](https://github.com/JesusFilm/forge/pull/1976).

## Symptoms

- Clicking **Accept all** can appear to fail while the profile and consent
  endpoints both return success.
- The recommendation block enters its unavailable state after the
  `forge:recommendation-profile-changed` event.
- A later reload works because the original delivery lease and cooldown have
  expired.

## What Didn't Work

- Treating every reason-coded unavailable response as a permanent failure. The
  server deliberately uses unavailable envelopes for both transient admission
  states and terminal availability failures.
- Retrying immediately. That competes with the request that already owns the
  single-flight lease and can also remain inside the same-session/seed
  cooldown.
- Increasing the delivery deadline. The race is admission ordering, not slow
  semantic retrieval, and the serving contract must remain bounded.

## Solution

Keep the recommendation block in its loading state when the first response is
an `in_flight` or `cooldown` unavailable envelope. Schedule one retry after the
existing admission window, then treat any second unavailable response as
terminal.

```tsx
const load = (canRetryTransientAdmission: boolean) => {
  // Fetch the versioned recommendation delivery.
  // ...
  if (
    canRetryTransientAdmission &&
    envelope.result === "unavailable" &&
    (envelope.reason === "cooldown" || envelope.reason === "in_flight")
  ) {
    admissionRetryTimer = window.setTimeout(() => {
      admissionRetryTimer = null
      load(false)
    }, DELIVERY_COOLDOWN_MS)
  } else {
    setState({ requestKey, status: "unavailable" })
  }
}
```

The effect cleanup clears the timer and aborts the active request so a route
change or unmount cannot replay stale work. A parameterized fake-timer test
covers both transient reasons, proves there is no early retry, advances through
the admission window, and asserts the second response renders normally.

## Why This Works

Recommendation Admission permits one active delivery for an anonymous session
and returns stable reason codes when another attempt overlaps it or repeats the
same seed during the cooldown. The profile-change event is expected to start a
new delivery because its inputs changed; overlap with the previous delivery is
therefore a recoverable scheduling condition rather than evidence that consent
or personalization failed.

A single delayed retry respects the server-owned admission window without
creating an unbounded client loop. It also leaves hourly and endpoint rate-limit
rejections terminal, so the client does not retry genuine capacity controls.

## Prevention

- Classify versioned failure reasons as transient or terminal at the consuming
  UI boundary; do not collapse the whole unavailable envelope into one state.
- Test state-changing browser events while the previous request is unresolved,
  especially when the backend enforces single-flight admission.
- Bound recovery by both delay and attempt count. One retry prevents a transient
  race from becoming a permanent error without turning admission into polling.
- Preserve the serving deadline. Tune client recovery independently from the
  online retrieval budget.
- Verify consent through the real browser with the delivery network calls left
  visible; isolated endpoint success does not prove the refreshed UI journey.

## Related Issues

- [Watch semantic search must wait for language metadata before query-language confirmation](watch-semantic-search-language-metadata-confirmation-race.md)
- [Async single-flight slot release hazards](../design-patterns/async-single-flight-slot-release-hazards.md)
