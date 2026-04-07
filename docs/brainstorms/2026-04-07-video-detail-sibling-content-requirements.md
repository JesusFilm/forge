---
date: 2026-04-07
topic: video-detail-sibling-content
---

# Video Detail Page: Render Sibling Content from Parent Section

## Problem Frame

When a user taps a video thumbnail on the home page, the video details page only shows the video player, title, and description. All associated content from the parent Experience section — text blocks, containers with related questions, Bible quote carousels, quiz buttons, date displays — is missing. This is because the `sectionKey` index in `ExperienceProvider` lets a video child overwrite its parent sectionWrapper when they share the same key, so the detail page never receives the sibling content.

## Requirements

- R1. When navigating to a video detail page, all sibling components from the parent sectionWrapper must render below the video player and title area.
- R2. The solution must work generically for any Experience object — no hard-coded assumptions about which sibling block types exist or their order. The CMS controls content; the app renders whatever siblings are present.
- R3. Videos not inside a sectionWrapper (bare top-level videos) continue to render as they do today — video player, title, and description only.
- R4. The existing ContentDispatcher renders sibling blocks. No new dispatcher or renderer infrastructure is needed.

## Success Criteria

- Tapping "Easter Explained" on the Easter experience shows: video player, title/description, text + easter-dates container, text + related-questions container, Bible quotes carousel, and quiz button — matching the seed data structure.
- Tapping any video on the Christmas experience shows its corresponding sibling content from the seed data.
- Bare top-level videos (if any) still render correctly without errors.

## Scope Boundaries

- No new hooks or context APIs — fix the existing index-order in `ExperienceProvider`.
- No changes to the CMS data model or GraphQL schema.
- No changes to how the home page renders or navigates.
- SectionWrapper theming (background color/image/overlay) on the detail page is out of scope for this change — can be a follow-up.

## Key Decisions

- **Index-order fix over dual-map**: Reverse the indexing order so the sectionWrapper wins when keys collide. Simpler than adding a second map or new hooks. The video detail page extracts video-specific fields from the video child within `sectionContent`.

## Deferred to Planning

- [Affects R1][Technical] Confirm the exact field extraction pattern: how the video detail page finds the video child within `sectionContent` to read `streamingUrl`, `videoRef`, `videoTitle`, etc.
- [Affects R1][Technical] Verify that reversing the index order doesn't break any other lookups (e.g., `CuratedHomeLayout` section classification).

## Next Steps

→ `/ce:plan` for structured implementation planning
