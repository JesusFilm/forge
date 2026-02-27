output "ecs_cluster_names" {
  description = "ECS cluster name by environment"
  value       = { for env, module_instance in module.forge_platform : env => module_instance.ecs_cluster_name }
}

output "strapi_service_names" {
  description = "Strapi ECS service name by environment"
  value       = { for env, module_instance in module.forge_platform : env => module_instance.strapi_service_name }
}

output "alb_dns_names" {
  description = "ALB DNS name by environment"
  value       = { for env, module_instance in module.forge_platform : env => module_instance.alb_dns_name }
}

output "cms_assets_bucket_names" {
  description = "S3 cms assets bucket by environment"
  value       = { for env, module_instance in module.forge_platform : env => module_instance.cms_assets_bucket_name }
}

output "cloudfront_distribution_domains" {
  description = "CloudFront distribution domain by environment"
  value       = { for env, module_instance in module.forge_platform : env => module_instance.cloudfront_distribution_domain_name }
}

output "db_instance_endpoints" {
  description = "RDS endpoint by environment"
  value       = { for env, module_instance in module.forge_platform : env => module_instance.db_instance_endpoint }
}

output "db_master_secret_arns" {
  description = "RDS-managed master secret ARN by environment"
  value       = { for env, module_instance in module.forge_platform : env => module_instance.db_master_secret_arn }
}
