output "ecs_cluster_name" {
  description = "ECS cluster name for this environment."
  value       = module.platform.ecs_cluster_name
}

output "alb_domain_name" {
  description = "Route53 hostname for the CMS ALB endpoint."
  value       = module.platform.alb_domain_name
}

output "cms_assets_bucket_name" {
  description = "S3 bucket name used for CMS assets."
  value       = module.platform.cms_assets_bucket_name
}

output "cloudfront_distribution_domain_name" {
  description = "CloudFront domain name fronting CMS assets."
  value       = module.platform.cloudfront_distribution_domain_name
}

output "assets_domain_name" {
  description = "Route53 hostname for the CMS assets CDN endpoint."
  value       = module.platform.assets_domain_name
}

output "db_instance_endpoint" {
  description = "RDS endpoint hostname for CMS Postgres."
  value       = module.platform.db_instance_endpoint
}

output "db_master_secret_arn" {
  description = "Secrets Manager ARN for the RDS-managed master user secret."
  value       = module.platform.db_master_secret_arn
}

output "forge_delegated_zone_name" {
  description = "Delegated Route53 hosted zone name for this infrastructure."
  value       = local.forge_zone_name
}

output "forge_delegated_zone_name_servers" {
  description = "Route53 nameservers to configure on parent DNS provider for delegation."
  value       = local.forge_zone_name_servers
}

output "github_actions_cms_deploy_role_arn" {
  description = "GitHub Actions role for CMS deploy."
  value       = module.github.github_actions_cms_deploy_role_arn
}

output "github_actions_terraform_apply_role_arn" {
  description = "GitHub Actions role for Terraform apply."
  value       = module.github.github_actions_terraform_apply_role_arn
}

output "github_actions_terraform_plan_role_arn" {
  description = "GitHub Actions role for Terraform plan."
  value       = module.github.github_actions_terraform_plan_role_arn
}

output "github_actions_terraform_vercel_role_arn" {
  description = "GitHub Actions role for infra/vercel plan/apply with state and scoped SSM access."
  value       = module.github.github_actions_terraform_vercel_role_arn
}

output "github_actions_terraform_github_role_arn" {
  description = "GitHub Actions role for infra/github plan/apply with state and scoped SSM access."
  value       = module.github.github_actions_terraform_github_role_arn
}
