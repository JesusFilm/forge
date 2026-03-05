# GitHub (repo + future org)

Terraform-managed config for the Forge GitHub repo: Actions variables, repository settings, and deployment environments. May expand to org-level management later.

## Managed resources

| Resource                 | Purpose                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actions vars/secrets** | Repo vars: `AWS_REGION`. Repo secrets: `TERRAFORM_STATE_ROLE_ARN`, `STAGE_TERRAFORM_PLAN_ROLE_ARN`, `PROD_TERRAFORM_PLAN_ROLE_ARN`. Env secrets: `TERRAFORM_APPLY_ROLE_ARN` (aws-_), `CMS_DEPLOY_ROLE_ARN` (cms-_). |
| **Repository**           | Optional: description, visibility (enable via vars; import existing repo first)                                                                                                                                     |
| **Default branch**       | `main` (hardcoded)                                                                                                                                                                                                  |
| **Environments**         | `aws-stage`, `aws-prod` (terraform-apply), `cms-stage`, `cms-prod` (cms-deploy)                                                                                                                                     |

## Prerequisites

- infra/aws applied (state in S3)
- GitHub token with repo admin or: Actions variables read/write, repository metadata read/write

**First-time setup:** see [BOOTSTRAP.md](./BOOTSTRAP.md) for init, import, apply, and CI variable.

## Importing existing resources

If the repo already has **environments** or **Actions variables** that this stack will manage, import them so Terraform adopts them instead of recreating. Run from `infra/github` after `terraform init` (use the same `-var` as plan/apply for consistency).

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
terraform import -var="github_token=$GITHUB_TOKEN" github_repository.forge forge
```

(Import ID is repo name when provider has `owner`; if it fails, try `JesusFilm/forge`.)

Import ID format: repository name (e.g. `forge`) for repo-scoped resources; `owner/repo` for the repository resource.

## Usage

**From CI:** Pushes to `stage`/`main` that touch `infra/github/` run `terraform apply` here (see terraform-apply workflow). State is in the shared S3 bucket (`infra/backend-config`).

**Locally:**

1. State uses the same S3 bucket as other stacks. Init with shared config + this stack's key:
   ```bash
   terraform init -backend-config=../backend-config/shared.hcl -backend-config=backend-config.hcl -reconfigure
   ```
2. Plan/apply (AWS state location is fixed to prod in data.tf; matches backend-config):

   ```bash
   terraform plan -var="github_token=$GITHUB_TOKEN"
   terraform apply  # same -var
   ```

3. Import the repo so Terraform adopts it as configured: `terraform import -var="github_token=$GITHUB_TOKEN" github_repository.forge forge` (see [BOOTSTRAP.md](BOOTSTRAP.md)).

4. Re-run after infra/aws changes that affect role ARNs (or any time you change the variables above).

## Variables

- **Required:** `github_token`
- **Optional:** `aws_region` (default `us-east-2`). Repository and repo settings are hardcoded (JesusFilm/forge).
