output "ecs_cluster_names" {
  description = "ECS cluster name by environment"
  value       = { for env, module_instance in module.platform : env => module_instance.ecs_cluster_name }
}

output "strapi_service_names" {
  description = "Strapi ECS service name by environment"
  value       = { for env, module_instance in module.platform : env => module_instance.strapi_service_name }
}

output "alb_dns_names" {
  description = "ALB DNS name by environment"
  value       = { for env, module_instance in module.platform : env => module_instance.alb_dns_name }
}

output "alb_domain_names" {
  description = "ALB Route53 hostname by environment"
  value       = { for env, module_instance in module.platform : env => module_instance.alb_domain_name }
}

output "cms_assets_bucket_names" {
  description = "S3 cms assets bucket by environment"
  value       = { for env, module_instance in module.platform : env => module_instance.cms_assets_bucket_name }
}

output "cloudfront_distribution_domains" {
  description = "CloudFront distribution domain by environment"
  value       = { for env, module_instance in module.platform : env => module_instance.cloudfront_distribution_domain_name }
}

output "assets_domain_names" {
  description = "Assets CDN Route53 hostname by environment"
  value       = { for env, module_instance in module.platform : env => module_instance.assets_domain_name }
}

output "db_instance_endpoints" {
  description = "RDS endpoint by environment"
  value       = { for env, module_instance in module.platform : env => module_instance.db_instance_endpoint }
}

output "db_master_secret_arns" {
  description = "RDS-managed master secret ARN by environment"
  value       = { for env, module_instance in module.platform : env => module_instance.db_master_secret_arn }
}

output "forge_delegated_zone_name" {
  description = "Delegated Route53 hosted zone name for this infrastructure."
  value       = aws_route53_zone.forge.name
}

output "forge_delegated_zone_name_servers" {
  description = "Route53 nameservers to configure on parent DNS provider for delegation."
  value       = aws_route53_zone.forge.name_servers
}

output "github_actions_cms_deploy_role_arns" {
  description = "GitHub Actions CMS deploy role ARN by environment."
  value       = module.github.github_actions_cms_deploy_role_arns
}

output "github_actions_terraform_apply_role_arns" {
  description = "GitHub Actions Terraform apply role ARN by environment."
  value       = module.github.github_actions_terraform_apply_role_arns
}

output "github_actions_terraform_plan_role_arns" {
  description = "GitHub Actions Terraform plan role ARN by environment."
  value       = module.github.github_actions_terraform_plan_role_arns
}
