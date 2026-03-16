---
artifactType: plan
sourceIssueNumber: 236
sourceIssueTitle: "fix(infra): harden vercel and github SSM secrets with customer-managed KMS"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/236"
linkedPrs: []
---

# Plan Artifact: #236

## Objective

Vercel and GitHub SecureString SSM parameters are encrypted with explicit customer-managed KMS keys, and only the Terraform/GitHub roles or other runtime consumers that need to read them have the minimum required KMS decrypt or data key permissions.

## Planned approach

1. Add a dedicated KMS key and alias per bounded stack, then set `key_id` on each SecureString parameter.
2. Pass the key ARN through outputs/variables where cross-stack readers need explicit `kms:Decrypt` or `kms:GenerateDataKey` access.
3. Reuse existing stack-specific IAM policy patterns to keep SSM and KMS permissions least-privilege.

## Validation

- [ ] `infra/aws/vercel/ssm.tf` uses an explicit customer-managed KMS key for its SecureString parameters.
- [ ] `infra/aws/github/ssm.tf` uses an explicit customer-managed KMS key for its SecureString parameters.
- [ ] Any role or consumer that reads those parameters has only the minimal required KMS permissions added.
- [ ] Any required module outputs/variables are wired similarly to the existing CMS pattern, without widening unrelated access.
- [ ] `terraform fmt` and `terraform validate` pass for the touched Terraform configurations.

## Source links

- Issue: [#236](https://github.com/JesusFilm/forge/issues/236)
- PRs:
- None
