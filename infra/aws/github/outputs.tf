output "github_actions_cms_deploy_role_arns" {
  description = "GitHub Actions CMS deploy role ARN by environment."
  value       = { for env, role in aws_iam_role.github_actions_cms_deploy : env => role.arn }
}

output "github_actions_terraform_apply_role_arns" {
  description = "GitHub Actions Terraform apply role ARN by environment."
  value       = { for env, role in aws_iam_role.github_actions_terraform_apply : env => role.arn }
}

output "github_actions_terraform_plan_role_arns" {
  description = "GitHub Actions Terraform plan role ARN by environment."
  value       = { for env, role in aws_iam_role.github_actions_terraform_plan : env => role.arn }
}
