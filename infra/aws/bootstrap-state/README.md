# infra/aws/bootstrap-state

Bootstrap Terraform root for remote state infrastructure.

## Why this exists

This root is intentionally isolated from `infra/aws` workload resources so normal infrastructure changes cannot destroy the Terraform backend.
This root is local/manual-only and must not be applied by CI.

## Provisions

- S3 bucket for Terraform state
- DynamoDB table for state locking
- KMS key for encryption at rest
- IAM deny policy for CI role attachment (blocks backend mutation)
- Safeguards (`prevent_destroy`, S3 public access block, TLS-only bucket policy)

## Manual runbook (canonical)

### 0) One-time account hardening (clean account)

1. Enable root MFA and do not use root for daily work.
2. Create an `AdministratorAccess` bootstrap user/role for initial setup only.
3. Set AWS account alias, billing alarms, and CloudTrail (recommended baseline).

### 1) Local prerequisites

1. Install tools:
   - AWS CLI
   - Terraform `>= 1.6`
2. After creating IAM user with `AdministratorAccess`, create an access key for that user (AWS Console -> IAM -> Users -> `<bootstrap-user>` -> Security credentials -> Create access key).
3. Configure local profile with that access key:
   - `aws configure --profile forge-bootstrap`
   - AWS Access Key ID: `<from step 2>`
   - AWS Secret Access Key: `<from step 2>`
   - Default region name: `us-east-2`
   - Default output format: `json`
4. Verify you are in the new account (not your old default account):
   - `aws sts get-caller-identity --profile forge-bootstrap`
5. Set session env vars before bootstrap commands:
   - `export AWS_PROFILE=forge-bootstrap`
   - `export AWS_REGION=us-east-2`
6. Optional safety: if CLI still points to wrong account, clear overriding env credentials first:
   - `unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN`

### 2) Bootstrap remote state (manual, one-time)

1. Run bootstrap first (without CI role ARNs yet):
   - `terraform -chdir=infra/aws/bootstrap-state init`
   - `terraform -chdir=infra/aws/bootstrap-state apply`
2. Capture outputs:
   - `terraform -chdir=infra/aws/bootstrap-state output`

### 3) Bootstrap phase: create GitHub OIDC + CI roles (one-time, manual)

`infra/aws` now creates GitHub OIDC and separate CI roles via Terraform:

- OIDC provider: `aws_iam_openid_connect_provider.github_actions`
- CMS deploy roles (app deploy only):
  - `forge-github-actions-cms-deploy-stage`
  - `forge-github-actions-cms-deploy-prod`
- Terraform apply roles (branch-only trust):
  - `forge-github-actions-terraform-apply-stage` (`ref:refs/heads/stage`)
  - `forge-github-actions-terraform-apply-prod` (`ref:refs/heads/main`)
- Terraform plan roles (PR-only trust + read-only policy):
  - `forge-github-actions-terraform-plan-stage` (`pull_request`)
  - `forge-github-actions-terraform-plan-prod` (`pull_request`)
- Outputs:
  - `github_actions_cms_deploy_role_arns`
  - `github_actions_terraform_apply_role_arns`
  - `github_actions_terraform_plan_role_arns`

Create these IAM resources manually first (using bootstrap credentials), then CI can assume them:

1. Stage role:
   - `terraform -chdir=infra/aws init -backend-config=backend-config/stage.hcl -reconfigure`
   - `terraform -chdir=infra/aws apply -target=module.github -var='environment=stage'`
2. Prod role:
   - `terraform -chdir=infra/aws init -backend-config=backend-config/prod.hcl -reconfigure`
   - `terraform -chdir=infra/aws apply -target=module.github -var='environment=prod'`

After this one-time manual creation, CI should use OIDC assume-role only.
If trust policy changes later, rerun these same two `apply -target=module.github` commands.

### 4) Add CI role ARNs to bootstrap deny controls (after step 3)

After OIDC roles exist, re-apply bootstrap with role ARNs:

