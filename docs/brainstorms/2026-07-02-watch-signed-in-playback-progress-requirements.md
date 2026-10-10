---
date: 2026-07-02
topic: watch-signed-in-playback-progress
---

# Watch Signed-In Playback Progress

## Problem Frame

Signed-in viewers should be able to tell which videos they have already started, roughly how far they got, and eventually revisit their watch history. Today, video cards look identical whether a viewer has watched none, half, or nearly all of a video. This feature is primarily a resume/progress UI for the current signed-in user, with watch history as the next user-facing layer; recommendation training is adjacent but not the core purpose.

## Requirements

**Progress Capture**

- R1. When a signed-in user watches a video, the application records the latest playback position and total duration for that video.
- R2. Progress updates must be frequent enough that navigating away, pausing, or backgrounding the tab preserves the viewer's approximate position.
- R3. Progress must be scoped to the signed-in user, not just the browser, so two accounts in the same browser do not share watch progress.
- R3a. The application must not send anonymous-user playback progress to the signed-in progress store. Anonymous browser-local capture is allowed only as a bonus handoff source that can be committed to a user profile after sign-in.

**Progress Display**

- R4. Any video card for a partially watched video must show a red progress bar along the bottom edge of the thumbnail/card artwork.
- R5. The progress bar must appear consistently across Watch surfaces, including search results, home rails, series episode cards, related media cards, and the bottom chapter carousel on a video page.
- R6. Videos at 90% or greater progress count as complete for display and should show a full red bar.

**Resume Behavior**

- R7. When a signed-in user returns to a partially watched video, normal playback should resume near the saved position.
- R8. Explicit deep-link timecodes must win over saved progress so shared links and search-scene links still land at their requested timestamp.
- R9. Returning to a saved-position video should skip the pre-play hero state with the `Watch Now` button.
- R10. Skipping the hero state must not autoplay the video; the player should load at the saved position and wait for the user's play action.

**Watch History**

- R11. The same signed-in progress data should be able to power a current-user watch history UI later.
- R12. Account deletion must delete the user's stored watch progress and watch history records.

## Success Criteria

- A signed-in viewer watches part of a video, leaves, and later sees a red progress bar on that video wherever it appears.
- Returning to the same video loads the player at the saved position, bypasses the `Watch Now` hero state, and waits paused unless the URL includes an explicit autoplay flow.
- Anonymous viewers do not get signed-in progress UI.
- Progress state does not leak between different signed-in accounts on the same browser.
- Videos at 90% or greater progress show a full bar.

## Scope Boundaries

- This slice does not train or alter recommendations.
- This slice does not require cross-device progress sync.
- This slice does not replace the broader `watch_events` analytics/data-collection roadmap item.
- This slice does not add mobile or TV progress surfaces.
- This slice does not fully build watch history UI, but it should not block that future UI.

## Key Decisions

- Start with signed-in progress: The user specifically asked for signed-in users, and the web app already has a same-origin auth-session probe for account-gated flows. Anonymous progress is a bonus browser-local handoff path, not the primary tracking model.
- Use watch progress as a continuity feature first: A visible progress rail and resume behavior create immediate user value before event warehousing or personalization models exist.
- Treat Watch Events as adjacent, not the only home: Aggregated watch events remain useful for recommendations, but user-facing resume/progress needs a latest-position view of the world, not only an append-only event stream.
- Use 90% as the completion threshold: At or above 90%, the progress UI shows a full bar.
- Resume without autoplay: Saved progress should remove the promotional hero gate, but playback still waits for explicit user intent.

## Dependencies / Assumptions

- The web app can verify signed-in state through the existing auth session flow.
- Admin video document ids are stable enough to key progress across Watch card surfaces.
- Durable backend storage backs signed-in progress, account portability, and future watch history UI.
- Backend account deletion flow must call the progress cleanup endpoint when an account deletion hook or route is added.

## Outstanding Questions

### Deferred to Planning

- [Affects R5][Needs research] Which mobile and TV card surfaces should receive the same visual treatment when those apps add parity?
- [Affects R5][Product] For series and collection cards, should the red bar represent aggregate series completion, the next unwatched episode, the most recently watched episode, or only appear on episode/video cards?
- [Affects R12][Technical] Which auth-owned account deletion flow should trigger `DELETE /api/watch-progress` for the current signed-in user?

## Next Steps

-> `/ce:plan` for the durable backend progress/event plan once the web-local signed-in slice is validated.
