---
artifactType: plan
sourceIssueNumber: 110
sourceIssueTitle: "chore(mobile-ios): CI (lint, typecheck, build) for iOS app"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/110"
linkedPrs: []
---

# Plan Artifact: #110

## Objective

CI conditionally runs iOS build (e.g. xcodebuild) when mobile/ios is affected; lint and typecheck (clean build) remain; build failures fail the workflow.

## Planned approach

Not provided in source issue.

## Validation

- [ ] iOS build job (or step) in .github/workflows when mobile/ios is affected.
- [ ] Existing lint-ios behavior unchanged.
- [ ] Build failures block merge.

## Source links

- Issue: [#110](https://github.com/JesusFilm/forge/issues/110)
- PRs:
- None
