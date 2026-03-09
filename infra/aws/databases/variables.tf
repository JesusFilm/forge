variable "environment" {
  description = "Deployment environment name."
  type        = string
  validation {
    condition     = contains(["stage", "prod"], var.environment)
    error_message = "environment must be one of: stage or prod."
  }
}

variable "aws_region" {
  description = "Primary AWS region."
  type        = string
  default     = "us-east-2"
}

variable "pg_host" {
  description = "RDS endpoint hostname (injected by CodeBuild)."
  type        = string
}

variable "pg_admin_username" {
  description = "RDS master username."
  type        = string
  default     = "cms"
  sensitive   = true
}

variable "pg_admin_password" {
  description = "RDS master password (fetched from Secrets Manager by CodeBuild)."
  type        = string
  sensitive   = true
}

variable "ssm_kms_key_arn" {
  description = "KMS key ARN for SecureString SSM parameters."
  type        = string
}

variable "tags" {
  description = "Common tags applied to all resources."
  type        = map(string)
  default     = {}
}

variable "application_databases" {
  description = "Map of application databases to create inside the shared RDS instance."
  type = map(object({
    db_name  = string
    username = string
    password = string
  }))
  default = {}
}
