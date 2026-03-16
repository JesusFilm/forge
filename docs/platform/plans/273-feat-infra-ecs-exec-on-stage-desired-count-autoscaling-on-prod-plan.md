---
artifactType: plan
sourceIssueNumber: 273
sourceIssueTitle: "feat(infra): ECS Exec on stage, desired count, autoscaling on prod"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/273"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #273

## Objective

- Stage: ECS Exec available; fixed desired count (e.g. 1).
- Prod: ECS Exec disabled; autoscaling 1–3 tasks by CPU; Terraform ignores desired_count so scaler owns it.

## Planned approach

Not provided in source issue.

## Validation

- [ ] ECS Exec enabled only when environment != prod
- [ ] Task role has ssmmessages for ECS Exec; service enable_execute_command set from environment
- [ ] desired_count from variable (platform passes cms_ecs_desired_count, default 1)
- [ ] Prod: aws_appautoscaling_target and policy (min 1, max 3, CPU 70%); lifecycle ignore_changes desired_count
- [ ] Autoscaling params hard-coded in CMS module (no vars for min/max/cpu)
- [ ] Infra/Terraform only

## Source links

- Issue: [#273](https://github.com/JesusFilm/forge/issues/273)
- PRs:
- None
