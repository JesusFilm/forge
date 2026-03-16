---
artifactType: issue
issueNumber: 247
issueTitle: "fix(infra): allow cms deploy role to register task definitions"
issueUrl: "https://github.com/JesusFilm/forge/issues/247"
state: "CLOSED"
closedAt: "2026-03-08T22:10:16Z"
labels: ["fix", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #247

## Background

CMS deploy has repeatedly failed due ECS IAM action/resource scope mismatches. We fixed `ecs:DescribeTaskDefinition` in #245, but `ecs:RegisterTaskDefinition` is still scoped to task-definition ARNs. AWS evaluates registration against `resource: *`, so deploy can fail at the next rollout step.

## Expected outcome

The GitHub Actions CMS deploy role can register a new task definition revision during rollout without broadening unrelated ECS permissions.

## Acceptance criteria

- [ ] `infra/aws/github/cms.tf` grants `ecs:RegisterTaskDefinition` with AWS-compatible resource scope.
- [ ] Existing scoped permissions for `ecs:DescribeServices`, `ecs:UpdateService`, and `ecs:TagResource` remain tightly scoped.
- [ ] PR checks pass and change is ready for manual merge/deploy verification.

## Possible solution(s)

1. Move `ecs:RegisterTaskDefinition` into a dedicated IAM statement with `resources = ["*"]`.
2. Keep service/cluster/task-definition scoped resources only for actions that support resource-level restriction.

## References

- Previous fix issue: #245
- In-flight PR: #246
- AWS ECS IAM behavior for registration APIs
- `infra/aws/github/cms.tf`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
