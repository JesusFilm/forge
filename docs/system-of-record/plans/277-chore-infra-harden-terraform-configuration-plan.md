---
artifactType: plan
sourceIssueNumber: 277
sourceIssueTitle: "chore(infra): harden Terraform configuration"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/277"
linkedPrs: []
---

# Plan Artifact: #277

## Objective

- Sensitive outputs and variables marked `sensitive = true`.
- ALB and assets access log S3 buckets have versioning and lifecycle (expire after 90 days).
- DB backup retention default 30 days; preferred backup window set for night US/NZ (09:00-10:00 UTC).
- Backend config documented via comments in backend.tf / providers.tf.
- Root AWS outputs removed (other stacks load from SSM).
- Provider lock files in use (existing); no code change required.

## Planned approach

1. Apply changes as implemented in this branch.

## Validation

- [ ] Sensitive outputs (db_master_secret_arn, db_instance_endpoint, KMS ARNs) and db_username marked sensitive.
- [ ] ALB logs S3 bucket has versioning and lifecycle rule (expire 90 days).
- [ ] Assets access logs S3 bucket has lifecycle rule (expire 90 days).
- [ ] db_backup_retention_period default 30; db_preferred_backup_window 09:00-10:00 UTC on RDS.
- [ ] Backend comments in infra/aws/backend.tf, infra/vercel/providers.tf, infra/github/providers.tf.
- [ ] infra/aws/outputs.tf root outputs removed (comment only).

## Source links

- Issue: [#277](https://github.com/JesusFilm/forge/issues/277)
- PRs:
- None
