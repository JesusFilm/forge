variable "aws_region" {
  description = "AWS region for Terraform remote state resources."
  type        = string
  default     = "us-east-2"
}

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

variable "ci_role_arns" {
  description = "CI IAM role ARNs that must be denied state backend mutations."
  type        = list(string)
  default     = []
}
