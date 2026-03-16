---
artifactType: issue
issueNumber: 422
issueTitle: "fix(infra): detect ECS crash loops and surface task logs in cms-deploy CI"
issueUrl: "https://github.com/JesusFilm/forge/issues/422"
state: "CLOSED"
closedAt: "2026-03-12T02:46:59Z"
labels: ["fix", "infra"]
linkedPrs: []
scope: "cms"
---

# Issue Artifact: #422

## Background

The cms-deploy workflow polls ECS rollout status until COMPLETED or FAILED. When new tasks crash-loop (start → crash → restart), the rollout stays IN_PROGRESS indefinitely because ECS keeps retrying within the circuit breaker window. The script times out after 10 minutes with no useful diagnostics — a dev must manually log into AWS to fetch CloudWatch logs.

## Expected outcome

- Deploy fails fast (~2 min) when new tasks are crash-looping instead of timing out (~10 min)
- CloudWatch logs from stopped tasks are printed directly in CI output
- Logs are sanitized of secrets so CI output is safe to share publicly / with AI assistants

## Acceptance criteria

- [ ] Poll loop tracks stopped tasks from the new deployment via `ecs:ListTasks` + `ecs:DescribeTasks`
- [ ] After 3+ stopped tasks from the new deployment, the job fails with "Crash loop detected"
- [ ] CloudWatch logs (last 200 events) from each stopped task are fetched and printed to stderr
- [ ] Known secret env var values and database connection strings are redacted from log output
- [ ] IAM policy grants `ecs:ListTasks`, `ecs:DescribeTasks`, `logs:GetLogEvents` (least-privilege scoped)
- [ ] Existing COMPLETED / FAILED / timeout paths unchanged except they also dump logs when available

## Possible solution(s)

1. Track PRIMARY deployment ID after force-new-deployment; each poll iteration list stopped tasks, describe them, filter by startedBy == deployment ID, accumulate count, fail at threshold. Fetch logs via `aws logs get-log-events`, pipe through perl sanitizer.

## References

- CMS task definition log config: `/ecs/forge-cms-{env}`, stream prefix `cms`
- Secret env vars injected: DATABASE_PASSWORD, APP_KEYS, ADMIN_JWT_SECRET, JWT_SECRET, API_TOKEN_SALT, TRANSFER_TOKEN_SALT, ENCRYPTION_KEY, STRAPI_INTERNAL_API_TOKEN

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
