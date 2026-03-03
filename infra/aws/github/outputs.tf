output "github_actions_cms_deploy_role_arns" {
  description = "GitHub Actions CMS deploy role ARN by environment."
  value       = { for env, role in aws_iam_role.github_actions_cms_deploy : env => role.arn }
}
