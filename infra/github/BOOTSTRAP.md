# Bootstrap infra/github

One-time setup so this stack can manage the Forge repo (Actions variables, environments) and CI can run apply-github.

## Prerequisites

- **infra/aws** applied at least once so that:
  - State bucket and lock table exist (see `infra/backend-config/shared.hcl`).
  - Outputs exist in state: `github_actions_cms_deploy_role_arns`, `github_actions_terraform_state_role_arn`.
  - If you see _Invalid index_ or _Unsupported attribute_ on `actions.tf`, apply infra/aws first so this stack can read those outputs.
- **GitHub PAT** with the permissions below (see [Setting up a PAT](#setting-up-a-pat)).
- **AWS credentials** that can read the state bucket and lock table (and read infra/aws state). Use the same role you use for infra/aws apply (e.g. terraform-apply-prod) or a profile with equivalent access.

## Setting up a PAT

Use a **classic** Personal Access Token. Create it under **GitHub → Settings → Developer settings → Personal access tokens**.

1. **Tokens (classic)** → **Generate new token (classic)**.
2. **Note**: e.g. `forge-infra-github-bootstrap`.
3. **Expiration**: as needed.
4. **Scopes**: enable **repo** (covers repo metadata, Actions variables, and environments).
5. **Generate token**, copy it once (it won’t be shown again).

### Using the token

Set it in your environment before plan/apply; do not commit it:

```bash
export GITHUB_TOKEN="ghp_..."
# then
terraform plan -var="github_token=$GITHUB_TOKEN"
terraform apply -var="github_token=$GITHUB_TOKEN"
```

Or use Terraform’s env var: `TF_VAR_github_token` (Terraform reads `TF_VAR_*` into variables automatically).

## Steps

### 1) Init backend

From repo root:

```bash
cd infra/github
terraform init -backend-config=../backend-config/shared.hcl -backend-config=backend-config.hcl -reconfigure
```

### 2) Import the repository (recommended)

Import the existing repo so Terraform adopts its current config. After import, Terraform will keep description/visibility in sync with the live repo (or with your vars if you set them).

```bash
terraform import -var="github_token=$GITHUB_TOKEN" github_repository.forge forge
```

(Use repo **name** only when provider has `owner` set. If that fails, try ID `JesusFilm/forge`. Pass the token so import doesn’t fail with "Cannot import non-existent remote object".)

### 3) Import other existing resources (if any)

Only import resources that **already exist** in the repo. If you get `Cannot import non-existent remote object`, skip that import—run **apply** and Terraform will create the resource instead.

```bash
# Environments (import only the ones that already exist; Terraform will create the rest on apply)
# e.g. if only aws-prod exists:
terraform import 'github_repository_environment.aws_prod' forge:aws-prod
# if others exist:
# terraform import 'github_repository_environment.aws_stage' forge:aws-stage
# terraform import 'github_repository_environment.cms_stage' forge:cms-stage
# terraform import 'github_repository_environment.cms_prod' forge:cms-prod

# Repo-level variable (if created manually)
terraform import 'github_actions_variable.aws_region' forge:AWS_REGION
# Env-level (CMS deploy role; ID format may be repo:environment:variable_name)
# terraform import 'github_actions_environment_variable.cms_deploy_role_stage' forge:cms-stage:CMS_DEPLOY_ROLE_ARN
# terraform import 'github_actions_environment_variable.cms_deploy_role_prod' forge:cms-prod:CMS_DEPLOY_ROLE_ARN
```

Use your repo name if not `forge` (e.g. `myrepo:aws-stage`). Skip any import for resources that don’t exist yet.

**Stuck state lock:** If you see `Error acquiring the state lock` or `ConditionalCheckFailedException`, a previous run may have left the lock. From `infra/github` run `terraform force-unlock <LOCK_ID>` (use the Lock ID from the error message). Then retry the import or apply.

### 4) Apply

```bash
terraform plan -var="github_token=$GITHUB_TOKEN"
terraform apply -var="github_token=$GITHUB_TOKEN"
```

(`github_repository` defaults to `JesusFilm/forge`; override with `-var="github_repository=owner/repo"` if needed.)

This creates or updates: Actions variables (from infra/aws state), repo environments `aws-stage` / `aws-prod`.

### 5) Let CI use the state-only role (one-time)

The **apply-github** job needs the repo secret **TERRAFORM_STATE_ROLE_ARN**. This stack sets it from AWS state. If the secret doesn’t exist yet (first bootstrap), add it once by hand:

1. In **infra/aws**: `terraform output -raw github_actions_terraform_state_role_arn`
2. In the repo: **Settings → Secrets and variables → Actions → Secrets** → add **TERRAFORM_STATE_ROLE_ARN** with that ARN.

After that, pushes to `main` that touch `infra/github/` will run apply-github in CI using the state-only role.

## Optional: override description/visibility or default branch

Set `repository_description`, `repository_visibility`, or `repository_default_branch` in variables (or `-var`) and apply; Terraform will update the repo. If you don’t set them, Terraform keeps the current values (from the data source) so the repo stays as configured.
