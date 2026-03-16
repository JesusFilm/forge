---
artifactType: issue
issueNumber: 245
issueTitle: "fix(infra): allow cms deploy role to describe task definitions"
issueUrl: "https://github.com/JesusFilm/forge/issues/245"
state: "CLOSED"
closedAt: "2026-03-06T08:00:19Z"
labels: ["fix", "infra"]
linkedPrs: []
---

# Issue Artifact: #245

## Background

The `cms-deploy` GitHub Actions job failed on main in `Roll ECS service to new image` with `AccessDeniedException` for `ecs:DescribeTaskDefinition`.

The repo already includes `ecs:DescribeTaskDefinition` in `infra/aws/github/cms.tf`, but it is scoped to ECS resource ARNs. AWS evaluates this call against `resource: *`, so the current policy does not authorize the operation.

Failing run:

- https://github.com/JesusFilm/forge/actions/runs/22750589689/job/65984146353

## Expected outcome

The GitHub Actions CMS deploy role can describe the current task definition during rollout, and `cms-deploy` completes successfully.

## Acceptance criteria

- [ ] `infra/aws/github/cms.tf` grants `ecs:DescribeTaskDefinition` in a way AWS accepts for the deploy role.
- [ ] Remaining ECS deploy permissions stay scoped as tightly as practical.
- [ ] A follow-up deploy run no longer fails on `DescribeTaskDefinition`.

## Possible solution(s)

1. Move `ecs:DescribeTaskDefinition` into a separate IAM statement with `resources = ["*"]`.
2. Keep mutating ECS actions (`RegisterTaskDefinition`, `UpdateService`, `TagResource`) scoped to CMS deploy resources.

## References

- Run: https://github.com/JesusFilm/forge/actions/runs/22750589689/job/65984146353
- `infra/aws/github/cms.tf`
- `.github/workflows/cms-deploy.yml`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
