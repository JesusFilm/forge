---
date: 2026-04-12
topic: job-detail-review-player-videojs-chapters
related:
  - docs/roadmap/media-generation/feat-082-job-detail-enrichment-review-player.md
  - docs/roadmap/media-generation/feat-085-job-detail-review-player-videojs-chapters.md
  - docs/plans/2026-04-09-feat-add-chapters-vtt-artifact-plan.md
  - docs/solutions/ui-bugs/manager-review-player-before-after-toggle-buttons-2026-04-12.md
---

# Job Detail Review Player Video.js Chapters

## What We're Building

Add chapter navigation to the manager job details review player using Video.js's
native chapter-track UI. On a completed enrichment job, operators should be able
to use the player controls to jump between generated chapters while reviewing
the video and adjacent enrichment details.

This is a follow-up to the completed job detail enrichment review player. It
should focus on the `After` review state first, because current manager data has
generated `chapters.json` and optional `chapters-vtt` artifacts, while the
`Before` state does not yet have a live CMS chapter source.

## Why This Approach

We considered three shapes:

- Video.js chapter track plus custom playback-line markers
- native Video.js chapters UI/control bar
- custom markers derived only from `chapters.json`

The chosen approach is native Video.js chapters UI/control bar. It best matches
the request to follow Video.js documentation because Video.js already models
chapters as text tracks and exposes a `ChaptersButton` in the control bar when a
relevant chapter track is present. It may require adapting the manager review
player away from its fully custom scrubber for this surface, but that trade-off
keeps chapter navigation inside the documented player system rather than
inventing a parallel chapter UI.

## Key Decisions

- Use Video.js chapter tracks: the player should receive a WebVTT text track
  with `kind="chapters"` instead of deriving a manager-only marker model.
- Prefer `chapters-vtt` when available: `chapters.json` remains canonical, but
  the derived WebVTT artifact is the natural player-facing chapter source.
- Show chapters for `After` first: `Before` should continue to report live
  chapters unavailable until the CMS has an explicit chapter source.
- Use native control-bar behavior: expose the Video.js chapters menu/button
  rather than drawing custom markers on the current `<input type="range">`.
- Preserve the review card contract: `Before`/`After` remains a button group
  with `aria-pressed`, and existing step-level override actions stay outside
  the read-first review player.
- Keep the shared player boundary: changes should go through
  `packages/video-player` and manager wrappers, not cross-imports from
  `apps/web`.

## Resolved Questions

- Preferred approach: native Video.js chapters UI/control bar.
- Chapter source: use the generated chapter artifact path, with `chapters-vtt`
  as the player-facing representation when present.
- Initial mode: generated `After` chapters only; do not invent live `Before`
  chapters.
- Scope: this is a focused follow-up roadmap item, not a reopening of the
  completed `feat-082` review player.

## Open Questions

No product-level blockers remain for planning.

## Next Steps

Proceed to planning with the native Video.js chapter UI approach. Planning
should check the official Video.js Text Tracks and Components docs, then define
the smallest review-context and shared-player changes needed to surface a
chapter track without disturbing existing subtitle, play/pause, mute, seek, and
fullscreen behavior.
