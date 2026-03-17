---
artifactType: plan
sourceId: 281
sourceTitle: "fix(tooling): restrict activity summarizer to NZ weekdays"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: "fix(tooling): restrict activity summarizer to NZ weekdays"

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

## References

- Cron trigger context from automation run
- Related automation for Forge repository activity summarization

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
