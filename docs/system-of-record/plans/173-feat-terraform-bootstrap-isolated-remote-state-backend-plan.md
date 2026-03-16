---
artifactType: plan
sourceIssueNumber: 173
sourceIssueTitle: "feat(terraform): bootstrap isolated remote state backend"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/173"
linkedPrs: []
---

# Plan Artifact: #173

## Objective

A dedicated Terraform bootstrap root provisions and protects remote state storage (S3 + lock table) used by `infra/aws`, with environment isolation and deletion safeguards.

## Planned approach

1. Dedicated `infra/aws/bootstrap-state` Terraform root that creates S3 + lock table, with `prevent_destroy` on critical resources.
2. Per-environment backend keys under a shared protected bucket, using CI-provided backend config.
3. Optional stricter split: per-environment bucket and lock table if isolation requirements increase.

## Validation

- [ ] New isolated Terraform root exists for backend bootstrap (not coupled to `infra/aws` workload resources)
- [ ] S3 state bucket uses encryption, versioning, and public access block
- [ ] Locking resource is provisioned for state locking
- [ ] Destructive operations on backend resources are guarded (`prevent_destroy` and policy controls where appropriate)
- [ ] `infra/aws` is configured to consume remote state backend (with env-specific keys)
- [ ] Usage docs explain bootstrap/apply order and required backend config per env

## Source links

- Issue: [#173](https://github.com/JesusFilm/forge/issues/173)
- PRs:
- None