- `terraform -chdir=infra/aws/bootstrap-state apply -var='ci_role_arns=["arn:aws:iam::031374266475:role/forge-github-actions-terraform-apply-stage","arn:aws:iam::031374266475:role/forge-github-actions-terraform-apply-prod","arn:aws:iam::031374266475:role/forge-github-actions-terraform-plan-stage","arn:aws:iam::031374266475:role/forge-github-actions-terraform-plan-prod"]'`

This adds principal-scoped deny rules in the state bucket policy.

### 5) Enforce deny policy on CI role(s)

Attach generated explicit-deny policy to each CI role:

- `aws iam attach-role-policy --role-name forge-github-actions-terraform-apply-stage --policy-arn "$(terraform -chdir=infra/aws/bootstrap-state output -raw deny_bootstrap_state_mutation_policy_arn)"`
- `aws iam attach-role-policy --role-name forge-github-actions-terraform-apply-prod --policy-arn "$(terraform -chdir=infra/aws/bootstrap-state output -raw deny_bootstrap_state_mutation_policy_arn)"`
- `aws iam attach-role-policy --role-name forge-github-actions-terraform-plan-stage --policy-arn "$(terraform -chdir=infra/aws/bootstrap-state output -raw deny_bootstrap_state_mutation_policy_arn)"`
- `aws iam attach-role-policy --role-name forge-github-actions-terraform-plan-prod --policy-arn "$(terraform -chdir=infra/aws/bootstrap-state output -raw deny_bootstrap_state_mutation_policy_arn)"`

This ensures CI cannot mutate/delete backend S3/DynamoDB/KMS even if another policy grants it.

### 6) Update committed backend config files

1. Update:
   - `infra/aws/backend-config/stage.hcl`
   - `infra/aws/backend-config/prod.hcl`
2. Fill values from bootstrap outputs:
   - `bucket`
   - `dynamodb_table`
   - `region`
   - keep keys separate (`infra/aws/stage/...` vs `infra/aws/prod/...`)

### 7) CI wiring (Terraform runs only in CI)

After bootstrap steps are complete:

1. Merge to `stage` to run stage CI deploy flow.
2. Merge to `main` to run prod CI deploy flow.
3. CI should auto-assume the matching OIDC role by branch/event:
   - PR plan (approved review required) -> `forge-github-actions-terraform-plan-stage|prod` (read-only role)
   - `stage` apply -> `forge-github-actions-terraform-apply-stage`
   - `main` apply -> `forge-github-actions-terraform-apply-prod`
4. CI Terraform commands should use committed backend config + env var:
   - `terraform -chdir=infra/aws init -backend-config=backend-config/<env>.hcl -reconfigure`
   - `terraform -chdir=infra/aws plan -var="environment=<env>"`
   - `terraform -chdir=infra/aws apply -var="environment=<env>"` (apply job only)
5. Keep prod apply approval-gated.
6. Never run apply in `infra/aws/bootstrap-state`.

### 9) Required GitHub protections (must configure in repo settings)

1. Branch protection/rulesets:
   - Require pull request reviews before merge.
   - Require CODEOWNERS review for `.github/workflows/**` and `infra/**`.
   - Dismiss stale approvals on new commits.
2. Environments:
   - Keep `aws-prod` protected with required reviewers.
   - Restrict deployment branches for `aws-prod` to `main` and `aws-stage` to `stage`.
3. Security outcome:
   - PR workflow edits cannot grant apply capability because PR roles are read-only.
   - Apply roles cannot be assumed from PR contexts because trust is branch-only.

### 8) Validation checklist

- `terraform state list` works in CI for each env.
- Stage CI can plan/apply and cannot touch prod state key.
- CI role cannot delete state bucket, lock table, or KMS key.
- Bootstrap changes require operator credentials and manual run.

## Notes

- Keep this root small and stable.
- Manage backend changes through explicit, reviewed PRs only.
- Run bootstrap applies manually from a trusted operator workstation.
