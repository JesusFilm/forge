---
artifactType: plan
sourceIssueNumber: 255
sourceIssueTitle: "fix(infra): enable SSL for CMS ECS → RDS connection"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/255"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #255

## Objective

CMS tasks connect to RDS over TLS. Deploy (Roll ECS service to new image) succeeds and services become stable.

## Planned approach

1. In `infra/aws/modules/cms/main.tf`, change CMS container env `DATABASE_SSL` from `"false"` to `"true"` and add `DATABASE_SSL_REJECT_UNAUTHORIZED=false` for RDS cert acceptance.

## Validation

- [ ] ECS task definition sets `DATABASE_SSL=true` for the CMS container
- [ ] Optional: `DATABASE_SSL_REJECT_UNAUTHORIZED=false` for RDS (no CA bundle in image)
- [ ] Apply Terraform and redeploy; CMS tasks start and connect successfully

## Source links

- Issue: [#255](https://github.com/JesusFilm/forge/issues/255)
- PRs:
- None
