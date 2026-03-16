---
artifactType: issue
issueNumber: 260
issueTitle: "fix(cms): add JWT_SECRET for users-permissions plugin"
issueUrl: "https://github.com/JesusFilm/forge/issues/260"
state: "CLOSED"
closedAt: "2026-03-06T09:56:12Z"
labels: ["fix", "cms"]
linkedPrs: []
scope: "cms"
---

# Issue Artifact: #260

## Background

Strapi users-permissions plugin requires `jwtSecret` in config/plugins. ECS tasks were failing with "Missing jwtSecret". We have ADMIN_JWT_SECRET in SSM/task def but not JWT_SECRET (separate: admin vs API auth).

## Expected outcome

- CMS app reads users-permissions jwtSecret from env JWT_SECRET.
- SSM parameter `/forge/aws/cms/{env}/JWT_SECRET` created with ephemeral random (same pattern as other CMS secrets).
- ECS task definition injects JWT_SECRET from SSM; execution role can read it.

## Acceptance criteria

- [ ] config/plugins.ts sets users-permissions.jwtSecret from env("JWT_SECRET").
- [ ] .env.example documents JWT_SECRET.
- [ ] Terraform CMS module: ephemeral random, SSM parameter, IAM policy, task def secrets include JWT_SECRET.

## Possible solution(s)

1. Add users-permissions config in plugins.ts; add JWT_SECRET via existing ephemeral+SSM+task-def pattern in infra/aws/modules/cms.

## References

- Strapi env docs; error pointed to config/plugins.js and env vars.

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
