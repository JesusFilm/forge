variable "project_name" {
  description = "Project prefix used for generated resource names."
  type        = string
  default     = "forge"
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
}
