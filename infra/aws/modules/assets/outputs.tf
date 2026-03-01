output "cms_assets_bucket_name" {
  description = "S3 bucket name used for CMS assets."
  value       = aws_s3_bucket.assets.bucket
}

output "cloudfront_distribution_domain_name" {
  description = "CloudFront domain name fronting CMS assets."
  value       = aws_cloudfront_distribution.assets.domain_name
}

output "assets_domain_name" {
  description = "Route53 hostname for the CMS assets CDN endpoint."
  value       = var.assets_domain_name
}
