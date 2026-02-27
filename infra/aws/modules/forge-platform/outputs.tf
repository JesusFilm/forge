output "ecs_cluster_name" {
  description = "ECS cluster name for this environment."
  value       = aws_ecs_cluster.this.name
}

output "strapi_service_name" {
  description = "ECS service name for the CMS runtime."
  value       = aws_ecs_service.cms.name
}

output "alb_dns_name" {
  description = "Public DNS name of the CMS application load balancer."
  value       = aws_lb.this.dns_name
}

output "cms_assets_bucket_name" {
  description = "S3 bucket name used for CMS assets."
  value       = aws_s3_bucket.assets.bucket
}

output "cloudfront_distribution_domain_name" {
  description = "CloudFront domain name fronting CMS assets."
  value       = aws_cloudfront_distribution.assets.domain_name
}

output "db_instance_endpoint" {
  description = "RDS endpoint hostname for CMS Postgres."
  value       = aws_db_instance.cms.address
}

output "vpc_id" {
  description = "VPC ID containing CMS platform resources."
  value       = aws_vpc.this.id
}

output "private_subnet_ids" {
  description = "Private subnet IDs used by internal CMS resources."
  value       = [for subnet in aws_subnet.private : subnet.id]
}
