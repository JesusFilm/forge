---
artifactType: issue
issueNumber: 277
issueTitle: "chore(infra): harden Terraform configuration"
issueUrl: "https://github.com/JesusFilm/forge/issues/277"
state: "CLOSED"
closedAt: "2026-03-08T22:00:07Z"
labels: ["chore", "infra"]
linkedPrs: []
---

# Issue Artifact: #277

## Background

Terraform hardening was requested: sensitive outputs/vars, ALB log bucket versioning, provider lock, DB backup retention and window, backend comments, root output cleanup, and S3 lifecycle for all log buckets so logs do not grow unbounded.

## Expected outcome

- Sensitive outputs and variables marked `sensitive = true`.
- ALB and assets access log S3 buckets have versioning and lifecycle (expire after 90 days).
- DB backup retention default 30 days; preferred backup window set for night US/NZ (09:00-10:00 UTC).
- Backend config documented via comments in backend.tf / providers.tf.
- Root AWS outputs removed (other stacks load from SSM).
- Provider lock files in use (existing); no code change required.

## Acceptance criteria

- [ ] Sensitive outputs (db_master_secret_arn, db_instance_endpoint, KMS ARNs) and db_username marked sensitive.
- [ ] ALB logs S3 bucket has versioning and lifecycle rule (expire 90 days).
- [ ] Assets access logs S3 bucket has lifecycle rule (expire 90 days).
- [ ] db_backup_retention_period default 30; db_preferred_backup_window 09:00-10:00 UTC on RDS.
- [ ] Backend comments in infra/aws/backend.tf, infra/vercel/providers.tf, infra/github/providers.tf.
- [ ] infra/aws/outputs.tf root outputs removed (comment only).

## Possible solution(s)

1. Apply changes as implemented in this branch.

## References

- Prior hardening recommendations and quick wins.

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
