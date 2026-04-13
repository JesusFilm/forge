---
date: 2026-04-11
topic: enrich-now-feedback
---

# Enrich Now Feedback and Progress UX

## What We're Building

Improve the Coverage dashboard's `Enrich Now` action so operators get immediate confirmation that their click registered, clear acknowledgement that the backend accepted the request, and an obvious path to watch progress after job creation.

Today the action feels silent at the most important moment: the button does not visibly enter a pending state, the bar only changes after the API returns, and ongoing job activity is hidden behind a separate Jobs view unless the request finishes with a clean redirect.

## Why This Approach

Three reasonable directions exist:

1. **Micro-feedback only**: add pressed/loading states on the button. Fastest to ship, but it only solves click acknowledgement.
2. **Submission feedback pattern**: add loading state plus a success toast/banner that says jobs were accepted and links to Jobs. Stronger clarity with low complexity.
3. **Inline progress handoff**: add loading state, acceptance feedback, and a lightweight live job summary in the Coverage bar or selected rows. Best operator confidence, but more UI work.

Recommendation: start with the submission feedback pattern, then add inline progress handoff only if operators still feel uncertain. That is the smallest change that covers both "did my click work?" and "is anything happening?" without over-designing the first pass.

## Key Decisions

- **Separate acknowledgement from completion:** The UI should first confirm the click, then confirm job acceptance, instead of waiting to imply both with one delayed message.
- **Use explicit submission language:** Copy should say `Creating jobs...` and then `3 enrichment jobs started` or `Request accepted` rather than implying the work already finished.
- **Keep the user anchored in context:** After acceptance, keep a visible link or inline summary near the selection bar so the user does not need to hunt for the Jobs page.
- **Treat partial success as a first-class state:** If some jobs are created and some fail, the UI should say both clearly in one message.
- **Prefer progressive disclosure:** Start with button pending state + accepted toast/banner + deep link to Jobs, then consider inline live progress only if needed.

## Success Criteria

- Within one click, the action visibly changes state immediately.
- Within the request response, the UI states whether the backend accepted the job creation request.
- Users can reach live job status from the same area without guessing where progress moved.
- Partial success and failures are understandable without opening devtools or retrying blindly.

## Scope Boundaries

- **Not in scope:** Changing enrichment workflow internals or step execution order.
- **Not in scope:** Reworking the Jobs dashboard itself beyond any linking or compact handoff needed from Coverage.
- **Not in scope:** Adding precise per-step progress to the Coverage screen in the first iteration.

## Dependencies / Assumptions

- The Jobs dashboard remains the source of truth for live progress after creation.
- The create-jobs API continues to respond before background enrichment finishes.
- Existing neutral/error feedback in the selection bar can be expanded rather than replaced.

## Next Steps

→ `/ce:plan` for structured implementation planning
