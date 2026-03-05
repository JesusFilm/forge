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

output "github_actions_terraform_vercel_role_arn" {
  description = "GitHub Actions role for infra/vercel plan/apply with state and scoped SSM access."
  value       = local.terraform_vercel_role_arn
}

output "github_actions_terraform_github_role_arn" {
  description = "GitHub Actions role for infra/github plan/apply with state and scoped SSM access."
  value       = local.terraform_github_role_arn
}
