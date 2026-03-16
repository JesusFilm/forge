---
artifactType: issue
issueNumber: 235
issueTitle: "fix(terraform): allow plan roles to decrypt CMS SSM parameters"
issueUrl: "https://github.com/JesusFilm/forge/issues/235"
state: "CLOSED"
closedAt: "2026-03-08T22:09:16Z"
labels: []
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #235

## Background

`plan-aws` can assume the stage/prod Terraform plan roles, but the plan fails when Terraform refreshes the existing CMS `SecureString` SSM parameters. Those parameters use the environment-specific CMS KMS key, and the `forge-github-actions-terraform-plan-*` roles currently have `ReadOnlyAccess` only, so AWS rejects the underlying `kms:Decrypt` call.

## Expected outcome

`plan-aws` succeeds for both stage and prod when refreshing the CMS SSM parameters because the Terraform plan roles can decrypt the CMS SSM KMS key used by those `SecureString` values.

## Acceptance criteria

- [ ] The Terraform plan role for `stage` can decrypt the stage CMS SSM KMS key.
- [ ] The Terraform plan role for `prod` can decrypt the prod CMS SSM KMS key.
- [ ] Access is scoped to the CMS SSM KMS key rather than broad KMS admin access.
- [ ] Terraform plan passes the affected AWS stack checks after the change.

## Possible solution(s)

1. Expose the CMS SSM KMS key ARN from the CMS/platform modules and attach a scoped `kms:Decrypt` policy to the Terraform plan role in `infra/aws/github`.
2. Keep the existing `ReadOnlyAccess` attachment and add only the missing decrypt permission needed for CMS `SecureString` refreshes.
3. Validate both stage and prod plans because the current failure is visible in prod but the intended access model should be consistent across environments.

## References

- Failed check: https://github.com/JesusFilm/forge/actions/runs/22748553725/job/65977709597
- `infra/aws/modules/cms/main.tf`
- `infra/aws/modules/cms/outputs.tf`
- `infra/aws/modules/platform/outputs.tf`
- `infra/aws/github/terraform.tf`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
