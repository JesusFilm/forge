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

### 2) Create CI IAM role(s) for Terraform apply/plan

Create one role per environment (recommended): `forge-terraform-stage`, `forge-terraform-prod`.

Trust policy example (GitHub OIDC, branch-scoped):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": [
            "repo:JesusFilm/forge:ref:refs/heads/stage",
            "repo:JesusFilm/forge:ref:refs/heads/main"
          ]
        }
      }
    }
  ]
}
```

Notes:

- If OIDC provider does not exist yet, create it first in IAM.
- Attach your normal Terraform runtime policy to these CI roles (for `infra/aws` resources).

### 3) Bootstrap remote state (manual, one-time)

1. Run bootstrap with CI role ARNs blocked from backend mutation:
   - `terraform -chdir=infra/aws/bootstrap-state init`
   - `terraform -chdir=infra/aws/bootstrap-state apply -var='ci_role_arns=["arn:aws:iam::<account-id>:role/forge-terraform-stage","arn:aws:iam::<account-id>:role/forge-terraform-prod"]'`
2. Capture outputs:
   - `terraform -chdir=infra/aws/bootstrap-state output`

### 4) Enforce deny policy on CI role(s)

Attach generated explicit-deny policy to each CI role:

- `aws iam attach-role-policy --role-name forge-terraform-stage --policy-arn "$(terraform -chdir=infra/aws/bootstrap-state output -raw deny_bootstrap_state_mutation_policy_arn)"`
- `aws iam attach-role-policy --role-name forge-terraform-prod --policy-arn "$(terraform -chdir=infra/aws/bootstrap-state output -raw deny_bootstrap_state_mutation_policy_arn)"`

This ensures CI cannot mutate/delete backend S3/DynamoDB/KMS even if another policy grants it.

### 5) Create backend config files (local source-of-truth)

1. Copy templates:
   - `cp infra/aws/backend-config/stage.hcl.example infra/aws/backend-config/stage.hcl`
   - `cp infra/aws/backend-config/prod.hcl.example infra/aws/backend-config/prod.hcl`
2. Fill values from bootstrap outputs:
   - `bucket`
   - `dynamodb_table`
   - `region`
   - keep keys separate (`infra/aws/stage/...` vs `infra/aws/prod/...`)
3. Do not commit `.hcl` files (already gitignored).

### 6) CI wiring (Terraform runs only in CI)

Per environment CI job should:

1. Assume env role (`forge-terraform-stage` or `forge-terraform-prod`).
2. Materialize backend config from secret/secure variable store.
3. Run:
   - `terraform -chdir=infra/aws init -backend-config=backend-config/<env>.hcl -reconfigure`
   - `terraform -chdir=infra/aws plan -var="environment=<env>"`
   - `terraform -chdir=infra/aws apply -var="environment=<env>"` (apply job only)
4. Require approval gate for prod apply.
5. Never run apply in `infra/aws/bootstrap-state`.

### 7) Validation checklist

- `terraform state list` works in CI for each env.
- Stage CI can plan/apply and cannot touch prod state key.
- CI role cannot delete state bucket, lock table, or KMS key.
- Bootstrap changes require operator credentials and manual run.

## Notes

- Keep this root small and stable.
- Manage backend changes through explicit, reviewed PRs only.
- Run bootstrap applies manually from a trusted operator workstation.
