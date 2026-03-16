---
artifactType: plan
sourceIssueNumber: 422
sourceIssueTitle: "fix(infra): detect ECS crash loops and surface task logs in cms-deploy CI"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/422"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: #422

## Objective

- Deploy fails fast (~2 min) when new tasks are crash-looping instead of timing out (~10 min)
- CloudWatch logs from stopped tasks are printed directly in CI output
- Logs are sanitized of secrets so CI output is safe to share publicly / with AI assistants

## Planned approach

1. Track PRIMARY deployment ID after force-new-deployment; each poll iteration list stopped tasks, describe them, filter by startedBy == deployment ID, accumulate count, fail at threshold. Fetch logs via `aws logs get-log-events`, pipe through perl sanitizer.

## Validation

- [ ] Poll loop tracks stopped tasks from the new deployment via `ecs:ListTasks` + `ecs:DescribeTasks`
- [ ] After 3+ stopped tasks from the new deployment, the job fails with "Crash loop detected"
- [ ] CloudWatch logs (last 200 events) from each stopped task are fetched and printed to stderr
- [ ] Known secret env var values and database connection strings are redacted from log output
- [ ] IAM policy grants `ecs:ListTasks`, `ecs:DescribeTasks`, `logs:GetLogEvents` (least-privilege scoped)
- [ ] Existing COMPLETED / FAILED / timeout paths unchanged except they also dump logs when available

## Source links

- Issue: [#422](https://github.com/JesusFilm/forge/issues/422)
- PRs:
- None
