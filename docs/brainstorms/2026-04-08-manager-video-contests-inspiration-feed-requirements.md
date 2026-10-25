---
date: 2026-04-08T00:00:00.000Z
topic: manager-video-contests-inspiration-feed
---

# Video Contests and Inspiration Feed for Manager App

## Problem Frame

Community-submitted and locally discovered videos deserve their own product surface rather than being buried inside partner activation. Video contests introduce submission, review, and recognition workflows, while a video inspiration feed helps teams browse standout ideas, local stories, and reusable creative patterns. Together they form a distinct feedback and inspiration loop around the core production system.

If these workflows stay folded into the partner portal, they risk being treated as a side feature instead of a content program with its own moderation, discovery, and editorial value.

## Requirements

- R1. Add a dedicated contest and inspiration surface separate from the main partner-activation dashboard.
- R2. Video contests support submissions, eligibility rules, review states, judging notes, and selected winners or featured entries.
- R3. The inspiration feed highlights strong submitted videos, internally curated examples, and reusable creative patterns that can inspire future production.
- R4. Managers can move standout entries from contest review into the inspiration feed without duplicating content manually.
- R5. Feed items can be filtered by topic, audience, region, language, or campaign so teams can browse inspiration intentionally.
- R6. The system tracks whether an entry is contest-only, inspiration-only, or both, because those are related but distinct editorial states.

## Success Criteria

- Video contests are run as a structured program instead of an ad hoc submission inbox.
- Teams can browse an inspiration feed to spark new campaign or content ideas.
- Strong community videos can graduate from submission to inspiration without losing provenance.

## Scope Boundaries

- Not a public social network.
- Not a full UGC moderation platform for open internet uploads.
- Not the same thing as the partner activation portal, even if partner identities are reused.

## Key Decisions

- Video contests and the inspiration feed are their own brainstorm, not part of partner activation.
- Contest workflows and inspiration browsing share content, but they are different product surfaces.
- Featured entries remain curated by humans even if scoring or ranking is assisted.

## Dependencies / Assumptions

- Auth and partner identity may be shared with the partner portal, but the editorial workflow is separate.
- Submitted videos can eventually feed back into programming, campaigns, or future production curation.

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Product] Should the inspiration feed include only contest-derived content at first, or also internal staff picks and curated external examples?
- [Affects R2][Workflow] Does judging happen entirely inside manager, or should there be lightweight guest judging roles?

## Next Steps

-> `/ce:plan` for structured implementation planning
