---
artifactType: issue
issueNumber: 273
issueTitle: "feat(infra): ECS Exec on stage, desired count, autoscaling on prod"
issueUrl: "https://github.com/JesusFilm/forge/issues/273"
state: "CLOSED"
closedAt: "2026-03-07T11:01:15Z"
labels: ["feat", "infra"]
linkedPrs: []
---

# Issue Artifact: #273

## Background

- Enable ECS Exec for CMS tasks on stage only (not prod) for debugging.
- Make CMS service run with desired count 1 by default (configurable via platform var).
- Add Application Auto Scaling for CMS in prod only (min 1, max 3, CPU 70%); hard-coded for now.

## Expected outcome

- Stage: ECS Exec available; fixed desired count (e.g. 1).
- Prod: ECS Exec disabled; autoscaling 1–3 tasks by CPU; Terraform ignores desired_count so scaler owns it.

## Acceptance criteria

- [ ] ECS Exec enabled only when environment != prod
- [ ] Task role has ssmmessages for ECS Exec; service enable_execute_command set from environment
- [ ] desired_count from variable (platform passes cms_ecs_desired_count, default 1)
- [ ] Prod: aws_appautoscaling_target and policy (min 1, max 3, CPU 70%); lifecycle ignore_changes desired_count
- [ ] Autoscaling params hard-coded in CMS module (no vars for min/max/cpu)
- [ ] Infra/Terraform only

## Possible solution(s)

Not provided in source issue.

## References

Not provided in source issue.

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
