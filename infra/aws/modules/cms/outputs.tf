output "ecs_cluster_name" {
  description = "ECS cluster name for this environment."
  value       = aws_ecs_cluster.cms.name
}

output "strapi_service_name" {
  description = "ECS service name for the CMS runtime."
  value       = aws_ecs_service.cms.name
}

output "alb_dns_name" {
  description = "Public DNS name of the CMS application load balancer."
  value       = var.alb_dns_name
}

output "alb_domain_name" {
  description = "Route53 hostname for the CMS ALB endpoint."
  value       = var.alb_domain_name
}

output "db_instance_endpoint" {
  description = "RDS endpoint hostname for CMS Postgres."
  value       = aws_db_instance.cms.address
  sensitive   = true
}

output "db_master_secret_arn" {
  description = "Secrets Manager ARN for the RDS-managed master user secret."
  value       = aws_db_instance.cms.master_user_secret[0].secret_arn
  sensitive   = true
}

output "vpc_id" {
  description = "VPC ID containing CMS platform resources."
  value       = var.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs used by internal CMS resources."
  value       = var.private_subnet_ids
}

output "alb_certificate_arn" {
  description = "Validated ACM certificate ARN for the CMS ALB hostname."
  value       = aws_acm_certificate_validation.alb.certificate_arn
}

output "ecr_repository_url" {
  description = "ECR repository URL for CMS container images."
  value       = aws_ecr_repository.cms.repository_url
}

output "ssm_parameter_prefix" {
  description = "SSM Parameter Store prefix for CMS application secrets."
  value       = "${local.ssm_parameter_prefix}/"
}

output "ssm_kms_key_arn" {
  description = "KMS key ARN used for CMS SecureString SSM parameters."
  value       = aws_kms_key.cms_ssm.arn
  sensitive   = true
}

output "strapi_internal_api_token_param_name" {
  description = "SSM parameter name for the deploy STRAPI_INTERNAL_API_TOKEN."
  value       = aws_ssm_parameter.strapi_internal_api_token.name
}

output "preview_secret_param_name" {
  description = "SSM parameter name for the deploy PREVIEW_SECRET."
  value       = aws_ssm_parameter.preview_secret.name
}

output "ssm_dev_strapi_internal_api_token_param_name" {
  description = "SSM parameter name for the dev STRAPI_INTERNAL_API_TOKEN (empty when dev params are not created)."
  value       = local.create_ssm_dev_parameters ? aws_ssm_parameter.dev_strapi_internal_api_token[0].name : ""
}

output "ssm_dev_preview_secret_param_name" {
  description = "SSM parameter name for the dev PREVIEW_SECRET (empty when dev params are not created)."
  value       = local.create_ssm_dev_parameters ? aws_ssm_parameter.dev_preview_secret[0].name : ""
}
