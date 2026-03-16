---
artifactType: issue
issueNumber: 306
issueTitle: "feat(mobile-expo): VideoHeroRenderer section component"
issueUrl: "https://github.com/JesusFilm/forge/issues/306"
state: "CLOSED"
closedAt: "2026-03-10T21:56:25Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #306

## Background

The `VideoHero` section type is the primary hero banner at the top of experience pages (e.g. the Easter page opens with a featured video hero). This issue implements the React Native renderer that replaces the VideoHero stub in the SectionDispatcher.

## Expected outcome

- A `VideoHeroRenderer` component that displays the hero banner for an experience page.
- Accepts typed props from the data layer (VideoHero model from #304).

## Acceptance criteria

- [ ] Renders `heading` and `subheading` text.
- [ ] **Inline video playback**: Uses `expo-video` (or `expo-av`) to play the `streamingUrl` (HLS) directly inside the hero component — the video must play on the same page, not open in an external/system player.
- [ ] Displays video thumbnail from the linked `Video` entity (image field) as a poster/placeholder before playback starts.
- [ ] Play/pause controls overlaid on the video area.
- [ ] Renders CTA button using `ctaLabel` and `ctaLink` (tappable, opens link or navigates).
- [ ] Visually prominent layout (full-width, hero-style).
- [ ] Handles missing optional fields gracefully (e.g. no CTA if ctaLabel is absent).
- [ ] Replaces the VideoHero stub in SectionDispatcher.
- [ ] Accessible (labels, tap targets, playback controls).

## Possible solution(s)

1. Full-width `VideoView` (expo-video) with poster image from `video.image`, overlaid heading/subheading Text, and a Pressable/Button for CTA.
2. Fallback to static thumbnail with play button if `streamingUrl` is missing.
3. Reference the Easter page hero section on jesusfilm.org for visual intent.

## References

- Parent: #93
- Depends on: #305 (SectionDispatcher scaffold)
- Schema: `ComponentSectionsVideoHero` — heading, subheading, video (Video entity), streamingUrl, ctaLabel, ctaLink, sectionKey
- [jesusfilm.org/watch/easter.html/english.html](https://www.jesusfilm.org/watch/easter.html/english.html) — hero section at top of page
- [expo-video docs](https://docs.expo.dev/versions/latest/sdk/video/)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
