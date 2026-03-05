# Actions configuration: secrets and variables from AWS SSM-backed lookups.
# Requires infra/aws applied so the expected SSM parameters already exist.
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
  plaintext_value = data.aws_ssm_parameter.terraform_aws_role_apply_arn_stage.value
}

resource "github_actions_environment_secret" "terraform_apply_role_prod" {
  repository      = github_repository.forge.name
  environment     = github_repository_environment.aws_prod.environment
  secret_name     = "TERRAFORM_APPLY_ROLE_ARN"
  plaintext_value = data.aws_ssm_parameter.terraform_aws_role_apply_arn_prod.value
}

resource "github_actions_environment_secret" "cms_deploy_role_stage" {
  repository      = github_repository.forge.name
  environment     = github_repository_environment.cms_stage.environment
  secret_name     = "CMS_DEPLOY_ROLE_ARN"
  plaintext_value = data.aws_ssm_parameter.cms_deploy_role_arn_stage.value
}

resource "github_actions_environment_secret" "cms_deploy_role_prod" {
  repository      = github_repository.forge.name
  environment     = github_repository_environment.cms_prod.environment
  secret_name     = "CMS_DEPLOY_ROLE_ARN"
  plaintext_value = data.aws_ssm_parameter.cms_deploy_role_arn_prod.value
}

# ------------------------------------------------------------------------------
# Environment-scoped secrets.
# Use for: jobs that require environment-specific values, including
# terraform plan/apply role ARNs and deploy credentials.
# ------------------------------------------------------------------------------

resource "github_actions_environment_secret" "aws_plan_role_stage" {
  repository      = github_repository.forge.name
  environment     = github_repository_environment.aws_plan_stage.environment
  secret_name     = "TERRAFORM_ROLE_ARN"
  plaintext_value = data.aws_ssm_parameter.terraform_aws_role_plan_arn_stage.value
}

resource "github_actions_environment_secret" "aws_plan_role_prod" {
  repository      = github_repository.forge.name
  environment     = github_repository_environment.aws_plan_prod.environment
  secret_name     = "TERRAFORM_ROLE_ARN"
  plaintext_value = data.aws_ssm_parameter.terraform_aws_role_plan_arn_prod.value
}

resource "github_actions_environment_secret" "vercel_terraform_role_plan" {
  repository      = github_repository.forge.name
  environment     = github_repository_environment.vercel_plan.environment
  secret_name     = "TERRAFORM_ROLE_ARN"
  plaintext_value = data.aws_ssm_parameter.terraform_vercel_role_plan_arn.value
}

resource "github_actions_environment_secret" "vercel_terraform_role_apply" {
  repository      = github_repository.forge.name
  environment     = github_repository_environment.vercel_prod.environment
  secret_name     = "TERRAFORM_ROLE_ARN"
  plaintext_value = data.aws_ssm_parameter.terraform_vercel_role_apply_arn.value
}

resource "github_actions_environment_secret" "github_terraform_role_plan" {
  repository      = github_repository.forge.name
  environment     = github_repository_environment.github_plan.environment
  secret_name     = "TERRAFORM_ROLE_ARN"
  plaintext_value = data.aws_ssm_parameter.terraform_github_role_plan_arn.value
}

resource "github_actions_environment_secret" "github_terraform_role_apply" {
  repository      = github_repository.forge.name
  environment     = github_repository_environment.github_prod.environment
  secret_name     = "TERRAFORM_ROLE_ARN"
  plaintext_value = data.aws_ssm_parameter.terraform_github_role_apply_arn.value
}

# ------------------------------------------------------------------------------
# Repository-level variables (non-sensitive, visible in logs).
# Use for: config that is safe to show (e.g. region name, feature flags).
# ------------------------------------------------------------------------------

resource "github_actions_variable" "aws_region" {
  repository    = github_repository.forge.name
  variable_name = "AWS_REGION"
  value         = var.aws_region
}
