output "ecs_cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "strapi_service_name" {
  value = aws_ecs_service.cms.name
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "cms_assets_bucket_name" {
  value = aws_s3_bucket.assets.bucket
}

output "cloudfront_distribution_domain_name" {
  value = aws_cloudfront_distribution.assets.domain_name
}

output "db_instance_endpoint" {
  value = aws_db_instance.cms.address
}

output "vpc_id" {
  value = aws_vpc.this.id
}

output "private_subnet_ids" {
  value = [for subnet in aws_subnet.private : subnet.id]
}
