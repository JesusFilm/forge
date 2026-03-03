output "github_actions_cms_deploy_role_arns" {
  description = "GitHub Actions CMS deploy role ARN by environment."
  value       = { for env, role in aws_iam_role.github_actions_cms_deploy : env => role.arn }
}

output "github_actions_cms_deploy_role_arn_stage" {
  description = "GitHub Actions CMS deploy role ARN for stage branch deploys."
  value       = try(aws_iam_role.github_actions_cms_deploy["stage"].arn, null)
}

output "github_actions_cms_deploy_role_arn_prod" {
  description = "GitHub Actions CMS deploy role ARN for main branch deploys."
  value       = try(aws_iam_role.github_actions_cms_deploy["prod"].arn, null)
}
