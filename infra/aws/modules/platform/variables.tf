variable "environment" {
  description = "Deployment environment name."
  type        = string
}

variable "aws_region" {
  description = "AWS region for resource deployment."
  type        = string
}

variable "tags" {
  description = "Common tags applied to all resources."
  type        = map(string)
  default     = {}
}

variable "db_name" {
  description = "Database name for the CMS Postgres instance."
  type        = string
  default     = "cms"
}

variable "db_username" {
  description = "Master username for the CMS Postgres instance."
  type        = string
  default     = "cms"
}

variable "db_instance_class" {
  description = "RDS instance class for CMS Postgres."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage size (GiB) for CMS Postgres."
  type        = number
  default     = 20
}

variable "db_engine_version" {
  description = "Postgres engine version."
  type        = string
  default     = "16.8"
}

variable "db_multi_az" {
  description = "Enable Multi-AZ deployment for the RDS instance."
  type        = bool
  default     = false
}

variable "db_backup_retention_period" {
  description = "Number of days to retain automated RDS backups."
  type        = number
  default     = 7
}

variable "db_enabled_cloudwatch_logs_exports" {
  description = "PostgreSQL log types exported from RDS to CloudWatch Logs."
  type        = list(string)
  default     = ["postgresql", "upgrade"]
}

variable "waf_rate_limit" {
  description = "Per-IP request rate limit used by ALB WAF."
  type        = number
  default     = 2000
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

variable "delegated_zone_name" {
  description = "Delegated DNS zone name used to derive app and assets hostnames."
  type        = string
}

variable "db_master_user_secret_kms_key_id" {
  description = "Optional KMS key ID/ARN used for the RDS managed master-user secret."
  type        = string
  default     = null
}

variable "ecs_service_egress_cidr_blocks" {
  description = "CIDR ranges allowed for outbound ECS task traffic."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

