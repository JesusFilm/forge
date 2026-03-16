---
artifactType: issue
issueNumber: 266
issueTitle: "fix(infra): ECS CMS task health status unknown"
issueUrl: "https://github.com/JesusFilm/forge/issues/266"
state: "CLOSED"
closedAt: "2026-03-06T11:34:36Z"
labels: ["fix", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #266

## Background

ECS Tasks list shows "Health status: Unknown" because the task definition has no container health check. The ALB target group has a health check (/\_health) but that does not populate ECS's Health status column.

## Expected outcome

ECS Tasks show Healthy/Unhealthy in the console after adding a container healthCheck to the CMS task definition.

## Acceptance criteria

- [ ] CMS ECS task definition includes a container healthCheck (e.g. hit /\_health)
- [ ] New tasks report Healthy when /\_health succeeds

## Possible solution(s)

1. Add healthCheck to container_definitions in infra/aws/modules/cms/main.tf (wget or curl to http://localhost:1337/\_health). Chosen.
2. Rely only on ALB health check (no change to ECS UI; status stays Unknown).

## References

- ECS container health checks: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#container_definition_healthcheck

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
