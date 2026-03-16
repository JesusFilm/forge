---
artifactType: issue
issueNumber: 101
issueTitle: "feat(mobile-ios): scaffold Xcode app under mobile/ios"
issueUrl: "https://github.com/JesusFilm/forge/issues/101"
state: "CLOSED"
closedAt: "2026-02-25T03:28:36Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
---

# Issue Artifact: #101

## Background

`mobile/ios` currently has a Swift Package (ForgeMobile library) but no runnable app target. We need a stable app shell under `mobile/ios` before GraphQL and UI work.

## Expected outcome

iOS has a buildable app target/scheme (Xcode project or workspace) with a minimal SwiftUI startup screen. SPM only; feature-based folders; Swift 6+.

## Acceptance criteria

- [ ] App target under `mobile/ios`; builds and runs in Xcode and from CLI (e.g. xcodebuild).
- [ ] Minimal SwiftUI entry (e.g. single root view); Swift 6, SwiftUI.
- [ ] Xcode folders (not just groups); structure by feature where applicable.
- [ ] Local build commands documented in mobile/ios/README.md.

## Possible solution(s)

1. Add .xcodeproj or workspace under mobile/ios with app target; link existing Package.swift (ForgeMobile) as dependency.
2. Organize app source in a dedicated folder (e.g. App/ or Sources/App).

## References

- Parent: #100
- mobile/ios/Package.swift, mobile/ios/README.md

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
