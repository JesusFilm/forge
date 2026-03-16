---
artifactType: plan
sourceIssueNumber: 260
sourceIssueTitle: "fix(cms): add JWT_SECRET for users-permissions plugin"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/260"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: #260

## Objective

- CMS app reads users-permissions jwtSecret from env JWT_SECRET.
- SSM parameter `/forge/aws/cms/{env}/JWT_SECRET` created with ephemeral random (same pattern as other CMS secrets).
- ECS task definition injects JWT_SECRET from SSM; execution role can read it.

## Planned approach

1. Add users-permissions config in plugins.ts; add JWT_SECRET via existing ephemeral+SSM+task-def pattern in infra/aws/modules/cms.

## Validation

- [ ] config/plugins.ts sets users-permissions.jwtSecret from env("JWT_SECRET").
- [ ] .env.example documents JWT_SECRET.
- [ ] Terraform CMS module: ephemeral random, SSM parameter, IAM policy, task def secrets include JWT_SECRET.

## Source links

- Issue: [#260](https://github.com/JesusFilm/forge/issues/260)
- PRs:
- None
