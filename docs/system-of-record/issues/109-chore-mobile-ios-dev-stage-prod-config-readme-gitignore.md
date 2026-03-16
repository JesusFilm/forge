---
artifactType: issue
issueNumber: 109
issueTitle: "chore(mobile-ios): Dev/stage/prod config, README, gitignore"
issueUrl: "https://github.com/JesusFilm/forge/issues/109"
state: "CLOSED"
closedAt: "2026-03-16T06:11:14Z"
labels: ["chore", "mobile-ios"]
linkedPrs: []
---

# Issue Artifact: #109

## Background

iOS app needs environment config (GraphQL URL for dev/stage/prod), updated README, and Xcode-friendly gitignore so local and CI builds are clear and reproducible.

## Expected outcome

Dev, stage, and prod configuration (e.g. xcconfig or plist); mobile/ios/README.md updated with build/run and config; .gitignore entries for Xcode (e.g. xcuserdata). Can be done in parallel with GraphQL and feature work after scaffold exists.

## Acceptance criteria

- [ ] GraphQL (or API) base URL configurable per environment (dev/stage/prod).
- [ ] README documents how to build and run the app and where config lives.
- [ ] .gitignore includes Xcode user/data paths as needed.

## Possible solution(s)

Not provided in source issue.

## References

- Parent: #100
- Depends on: #101

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
