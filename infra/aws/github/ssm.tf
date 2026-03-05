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

resource "aws_ssm_parameter" "terraform_apply_role_arn" {
  name  = "/forge/github/terraform_apply_role_arn_${var.environment}"
  type  = "String"
  value = aws_iam_role.github_actions_terraform_apply.arn
}

resource "aws_ssm_parameter" "terraform_plan_role_arn" {
  name  = "/forge/github/terraform_plan_role_arn_${var.environment}"
  type  = "String"
  value = aws_iam_role.github_actions_terraform_plan.arn
}

resource "aws_ssm_parameter" "cms_deploy_role_arn" {
  name  = "/forge/github/cms_deploy_role_arn_${var.environment}"
  type  = "String"
  value = aws_iam_role.github_actions_cms_deploy.arn
}

resource "aws_ssm_parameter" "terraform_vercel_role_arn" {
  count = var.environment == "prod" ? 1 : 0

  name  = "/forge/github/terraform_vercel_role_arn"
  type  = "String"
  value = aws_iam_role.github_actions_terraform_stack["vercel"].arn
}

resource "aws_ssm_parameter" "terraform_github_role_arn" {
  count = var.environment == "prod" ? 1 : 0

  name  = "/forge/github/terraform_github_role_arn"
  type  = "String"
  value = aws_iam_role.github_actions_terraform_stack["github"].arn
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
