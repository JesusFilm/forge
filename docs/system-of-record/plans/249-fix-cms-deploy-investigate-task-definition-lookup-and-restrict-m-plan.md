---
artifactType: plan
sourceIssueNumber: 249
sourceIssueTitle: "fix(cms-deploy): investigate task definition lookup and restrict manual branch runs"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/249"
linkedPrs: []
---

# Plan Artifact: #249

## Objective

The next manual or push-triggered `cms-deploy` run logs the exact task definition ARN/family/revision before the ECS describe call, and manual runs only proceed on `stage` or `main`.

## Planned approach

1. Add targeted logging in the ECS rollout step for task definition ARN, family, and revision.
2. Add an explicit branch guard for `workflow_dispatch` so unsupported refs short-circuit with a clear message.
3. Keep the change workflow-only until logs confirm the real IAM mismatch.

## Validation

- [ ] `cms-deploy` logs the exact task definition ARN before `aws ecs describe-task-definition`.
- [ ] The workflow logs safe derived context that helps debug IAM/resource matching.
- [ ] `workflow_dispatch` runs do not attempt deploy logic for unsupported branches.
- [ ] Push-triggered behavior for `stage` and `main` remains intact.

## Source links

- Issue: [#249](https://github.com/JesusFilm/forge/issues/249)
- PRs:
- None
