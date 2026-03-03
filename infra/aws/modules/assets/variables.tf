variable "environment" {
  description = "Deployment environment name."
  type        = string
}

variable "tags" {
  description = "Common tags applied to all resources."
  type        = map(string)
  default     = {}
}

variable "assets_bucket_name_override" {
  description = "Optional explicit S3 bucket name override for CMS assets."
  type        = string
  default     = null
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID where cert validation and DNS aliases are created."
  type        = string
}

variable "assets_domain_name" {
  description = "Public DNS name for the environment assets CDN entrypoint."
  type        = string
}
