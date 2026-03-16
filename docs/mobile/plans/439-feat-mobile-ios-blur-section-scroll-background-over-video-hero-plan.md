---
artifactType: plan
sourceIssueNumber: 439
sourceIssueTitle: "feat(mobile-ios): blur section scroll background over video hero"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/439"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: #439

## Objective

The section scroll area uses a frosted-glass blur (`.ultraThinMaterial`) in the hero overlap zone that reveals the video hero underneath, fading smoothly to the opaque `systemBackground` color below.

## Planned approach

1. Replace the single `Color(.systemBackground)` background on `ExperienceSectionListView` with a two-part stacked background:
   - **Blur zone** (top ~40% of hero height): `Rectangle().fill(.ultraThinMaterial)` masked with a `LinearGradient` that fades from partial opacity at top to full opacity at bottom
   - **Opaque zone** (below): `Color(.systemBackground)` filling the remaining space
2. Only `ForgeRootView.swift` needs modification — section wrapper, hero, and scroll observer views remain unchanged

## Validation

- [x] Section list background uses `.ultraThinMaterial` in the hero overlap zone
- [x] Blur fades smoothly to opaque `systemBackground` via gradient mask
- [x] Individual section wrapper backgrounds remain opaque and unaffected
- [x] No visual regression in light and dark mode
- [x] No-hero fallback path is unaffected

## Source links

- Issue: [#439](https://github.com/JesusFilm/forge/issues/439)
- PRs:
- None
