---
artifactType: issue
issueNumber: 253
issueTitle: "fix(cms): improve deploy rollout diagnostics"
issueUrl: "https://github.com/JesusFilm/forge/issues/253"
state: "CLOSED"
closedAt: "2026-03-06T09:25:18Z"
labels: ["fix", "cms"]
linkedPrs: []
---

# Issue Artifact: #253

## Background

The `cms-deploy` GitHub Action fails late in the ECS rollout step with only `Primary deployment rollout did not complete: IN_PROGRESS`, which makes it hard to tell whether the rollout is actually still progressing or blocked on a concrete ECS/ALB/task-health issue. The current workflow also appears to check rollout state only once after `aws ecs wait services-stable`, which can produce a noisy failure without enough deployment context.

## Expected outcome

CMS deploy runs should emit clear rollout progress logs during ECS deployment and surface the specific ECS service/task state and recent events when a rollout does not finish. The workflow should avoid false negatives caused by a single stale rollout-state read. If CMS task health is blocked by a missing health endpoint, the application should expose a matching health route.

## Acceptance criteria

- [ ] The CMS deploy workflow logs key rollout milestones and current ECS deployment/task counts while waiting.
- [ ] On rollout failure or timeout, the workflow prints recent ECS service events and deployment state details.
- [ ] The deploy step no longer fails solely because a single post-wait read still reports `IN_PROGRESS` while rollout is advancing.
- [ ] If required by the existing ALB target group config, CMS exposes a `/_health` endpoint that returns success for healthy tasks.

## Possible solution(s)

1. Replace the single final rollout-state assertion with a bounded polling loop that logs deployment counts, rollout state, and recent ECS events until `COMPLETED` or `FAILED`.
2. Add helper shell functions in the workflow step to print service summaries and recent events on each poll and on error.
3. If ALB health checks rely on `/_health`, register a lightweight CMS route/middleware for that path.

## References

- https://github.com/JesusFilm/forge/actions/runs/22754621533/job/65996203875
- `.github/workflows/cms-deploy.yml`
- `infra/aws/modules/cms/main.tf`
- `apps/cms/src/index.ts`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
