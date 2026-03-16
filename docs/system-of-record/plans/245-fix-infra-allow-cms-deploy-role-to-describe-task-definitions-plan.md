---
artifactType: plan
sourceIssueNumber: 245
sourceIssueTitle: "fix(infra): allow cms deploy role to describe task definitions"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/245"
linkedPrs: []
---

# Plan Artifact: #245

## Objective

The GitHub Actions CMS deploy role can describe the current task definition during rollout, and `cms-deploy` completes successfully.

## Planned approach

1. Move `ecs:DescribeTaskDefinition` into a separate IAM statement with `resources = ["*"]`.
2. Keep mutating ECS actions (`RegisterTaskDefinition`, `UpdateService`, `TagResource`) scoped to CMS deploy resources.

## Validation

- [ ] `infra/aws/github/cms.tf` grants `ecs:DescribeTaskDefinition` in a way AWS accepts for the deploy role.
- [ ] Remaining ECS deploy permissions stay scoped as tightly as practical.
- [ ] A follow-up deploy run no longer fails on `DescribeTaskDefinition`.

## Source links

- Issue: [#245](https://github.com/JesusFilm/forge/issues/245)
- PRs:
- None
