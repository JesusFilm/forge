variable "environment" {
  description = "Deployment environment name."
  type        = string
}

variable "aws_region" {
  description = "Primary AWS region for CMS resources."
  type        = string
}

variable "tags" {
  description = "Common tags applied to all resources."
  type        = map(string)
}

variable "db_name" {
  description = "Database name for the CMS Postgres instance."
  type        = string
}

variable "db_username" {
  description = "Master username for the CMS Postgres instance."
  type        = string
}

variable "db_instance_class" {
  description = "RDS instance class for CMS Postgres."
  type        = string
}

variable "db_allocated_storage" {
  description = "Allocated storage size (GiB) for CMS Postgres."
  type        = number
}

variable "db_engine_version" {
  description = "Postgres engine version."
  type        = string
}

variable "db_multi_az" {
  description = "Enable Multi-AZ deployment for the RDS instance."
  type        = bool
}

variable "db_backup_retention_period" {
  description = "Number of days to retain automated RDS backups."
  type        = number
}

variable "db_enabled_cloudwatch_logs_exports" {
  description = "PostgreSQL log types exported from RDS to CloudWatch Logs."
  type        = list(string)
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID where cert validation and DNS aliases are created."
  type        = string
}

variable "db_master_user_secret_kms_key_id" {
  description = "Optional KMS key ID/ARN used for the RDS managed master-user secret."
  type        = string
  default     = null
}

variable "ssm_secret_version" {
  description = "Version used to rotate Terraform-managed CMS SSM secrets when incremented."
  type        = number
  default     = 1
}

variable "alb_domain_name" {
  description = "Public DNS name for the environment ALB entrypoint."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where CMS infrastructure is deployed."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs used for ECS tasks and database resources."
  type        = list(string)
}

variable "alb_https_listener_arn" {
  description = "ARN of the shared HTTPS ALB listener used for host-based routing."
  type        = string
}

variable "alb_security_group_id" {
  description = "Security group ID attached to the platform-managed ALB."
  type        = string
}

variable "alb_dns_name" {
  description = "DNS name of the platform-managed ALB."
  type        = string
}

variable "alb_zone_id" {
  description = "Hosted zone ID of the platform-managed ALB."
  type        = string
}

variable "ecs_service_security_group_id" {
  description = "Security group ID attached to CMS ECS tasks."
  type        = string
}

variable "rds_security_group_id" {
  description = "Security group ID attached to the CMS RDS instance."
  type        = string
}

variable "assets_bucket_name" {
  description = "S3 bucket name used for CMS media uploads."
  type        = string
}

variable "assets_bucket_arn" {
  description = "ARN of the S3 bucket used for CMS media uploads."
  type        = string
}

variable "assets_cdn_url" {
  description = "HTTPS base URL for the assets CDN (Strapi upload provider baseUrl)."
  type        = string
}

variable "assets_cdn_root_path" {
  description = "S3 key prefix and CDN path for CMS uploads (e.g. cms)."
  type        = string
  default     = "cms"
}

variable "assets_kms_key_id" {
  description = "KMS key ID for assets bucket encryption (Strapi providerConfig.encryption.kmsKeyId)."
  type        = string
}

variable "assets_kms_key_arn" {
  description = "KMS key ARN for IAM policy (ECS task role encrypt/decrypt)."
  type        = string
}

variable "ecs_desired_count" {
  description = "Desired number of ECS tasks for the CMS service (initial value; scaler owns it in prod)."
  type        = number
  default     = 0
}

variable "create_ses_identity" {
  description = "Whether to create SES domain identity and DNS records (true in prod, false in stage)."
  type        = bool
  default     = false
}

variable "delegated_zone_name" {
  description = "Domain name for SES identity (e.g. forge.jesusfilm.org)."
  type        = string
}

variable "email_default_from" {
  description = "Default sender email address for CMS emails."
  type        = string
  default     = ""
}

variable "email_default_reply_to" {
  description = "Default reply-to email address for CMS emails."
  type        = string
  default     = ""
}
