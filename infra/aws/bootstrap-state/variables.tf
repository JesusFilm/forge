variable "project_name" {
  description = "Project prefix used for generated resource names."
  type        = string
  default     = "forge"
}

variable "aws_region" {
  description = "Primary AWS region for bootstrap-state resources."
  type        = string
  default     = "us-east-2"
}

variable "state_bucket_name" {
  description = "Optional explicit S3 bucket name for Terraform state."
  type        = string
  default     = null
}

variable "lock_table_name" {
  description = "Optional explicit DynamoDB table name for Terraform state locks."
  type        = string
  default     = null
}

variable "tags" {
  description = "Common tags applied to all bootstrap resources."
  type        = map(string)
  default     = {}
}

variable "ci_state_access" {
  description = "CI IAM roles and the exact Terraform state key each role may access."
  type = list(object({
    role_arn  = string
    state_key = string
  }))
  default = []

  validation {
    condition = alltrue([
      for access in var.ci_state_access :
      trimspace(access.role_arn) != "" &&
      trimspace(access.state_key) != "" &&
      can(regex("^arn:aws:iam::[0-9]{12}:role/.+$", access.role_arn)) &&
      !startswith(access.state_key, "/")
    ])
    error_message = "Each ci_state_access item must include a non-empty role_arn and state_key; role_arn must be a valid IAM role ARN, and state_key must be relative (no leading '/')."
  }
}
