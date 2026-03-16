---
artifactType: issue
issueNumber: 409
issueTitle: "fix(mobile-expo): video section autoplay and iOS Fabric crash"
issueUrl: "https://github.com/JesusFilm/forge/issues/409"
state: "CLOSED"
closedAt: "2026-03-12T02:42:04Z"
labels: []
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #409

## Background

Video sections in the Expo app don't autoplay when scrolled into view, and `react-native-screens@4.24.0` causes an iOS 26.2 Fabric crash ("expected dynamic type 'boolean', but had type 'string'").

## Expected outcome

- Video sections autoplay muted when they scroll into the viewport (matching the hero video behavior)
- The app runs without crash on iOS 26.2 Fabric

## Acceptance criteria

- [ ] `VideoRenderer` autoplays on mount and pauses/resumes based on scroll visibility
- [ ] `isVisibleRef` initial state is `false` so first scroll-to-visible transition triggers play
- [ ] `onLayout` performs initial visibility check and plays if visible
- [ ] `react-native-screens` downgraded to `~4.16.0` to fix iOS Fabric crash
- [ ] Seed script updated with real Mux HLS streaming URLs from production API
- [ ] Claude command rules updated with session behavior from PR #331

## Possible solution(s)

1. Add `p.play()` to `useVideoPlayer` initializer in `VideoRenderer`
2. Fix `isVisibleRef` initial value and `onLayout` visibility check
3. Downgrade `react-native-screens` to `~4.16.0`

## References

- Related to #89 (cross-platform watch app)
- Related to #367 (Easter page UX)
- PR #331 (session behavior rules)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
