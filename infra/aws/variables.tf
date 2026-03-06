variable "environment" {
  description = "Deployment environment name."
  type        = string
  validation {
    condition     = contains(["stage", "prod"], var.environment)
    error_message = "environment must be one of: stage or prod."
  }
}

variable "tags" {
  description = "Common tags applied to all resources"
  type        = map(string)
  default     = {}
}

variable "aws_region" {
  description = "Primary AWS region for the infrastructure."
  type        = string
  default     = "us-east-2"
}

variable "delegated_zone_name" {
  description = "Delegated Route53 root zone used by this infrastructure."
  type        = string
  default     = "forge.jesusfilm.org"
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

variable "ssm_parameter_kms_key_id" {
  description = "Optional KMS key ID/ARN used for CMS SSM SecureString parameters."
  type        = string
  default     = null
}

variable "ecs_service_egress_cidr_blocks" {
  description = "CIDR ranges allowed for outbound ECS task traffic."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

