---
artifactType: plan
sourceId: 422
sourceTitle: "fix(infra): detect ECS crash loops and surface task logs in cms-deploy CI"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "fix(infra): detect ECS crash loops and surface task logs in cms-deploy CI"

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

## References

- CMS task definition log config: `/ecs/forge-cms-{env}`, stream prefix `cms`
- Secret env vars injected: DATABASE_PASSWORD, APP_KEYS, ADMIN_JWT_SECRET, JWT_SECRET, API_TOKEN_SALT, TRANSFER_TOKEN_SALT, ENCRYPTION_KEY, STRAPI_INTERNAL_API_TOKEN

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
