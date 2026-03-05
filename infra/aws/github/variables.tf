variable "aws_region" {
  description = "AWS region."
  type        = string
}

variable "tags" {
  description = "Common tags applied to resources."
  type        = map(string)
  default     = {}
}

variable "environment" {
  description = "Deployment environment name."
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
