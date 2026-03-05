# Actions configuration: secrets and variables from AWS IAM/SSM-backed lookups.
# Requires infra/aws applied so the expected CI roles already exist.
# GitHub reserves variable names starting with GITHUB_.

# ------------------------------------------------------------------------------
# Environment-scoped secrets (aws-*, cms-*).
# Use for: jobs that declare `environment: aws-prod`, `environment: cms-stage`, etc.
# Values are masked in logs. Apply (terraform-apply) and cms-deploy use these.
# ------------------------------------------------------------------------------

resource "github_actions_environment_secret" "terraform_apply_role_stage" {
  repository      = github_repository.forge.name
  environment     = github_repository_environment.aws_stage.environment
  secret_name     = "TERRAFORM_APPLY_ROLE_ARN"
  plaintext_value = data.aws_iam_role.terraform_apply_stage.arn
}

resource "github_actions_environment_secret" "terraform_apply_role_prod" {
  repository      = github_repository.forge.name
  environment     = github_repository_environment.aws_prod.environment
  secret_name     = "TERRAFORM_APPLY_ROLE_ARN"
  plaintext_value = data.aws_iam_role.terraform_apply_prod.arn
}

resource "github_actions_environment_secret" "cms_deploy_role_stage" {
  repository      = github_repository.forge.name
  environment     = github_repository_environment.cms_stage.environment
  secret_name     = "CMS_DEPLOY_ROLE_ARN"
  plaintext_value = data.aws_iam_role.cms_deploy_stage.arn
}

resource "github_actions_environment_secret" "cms_deploy_role_prod" {
  repository      = github_repository.forge.name
  environment     = github_repository_environment.cms_prod.environment
  secret_name     = "CMS_DEPLOY_ROLE_ARN"
  plaintext_value = data.aws_iam_role.cms_deploy_prod.arn
}

# ------------------------------------------------------------------------------
# Repository-level secrets (no environment).
# Use for: jobs that must not use an environment (e.g. terraform-plan) or
# repo-wide values that should be masked (role ARNs, tokens).
# ------------------------------------------------------------------------------

resource "github_actions_secret" "stage_terraform_plan_role_arn" {
  repository      = github_repository.forge.name
  secret_name     = "STAGE_TERRAFORM_PLAN_ROLE_ARN"
  plaintext_value = data.aws_iam_role.terraform_plan_stage.arn
}

resource "github_actions_secret" "prod_terraform_plan_role_arn" {
  repository      = github_repository.forge.name
  secret_name     = "PROD_TERRAFORM_PLAN_ROLE_ARN"
  plaintext_value = data.aws_iam_role.terraform_plan_prod.arn
}

resource "github_actions_secret" "vercel_terraform_role_arn" {
  repository      = github_repository.forge.name
  secret_name     = "TERRAFORM_VERCEL_ROLE_ARN"
  plaintext_value = data.aws_iam_role.terraform_vercel.arn
}

resource "github_actions_secret" "github_terraform_role_arn" {
  repository      = github_repository.forge.name
  secret_name     = "TERRAFORM_GITHUB_ROLE_ARN"
  plaintext_value = data.aws_iam_role.terraform_github.arn
}

# ------------------------------------------------------------------------------
# Repository-level variables (non-sensitive, visible in logs).
# Use for: config that is safe to show (e.g. region name, feature flags).
# ------------------------------------------------------------------------------

resource "github_actions_variable" "aws_region" {
  repository    = github_repository.forge.name
  variable_name = "AWS_REGION"
  value         = "us-east-2"
}
