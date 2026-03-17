---
artifactType: plan
sourceId: 260
sourceTitle: "fix(cms): add JWT_SECRET for users-permissions plugin"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "fix(cms): add JWT_SECRET for users-permissions plugin"

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

## References

- Strapi env docs; error pointed to config/plugins.js and env vars.

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
