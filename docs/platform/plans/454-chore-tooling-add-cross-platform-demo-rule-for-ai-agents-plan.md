---
artifactType: plan
sourceIssueNumber: 454
sourceIssueTitle: "chore(tooling): add cross-platform demo rule for AI agents"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/454"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #454

## Objective

A rule (in both Cursor and Claude Code) that defines the required steps when an AI agent is asked to demo the cross-platform mobile app.

## Planned approach

Add a rule with a checklist:

1. Ensure Strapi is running on localhost:1337 — if not, start it
2. Check if data is seeded — if not, run the seed script
3. Launch Expo app on iOS simulator (iPhone 17 Pro)
4. Launch Expo app on Android emulator (Pixel 9a)
5. Capture screenshots from both platforms to verify the app loaded correctly

## Validation

- [ ] New Cursor rule `.cursor/rules/cross-platform-demo.mdc` with `alwaysApply: true`
- [ ] Matching section added to `CLAUDE.md`
- [ ] Rule covers: Strapi (start + seed if needed), both iOS and Android launch, screenshot capture for verification
- [ ] Both files are consistent in content

## Source links

- Issue: [#454](https://github.com/JesusFilm/forge/issues/454)
- PRs:
- None
