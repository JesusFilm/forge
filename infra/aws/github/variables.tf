variable "tags" {
  description = "Common tags applied to resources."
  type        = map(string)
  default     = {}
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  validation {
    condition     = contains(["stage", "prod"], var.environment)
    error_message = "environment must be one of: stage or prod."
  }
}

variable "aws_region" {
  description = "Primary AWS region for GitHub-managed infrastructure."
  type        = string
}

variable "terraform_state_bucket_name" {
  description = "S3 bucket name for Terraform state (from bootstrap state output)."
  type        = string
}

variable "terraform_state_lock_table_name" {
  description = "DynamoDB table name for state locking (from bootstrap state output)."
  type        = string
}

variable "vercel_ssm_kms_key_arn" {
  description = "KMS key ARN for Vercel SecureString SSM parameters."
  type        = string
  default     = null
}

variable "cms_ssm_kms_key_arn" {
  description = "KMS key ARN used for CMS SecureString SSM parameters in this environment."
  type        = string
}
