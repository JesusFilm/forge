---
artifactType: issue
issueNumber: 454
issueTitle: "chore(tooling): add cross-platform demo rule for AI agents"
issueUrl: "https://github.com/JesusFilm/forge/issues/454"
state: "CLOSED"
closedAt: "2026-03-13T03:57:59Z"
labels: ["chore", "tooling"]
linkedPrs: []
---

# Issue Artifact: #454

## Background

When asked to run a demo of the mobile Expo app, AI agents should follow a consistent checklist: start Strapi (with seed data), launch both iOS and Android, and capture screenshots to verify everything is working. Currently there is no rule enforcing this, so agents may forget to start Strapi, skip one platform, or skip visual verification.

## Expected outcome

A rule (in both Cursor and Claude Code) that defines the required steps when an AI agent is asked to demo the cross-platform mobile app.

## Acceptance criteria

- [ ] New Cursor rule `.cursor/rules/cross-platform-demo.mdc` with `alwaysApply: true`
- [ ] Matching section added to `CLAUDE.md`
- [ ] Rule covers: Strapi (start + seed if needed), both iOS and Android launch, screenshot capture for verification
- [ ] Both files are consistent in content

## Possible solution(s)

Add a rule with a checklist:

1. Ensure Strapi is running on localhost:1337 — if not, start it
2. Check if data is seeded — if not, run the seed script
3. Launch Expo app on iOS simulator (iPhone 17 Pro)
4. Launch Expo app on Android emulator (Pixel 9a)
5. Capture screenshots from both platforms to verify the app loaded correctly

## References

- [CLAUDE.md](CLAUDE.md) — project rules
- [.cursor/rules/](https://github.com/JesusFilm/forge/tree/main/.cursor/rules) — Cursor rules directory
- Issue #445 — bounded context folder guard (same pattern of shared rules)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
