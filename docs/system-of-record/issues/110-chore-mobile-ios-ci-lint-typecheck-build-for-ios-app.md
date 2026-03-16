---
artifactType: issue
issueNumber: 110
issueTitle: "chore(mobile-ios): CI (lint, typecheck, build) for iOS app"
issueUrl: "https://github.com/JesusFilm/forge/issues/110"
state: "CLOSED"
closedAt: "2026-03-16T06:11:15Z"
labels: ["chore", "mobile-ios"]
linkedPrs: []
---

# Issue Artifact: #110

## Background

CI already runs SwiftLint for mobile/ios when affected. We need to add (or confirm) build validation so the app target compiles in CI and failures block merge.

## Expected outcome

CI conditionally runs iOS build (e.g. xcodebuild) when mobile/ios is affected; lint and typecheck (clean build) remain; build failures fail the workflow.

## Acceptance criteria

- [ ] iOS build job (or step) in .github/workflows when mobile/ios is affected.
- [ ] Existing lint-ios behavior unchanged.
- [ ] Build failures block merge.

## Possible solution(s)

Not provided in source issue.

## References

- Parent: #100
- Depends on: #101
- .github/workflows/ci.yml

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
