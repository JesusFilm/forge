---
artifactType: issue
issueNumber: 173
issueTitle: "feat(terraform): bootstrap isolated remote state backend"
issueUrl: "https://github.com/JesusFilm/forge/issues/173"
state: "CLOSED"
closedAt: "2026-03-04T00:05:17Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #173

## Background

Epic #67 requires Terraform-managed AWS infrastructure with safe CI operations. To prevent accidental deletion of Terraform state from unrelated infra changes, remote state resources must be isolated from the main infra root.

## Expected outcome

A dedicated Terraform bootstrap root provisions and protects remote state storage (S3 + lock table) used by `infra/aws`, with environment isolation and deletion safeguards.

## Acceptance criteria

- [ ] New isolated Terraform root exists for backend bootstrap (not coupled to `infra/aws` workload resources)
- [ ] S3 state bucket uses encryption, versioning, and public access block
- [ ] Locking resource is provisioned for state locking
- [ ] Destructive operations on backend resources are guarded (`prevent_destroy` and policy controls where appropriate)
- [ ] `infra/aws` is configured to consume remote state backend (with env-specific keys)
- [ ] Usage docs explain bootstrap/apply order and required backend config per env

## Possible solution(s)

1. Dedicated `infra/aws/bootstrap-state` Terraform root that creates S3 + lock table, with `prevent_destroy` on critical resources.
2. Per-environment backend keys under a shared protected bucket, using CI-provided backend config.
3. Optional stricter split: per-environment bucket and lock table if isolation requirements increase.

## References

- Epic: #67
- Existing AWS Terraform entrypoint: `infra/aws/main.tf`
- Existing Terraform workflow baseline: `.github/workflows/terraform-plan.yml`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
