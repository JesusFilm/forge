---
artifactType: issue
issueNumber: 236
issueTitle: "fix(infra): harden vercel and github SSM secrets with customer-managed KMS"
issueUrl: "https://github.com/JesusFilm/forge/issues/236"
state: "CLOSED"
closedAt: "2026-03-06T05:08:48Z"
labels: ["fix", "infra"]
linkedPrs: []
---

# Issue Artifact: #236

## Background

The `infra/aws/vercel` and `infra/aws/github` stacks still create SecureString SSM parameters without explicitly assigning customer-managed KMS keys. We already hardened the CMS stack to use a dedicated customer-managed key and explicit decrypt permissions; these remaining stacks should follow the same pattern so SecureString access is governed by scoped KMS policies rather than default key behavior.

## Expected outcome

Vercel and GitHub SecureString SSM parameters are encrypted with explicit customer-managed KMS keys, and only the Terraform/GitHub roles or other runtime consumers that need to read them have the minimum required KMS decrypt or data key permissions.

## Acceptance criteria

- [ ] `infra/aws/vercel/ssm.tf` uses an explicit customer-managed KMS key for its SecureString parameters.
- [ ] `infra/aws/github/ssm.tf` uses an explicit customer-managed KMS key for its SecureString parameters.
- [ ] Any role or consumer that reads those parameters has only the minimal required KMS permissions added.
- [ ] Any required module outputs/variables are wired similarly to the existing CMS pattern, without widening unrelated access.
- [ ] `terraform fmt` and `terraform validate` pass for the touched Terraform configurations.

## Possible solution(s)

1. Add a dedicated KMS key and alias per bounded stack, then set `key_id` on each SecureString parameter.
2. Pass the key ARN through outputs/variables where cross-stack readers need explicit `kms:Decrypt` or `kms:GenerateDataKey` access.
3. Reuse existing stack-specific IAM policy patterns to keep SSM and KMS permissions least-privilege.

## References

- Existing CMS hardening pattern in `infra/aws/modules/cms/main.tf`
- Requested scope: `infra/aws/vercel/ssm.tf`, `infra/aws/github/ssm.tf`, and only the Terraform wiring needed for customer-managed KMS + least-privilege access

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
