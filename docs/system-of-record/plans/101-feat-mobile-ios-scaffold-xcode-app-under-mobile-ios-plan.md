---
artifactType: plan
sourceIssueNumber: 101
sourceIssueTitle: "feat(mobile-ios): scaffold Xcode app under mobile/ios"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/101"
linkedPrs: []
---

# Plan Artifact: #101

## Objective

iOS has a buildable app target/scheme (Xcode project or workspace) with a minimal SwiftUI startup screen. SPM only; feature-based folders; Swift 6+.

## Planned approach

1. Add .xcodeproj or workspace under mobile/ios with app target; link existing Package.swift (ForgeMobile) as dependency.
2. Organize app source in a dedicated folder (e.g. App/ or Sources/App).

## Validation

- [ ] App target under `mobile/ios`; builds and runs in Xcode and from CLI (e.g. xcodebuild).
- [ ] Minimal SwiftUI entry (e.g. single root view); Swift 6, SwiftUI.
- [ ] Xcode folders (not just groups); structure by feature where applicable.
- [ ] Local build commands documented in mobile/ios/README.md.

## Source links

- Issue: [#101](https://github.com/JesusFilm/forge/issues/101)
- PRs:
- None
