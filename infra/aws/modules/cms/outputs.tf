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
}

output "db_master_secret_arn" {
  description = "Secrets Manager ARN for the RDS-managed master user secret."
  value       = aws_db_instance.cms.master_user_secret[0].secret_arn
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
