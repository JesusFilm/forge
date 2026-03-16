---
artifactType: issue
issueNumber: 255
issueTitle: "fix(infra): enable SSL for CMS ECS → RDS connection"
issueUrl: "https://github.com/JesusFilm/forge/issues/255"
state: "CLOSED"
closedAt: "2026-03-06T09:32:54Z"
labels: ["fix", "infra"]
linkedPrs: []
---

# Issue Artifact: #255

## Background

CMS ECS tasks fail on deploy with: `no pg_hba.conf entry for host "10.30.x.x", user "cms", database "cms", no encryption`. RDS Postgres requires SSL; the task definition had `DATABASE_SSL=false`.

## Expected outcome

CMS tasks connect to RDS over TLS. Deploy (Roll ECS service to new image) succeeds and services become stable.

## Acceptance criteria

- [ ] ECS task definition sets `DATABASE_SSL=true` for the CMS container
- [ ] Optional: `DATABASE_SSL_REJECT_UNAUTHORIZED=false` for RDS (no CA bundle in image)
- [ ] Apply Terraform and redeploy; CMS tasks start and connect successfully

## Possible solution(s)

1. In `infra/aws/modules/cms/main.tf`, change CMS container env `DATABASE_SSL` from `"false"` to `"true"` and add `DATABASE_SSL_REJECT_UNAUTHORIZED=false` for RDS cert acceptance.

## References

- ECS deploy failure: cms-deploy #45 (Roll ECS service to new image)
- RDS SSL: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
