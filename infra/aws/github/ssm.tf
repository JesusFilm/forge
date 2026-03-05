# GitHub App secrets in SSM (prod only). Terraform creates params; set values in AWS console.
resource "aws_ssm_parameter" "github_app_id" {
  count = var.environment == "prod" ? 1 : 0

  name  = "/forge/github/app_id"
  type  = "String"
  value = "manually set in AWS console"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "terraform_aws_role_apply_arn" {
  name  = "/forge/github/terraform_aws_role_apply_${var.environment}_arn"
  type  = "String"
  value = aws_iam_role.github_actions_terraform_apply.arn
}

resource "aws_ssm_parameter" "terraform_aws_role_plan_arn" {
  name  = "/forge/github/terraform_aws_role_plan_${var.environment}_arn"
  type  = "String"
  value = aws_iam_role.github_actions_terraform_plan.arn
}

resource "aws_ssm_parameter" "cms_deploy_role_arn" {
  name  = "/forge/github/cms_deploy_role_arn_${var.environment}"
  type  = "String"
  value = aws_iam_role.github_actions_cms_deploy.arn
}

resource "aws_ssm_parameter" "terraform_vercel_role_plan_arn" {
  count = var.environment == "prod" ? 1 : 0

  name  = "/forge/github/terraform_vercel_role_plan_arn"
  type  = "String"
  value = aws_iam_role.github_actions_terraform_stack["vercel_plan"].arn
}

resource "aws_ssm_parameter" "terraform_vercel_role_apply_arn" {
  count = var.environment == "prod" ? 1 : 0

  name  = "/forge/github/terraform_vercel_role_apply_arn"
  type  = "String"
  value = aws_iam_role.github_actions_terraform_stack["vercel_apply"].arn
}

resource "aws_ssm_parameter" "terraform_github_role_plan_arn" {
  count = var.environment == "prod" ? 1 : 0

  name  = "/forge/github/terraform_github_role_plan_arn"
  type  = "String"
  value = aws_iam_role.github_actions_terraform_stack["github_plan"].arn
}

resource "aws_ssm_parameter" "terraform_github_role_apply_arn" {
  count = var.environment == "prod" ? 1 : 0

  name  = "/forge/github/terraform_github_role_apply_arn"
  type  = "String"
  value = aws_iam_role.github_actions_terraform_stack["github_apply"].arn
}

resource "aws_ssm_parameter" "github_installation_id" {
  count = var.environment == "prod" ? 1 : 0

  name  = "/forge/github/installation_id"
  type  = "String"
  value = "manually set in AWS console"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "github_app_pem" {
  count = var.environment == "prod" ? 1 : 0

  name  = "/forge/github/app_private_key"
  type  = "SecureString"
  value = "manually set in AWS console"

  lifecycle {
    ignore_changes = [value]
  }
}
