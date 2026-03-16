---
artifactType: plan
sourceIssueNumber: 409
sourceIssueTitle: "fix(mobile-expo): video section autoplay and iOS Fabric crash"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/409"
linkedPrs: []
---

# Plan Artifact: #409

## Objective

- Video sections autoplay muted when they scroll into the viewport (matching the hero video behavior)
- The app runs without crash on iOS 26.2 Fabric

## Planned approach

1. Add `p.play()` to `useVideoPlayer` initializer in `VideoRenderer`
2. Fix `isVisibleRef` initial value and `onLayout` visibility check
3. Downgrade `react-native-screens` to `~4.16.0`

## Validation

- [ ] `VideoRenderer` autoplays on mount and pauses/resumes based on scroll visibility
- [ ] `isVisibleRef` initial state is `false` so first scroll-to-visible transition triggers play
- [ ] `onLayout` performs initial visibility check and plays if visible
- [ ] `react-native-screens` downgraded to `~4.16.0` to fix iOS Fabric crash
- [ ] Seed script updated with real Mux HLS streaming URLs from production API
- [ ] Claude command rules updated with session behavior from PR #331

## Source links

- Issue: [#409](https://github.com/JesusFilm/forge/issues/409)
- PRs:
- None
