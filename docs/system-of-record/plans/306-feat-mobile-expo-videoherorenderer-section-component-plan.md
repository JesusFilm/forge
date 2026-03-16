---
artifactType: plan
sourceIssueNumber: 306
sourceIssueTitle: "feat(mobile-expo): VideoHeroRenderer section component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/306"
linkedPrs: []
---

# Plan Artifact: #306

## Objective

- A `VideoHeroRenderer` component that displays the hero banner for an experience page.
- Accepts typed props from the data layer (VideoHero model from #304).

## Planned approach

1. Full-width `VideoView` (expo-video) with poster image from `video.image`, overlaid heading/subheading Text, and a Pressable/Button for CTA.
2. Fallback to static thumbnail with play button if `streamingUrl` is missing.
3. Reference the Easter page hero section on jesusfilm.org for visual intent.

## Validation

- [ ] Renders `heading` and `subheading` text.
- [ ] **Inline video playback**: Uses `expo-video` (or `expo-av`) to play the `streamingUrl` (HLS) directly inside the hero component — the video must play on the same page, not open in an external/system player.
- [ ] Displays video thumbnail from the linked `Video` entity (image field) as a poster/placeholder before playback starts.
- [ ] Play/pause controls overlaid on the video area.
- [ ] Renders CTA button using `ctaLabel` and `ctaLink` (tappable, opens link or navigates).
- [ ] Visually prominent layout (full-width, hero-style).
- [ ] Handles missing optional fields gracefully (e.g. no CTA if ctaLabel is absent).
- [ ] Replaces the VideoHero stub in SectionDispatcher.
- [ ] Accessible (labels, tap targets, playback controls).

## Source links

- Issue: [#306](https://github.com/JesusFilm/forge/issues/306)
- PRs:
- None
