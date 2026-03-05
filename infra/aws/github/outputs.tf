output "github_actions_cms_deploy_role_arn" {
  description = "GitHub Actions role for CMS deploy."
  value       = aws_iam_role.github_actions_cms_deploy.arn
}

output "github_actions_terraform_apply_role_arn" {
  description = "GitHub Actions role for Terraform apply."
  value       = aws_iam_role.github_actions_terraform_apply.arn
}

output "github_actions_terraform_plan_role_arn" {
  description = "GitHub Actions role for Terraform plan."
  value       = aws_iam_role.github_actions_terraform_plan.arn
}

output "github_actions_terraform_state_role_arn" {
  description = "GitHub Actions role for Terraform state read/write only."
  value       = local.terraform_state_role_arn
}

output "github_app_id" {
  description = "GitHub App ID (prod SSM value; for infra/github provider via remote state)."
  value       = var.environment == "prod" ? aws_ssm_parameter.github_app_id[0].value : null
  sensitive   = true
}

output "github_installation_id" {
  description = "GitHub App installation ID (prod SSM value; for infra/github provider via remote state)."
  value       = var.environment == "prod" ? aws_ssm_parameter.github_installation_id[0].value : null
  sensitive   = true
}

output "github_app_pem" {
  description = "GitHub App private key PEM (prod SSM value; for infra/github provider via remote state)."
  value       = var.environment == "prod" ? aws_ssm_parameter.github_app_pem[0].value : null
  sensitive   = true
}
