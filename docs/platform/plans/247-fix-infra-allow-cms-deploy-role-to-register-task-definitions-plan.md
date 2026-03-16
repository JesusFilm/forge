---
artifactType: plan
sourceIssueNumber: 247
sourceIssueTitle: "fix(infra): allow cms deploy role to register task definitions"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/247"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #247

## Objective

The GitHub Actions CMS deploy role can register a new task definition revision during rollout without broadening unrelated ECS permissions.

## Planned approach

1. Move `ecs:RegisterTaskDefinition` into a dedicated IAM statement with `resources = ["*"]`.
2. Keep service/cluster/task-definition scoped resources only for actions that support resource-level restriction.

## Validation

- [ ] `infra/aws/github/cms.tf` grants `ecs:RegisterTaskDefinition` with AWS-compatible resource scope.
- [ ] Existing scoped permissions for `ecs:DescribeServices`, `ecs:UpdateService`, and `ecs:TagResource` remain tightly scoped.
- [ ] PR checks pass and change is ready for manual merge/deploy verification.

## Source links

- Issue: [#247](https://github.com/JesusFilm/forge/issues/247)
- PRs:
- None
