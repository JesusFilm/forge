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
  default     = 30
}

variable "db_preferred_backup_window" {
  description = "Daily UTC window for RDS automated backups (e.g. 09:00-10:00 = late night US ET, night NZ)."
  type        = string
  default     = "09:00-10:00"
}

variable "db_enabled_cloudwatch_logs_exports" {
  description = "PostgreSQL log types exported from RDS to CloudWatch Logs."
  type        = list(string)
  default     = ["postgresql", "upgrade"]
}

variable "ecs_service_egress_cidr_blocks" {
  description = "CIDR ranges allowed for outbound ECS task traffic."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

