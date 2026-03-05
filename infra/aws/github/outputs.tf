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

output "github_actions_terraform_vercel_plan_role_arn" {
  description = "GitHub Actions role for infra/vercel plan with state read and scoped SSM access."
  value       = local.terraform_vercel_plan_role_arn
}

output "github_actions_terraform_vercel_apply_role_arn" {
  description = "GitHub Actions role for infra/vercel apply with state write and scoped SSM access."
  value       = local.terraform_vercel_apply_role_arn
}

output "github_actions_terraform_github_plan_role_arn" {
  description = "GitHub Actions role for infra/github plan with state read and scoped SSM access."
  value       = local.terraform_github_plan_role_arn
}

output "github_actions_terraform_github_apply_role_arn" {
  description = "GitHub Actions role for infra/github apply with state write and scoped SSM access."
  value       = local.terraform_github_apply_role_arn
}
