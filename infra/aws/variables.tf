variable "environment" {
  description = "Optional single deployment environment override"
  type        = string
  default     = null
}

variable "environments" {
  description = "Default deployment environments"
  type        = list(string)
  default     = ["stage", "prod"]
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "tags" {
  description = "Common tags applied to all resources"
  type        = map(string)
  default     = {}
}

variable "db_password" {
  description = "Master password for CMS Postgres."
  type        = string
  sensitive   = true
}

variable "alb_acm_certificate_arn" {
  description = "Optional ACM certificate ARN for HTTPS ALB listener."
  type        = string
  default     = null
}
