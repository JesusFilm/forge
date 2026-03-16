---
artifactType: issue
issueNumber: 281
issueTitle: "fix(tooling): restrict activity summarizer to NZ weekdays"
issueUrl: "https://github.com/JesusFilm/forge/issues/281"
state: "CLOSED"
closedAt: "2026-03-08T22:10:38Z"
labels: ["tooling", "fix"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #281

## Background

The repository activity summarizer automation should only run on weekdays in New Zealand time. It currently triggered on a weekend and needs weekday-only behavior while preserving concise daily/weekly summaries.

## Expected outcome

Automation execution and message behavior align to NZ weekdays only, with no Saturday/Sunday runs.

## Acceptance criteria

- [ ] Automation is scheduled or gated to run only Monday-Friday in New Zealand time
- [ ] No summary message is posted when execution occurs on NZ weekend
- [ ] Daily and weekly summary output constraints remain intact

## Possible solution(s)

1. Update cron/scheduler config to weekday-only timing aligned to NZ local time
2. Add runtime NZ timezone weekday guard to skip weekend posts
3. Keep existing summarizer format and tighten prompt text if needed

## References

- Cron trigger context from automation run
- Related automation for Forge repository activity summarization

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
