variable "name_prefix" {
  description = "Name prefix for all database resources (e.g. forge-platform-stage)."
  type        = string
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
}

variable "tags" {
  description = "Common tags applied to all resources."
  type        = map(string)
  default     = {}
}

variable "db_name" {
  description = "Initial database created on the instance."
  type        = string
}

variable "username" {
  description = "Master username for the instance."
  type        = string
  sensitive   = true
}

variable "subnet_ids" {
  description = "Private subnet IDs for the DB subnet group."
  type        = list(string)
}

variable "vpc_security_group_ids" {
  description = "Security group IDs attached to the RDS instance."
  type        = list(string)
}

variable "instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Allocated storage size (GiB)."
  type        = number
  default     = 20
}

variable "engine_version" {
  description = "Postgres engine version."
  type        = string
  default     = "16.8"
}

variable "multi_az" {
  description = "Enable Multi-AZ deployment."
  type        = bool
  default     = false
}

variable "backup_retention_period" {
  description = "Number of days to retain automated backups."
  type        = number
  default     = 30
}

variable "cloudwatch_logs_exports" {
  description = "PostgreSQL log types exported to CloudWatch Logs."
  type        = list(string)
  default     = ["postgresql", "upgrade"]
}

variable "master_user_secret_kms_key_id" {
  description = "Optional KMS key ID/ARN for the RDS-managed master user secret."
  type        = string
  default     = null
}
