---
artifactType: plan
sourceId: 253
sourceTitle: "fix(cms): improve deploy rollout diagnostics"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "fix(cms): improve deploy rollout diagnostics"

## Objective

CMS deploy runs should emit clear rollout progress logs during ECS deployment and surface the specific ECS service/task state and recent events when a rollout does not finish. The workflow should avoid false negatives caused by a single stale rollout-state read. If CMS task health is blocked by a missing health endpoint, the application should expose a matching health route.

## Planned approach

1. Replace the single final rollout-state assertion with a bounded polling loop that logs deployment counts, rollout state, and recent ECS events until `COMPLETED` or `FAILED`.
2. Add helper shell functions in the workflow step to print service summaries and recent events on each poll and on error.
3. If ALB health checks rely on `/_health`, register a lightweight CMS route/middleware for that path.

## Validation

- [ ] The CMS deploy workflow logs key rollout milestones and current ECS deployment/task counts while waiting.
- [ ] On rollout failure or timeout, the workflow prints recent ECS service events and deployment state details.
- [ ] The deploy step no longer fails solely because a single post-wait read still reports `IN_PROGRESS` while rollout is advancing.
- [ ] If required by the existing ALB target group config, CMS exposes a `/_health` endpoint that returns success for healthy tasks.

## References

- https://github.com/JesusFilm/forge/actions/runs/22754621533/job/65996203875
- `.github/workflows/cms-deploy.yml`
- `infra/aws/modules/cms/main.tf`
- `apps/cms/src/index.ts`

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
