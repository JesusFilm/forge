---
artifactType: issue
issueNumber: 439
issueTitle: "feat(mobile-ios): blur section scroll background over video hero"
issueUrl: "https://github.com/JesusFilm/forge/issues/439"
state: "CLOSED"
closedAt: "2026-03-13T01:39:56Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
---

# Issue Artifact: #439

## Background

Part of epic #100 — native iOS watch app with SwiftUI and Strapi Experience.

On the Easter experience page, the section scroll view overlays the video hero as the user scrolls up. Currently, `ExperienceSectionListView` applies `.background(Color(.systemBackground))` ([`ForgeRootView.swift` line 91](https://github.com/JesusFilm/forge/blob/main/mobile/ios/Sources/ForgeMobile/Views/ForgeRootView.swift#L91)), making it fully opaque. The video hero is completely hidden once sections scroll into view.

The [reference website](https://www.jesusfilm.org/watch/easter.html/english.html) uses a frosted-glass blur effect so the video hero remains partially visible behind the first portion of the section list, creating a smooth visual transition.

## Expected outcome

The section scroll area uses a frosted-glass blur (`.ultraThinMaterial`) in the hero overlap zone that reveals the video hero underneath, fading smoothly to the opaque `systemBackground` color below.

## Acceptance criteria

- [x] Section list background uses `.ultraThinMaterial` in the hero overlap zone
- [x] Blur fades smoothly to opaque `systemBackground` via gradient mask
- [x] Individual section wrapper backgrounds remain opaque and unaffected
- [x] No visual regression in light and dark mode
- [x] No-hero fallback path is unaffected

## Possible solution(s)

1. Replace the single `Color(.systemBackground)` background on `ExperienceSectionListView` with a two-part stacked background:
   - **Blur zone** (top ~40% of hero height): `Rectangle().fill(.ultraThinMaterial)` masked with a `LinearGradient` that fades from partial opacity at top to full opacity at bottom
   - **Opaque zone** (below): `Color(.systemBackground)` filling the remaining space
2. Only `ForgeRootView.swift` needs modification — section wrapper, hero, and scroll observer views remain unchanged

## References

- Epic: #100
- Reference site: https://www.jesusfilm.org/watch/easter.html/english.html
- File to modify: `mobile/ios/Sources/ForgeMobile/Views/ForgeRootView.swift` (line 91)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
