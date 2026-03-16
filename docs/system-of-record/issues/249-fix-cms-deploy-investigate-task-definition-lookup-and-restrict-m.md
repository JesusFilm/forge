---
artifactType: issue
issueNumber: 249
issueTitle: "fix(cms-deploy): investigate task definition lookup and restrict manual branch runs"
issueUrl: "https://github.com/JesusFilm/forge/issues/249"
state: "CLOSED"
closedAt: "2026-03-06T07:28:29Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #249

## Background

The `cms-deploy` workflow is failing in the ECS rollout step when it tries to describe the current task definition. We need better runtime logging to see exactly which task definition ARN the workflow is trying to read before making any IAM changes.

Separately, `workflow_dispatch` can be started from branches other than `stage` and `main`. The workflow should make that restriction explicit so manual runs only attempt deployment logic for the supported branches.

## Expected outcome

The next manual or push-triggered `cms-deploy` run logs the exact task definition ARN/family/revision before the ECS describe call, and manual runs only proceed on `stage` or `main`.

## Acceptance criteria

- [ ] `cms-deploy` logs the exact task definition ARN before `aws ecs describe-task-definition`.
- [ ] The workflow logs safe derived context that helps debug IAM/resource matching.
- [ ] `workflow_dispatch` runs do not attempt deploy logic for unsupported branches.
- [ ] Push-triggered behavior for `stage` and `main` remains intact.

## Possible solution(s)

1. Add targeted logging in the ECS rollout step for task definition ARN, family, and revision.
2. Add an explicit branch guard for `workflow_dispatch` so unsupported refs short-circuit with a clear message.
3. Keep the change workflow-only until logs confirm the real IAM mismatch.

## References

- Failed run: https://github.com/JesusFilm/forge/actions/runs/22750589689/job/65984146353
- Current workflow: `.github/workflows/cms-deploy.yml`
- Earlier exploratory PR: #246

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
