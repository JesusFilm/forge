output "ecs_cluster_name" {
  description = "ECS cluster name for this environment."
  value       = module.application.ecs_cluster_name
}

output "strapi_service_name" {
  description = "ECS service name for the CMS runtime."
  value       = module.application.strapi_service_name
}

output "alb_dns_name" {
  description = "Public DNS name of the CMS application load balancer."
  value       = aws_lb.platform.dns_name
}

output "alb_domain_name" {
  description = "Route53 hostname for the CMS ALB endpoint."
  value       = module.application.alb_domain_name
}

output "cms_assets_bucket_name" {
  description = "S3 bucket name used for CMS assets."
  value       = module.assets.cms_assets_bucket_name
}

output "cloudfront_distribution_domain_name" {
  description = "CloudFront domain name fronting CMS assets."
  value       = module.assets.cloudfront_distribution_domain_name
}

output "assets_domain_name" {
  description = "Route53 hostname for the CMS assets CDN endpoint."
  value       = module.assets.assets_domain_name
}

output "db_instance_endpoint" {
  description = "RDS endpoint hostname for CMS Postgres."
  value       = module.application.db_instance_endpoint
}

output "db_master_secret_arn" {
  description = "Secrets Manager ARN for the RDS-managed master user secret."
  value       = module.application.db_master_secret_arn
}

output "vpc_id" {
  description = "VPC ID containing CMS platform resources."
  value       = aws_vpc.platform.id
}

output "private_subnet_ids" {
  description = "Private subnet IDs used by internal CMS resources."
  value       = [for subnet in aws_subnet.private : subnet.id]
}

output "ecr_repository_url" {
  description = "ECR repository URL for CMS container images."
  value       = module.application.ecr_repository_url
}

output "ssm_parameter_prefix" {
  description = "SSM Parameter Store prefix for CMS application secrets."
  value       = module.application.ssm_parameter_prefix
}

output "cms_ssm_kms_key_arn" {
  description = "KMS key ARN used for CMS SecureString SSM parameters."
  value       = module.application.ssm_kms_key_arn
}
