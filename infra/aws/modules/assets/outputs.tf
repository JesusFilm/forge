output "cms_assets_bucket_name" {
  description = "S3 bucket name used for CMS assets."
  value       = aws_s3_bucket.assets.bucket
}

output "cdn_url" {
  description = "HTTPS base URL for the assets CDN (for Strapi upload provider baseUrl)."
  value       = "https://${var.assets_domain_name}"
}

output "cloudfront_distribution_domain_name" {
  description = "CloudFront domain name fronting CMS assets."
  value       = aws_cloudfront_distribution.assets.domain_name
}

output "assets_domain_name" {
  description = "Route53 hostname for the CMS assets CDN endpoint."
  value       = var.assets_domain_name
}

output "cms_assets_bucket_arn" {
  description = "ARN of the S3 bucket used for CMS assets."
  value       = aws_s3_bucket.assets.arn
}

output "assets_kms_key_arn" {
  description = "ARN of the KMS key used for assets bucket encryption."
  value       = aws_kms_key.assets.arn
}

output "assets_kms_key_id" {
  description = "ID of the KMS key (for Strapi providerConfig.encryption.kmsKeyId)."
  value       = aws_kms_key.assets.key_id
}
