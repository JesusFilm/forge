# GitHub (repo + future org)

Terraform-managed config for the Forge GitHub repo: Actions variables, repository settings, and deployment environments. May expand to org-level management later.

## Managed resources

| Resource                 | Purpose                                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actions vars/secrets** | Repo vars: `AWS_REGION`. Repo secrets: `STAGE_TERRAFORM_PLAN_ROLE_ARN`, `PROD_TERRAFORM_PLAN_ROLE_ARN`, `TERRAFORM_VERCEL_ROLE_ARN`, `TERRAFORM_GITHUB_ROLE_ARN`. Env secrets: `TERRAFORM_APPLY_ROLE_ARN` (aws-_), `CMS_DEPLOY_ROLE_ARN` (cms-_). |
| **Repository**           | description, visibility (hardcoded); import existing repo first if adopting.                                                                                                                                                                      |
| **Default branch**       | `main` (hardcoded)                                                                                                                                                                                                                                |
| **Environments**         | `aws-stage`, `aws-prod` (terraform-apply), `cms-stage`, `cms-prod` (cms-deploy)                                                                                                                                                                   |

## Prerequisites

- infra/aws applied (state in S3). GitHub App auth values live in SSM under `/forge/github/*` (Terraform creates params; set values in AWS console). `infra/github` reads them directly via AWS credentials, not via prod state outputs.

**First-time setup:** init with shared + stack backend config, apply (requires AWS creds that can read prod state); then set GitHub repo/env secrets from infra/aws outputs (role ARNs).

## Importing existing resources

If the repo already has **environments** or **Actions variables** that this stack will manage, import them so Terraform adopts them instead of recreating. Run from `infra/github` after `terraform init`.

**Environments** (import only those that already exist; Terraform creates any missing ones on apply):

```bash
# Example: only aws-prod exists
terraform import 'github_repository_environment.aws_prod' forge:aws-prod
# If both exist, also run:
# terraform import 'github_repository_environment.aws_stage' forge:aws-stage
```

**Actions variables** (if you created any manually):

```bash
terraform import 'github_actions_variable.aws_region' forge:AWS_REGION
```

(Repo secrets are not always importable; apply creates them.)

Env-level **secrets** (role ARNs; provider may not support import for secrets—re-apply infra/github to create):

```bash
# If replacing existing env variables with secrets, remove old vars in GitHub UI first, then apply.
# terraform import for github_actions_environment_secret is not always supported; apply creates them.
```

**Repository** (recommended so Terraform adopts the repo as configured):

```bash
terraform import github_repository.forge forge
```

(Import ID is repo name; provider has `owner` set. Auth is via app_auth from SSM-backed provider config.)

Import ID format: repository name (e.g. `forge`) for repo-scoped resources, including `github_repository`.

## Usage

**From CI:** Pushes to `stage`/`main` that touch `infra/github/` run `terraform apply` here (see terraform-apply workflow). State is in the shared S3 bucket (`infra/backend-config`).

**Locally:**

1. State uses the same S3 bucket as other stacks. Init with shared config + this stack's key:
   ```bash
   terraform init -backend-config=../backend-config/shared.hcl -backend-config=backend-config.hcl -reconfigure
   ```
2. Plan/apply (AWS creds must allow reading prod state S3 bucket and `/forge/github/*` SSM parameters):

   ```bash
   terraform plan
   terraform apply
   ```

3. Import the repo so Terraform adopts it as configured: `terraform import github_repository.forge forge` (see [BOOTSTRAP.md](BOOTSTRAP.md)).

4. Re-run after infra/aws changes that affect role ARNs or `/forge/github/*` SSM parameters.

## Variables

- **Auth:** GitHub provider uses app_auth from SSM parameters under `/forge/github/*` (see Prerequisites). No Terraform variables for auth; repo and settings hardcoded (JesusFilm/forge).
