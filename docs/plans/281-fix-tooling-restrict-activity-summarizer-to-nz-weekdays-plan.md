---
artifactType: plan
sourceIssueNumber: 281
sourceIssueTitle: "fix(tooling): restrict activity summarizer to NZ weekdays"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/281"
linkedPrs: []
---

# Plan Artifact: #281

## Objective

Automation execution and message behavior align to NZ weekdays only, with no Saturday/Sunday runs.

## Planned approach

1. Update cron/scheduler config to weekday-only timing aligned to NZ local time
2. Add runtime NZ timezone weekday guard to skip weekend posts
3. Keep existing summarizer format and tighten prompt text if needed

## Validation

- [ ] Automation is scheduled or gated to run only Monday-Friday in New Zealand time
- [ ] No summary message is posted when execution occurs on NZ weekend
- [ ] Daily and weekly summary output constraints remain intact

## Source links

- Issue: [#281](https://github.com/JesusFilm/forge/issues/281)
- PRs:
- None
