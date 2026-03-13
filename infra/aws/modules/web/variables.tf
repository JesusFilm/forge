variable "environment" {
  description = "Deployment environment name."
  type        = string
}

variable "tags" {
  description = "Common tags applied to all resources."
  type        = map(string)
}

variable "ssm_secret_version" {
  description = "Version used to rotate Terraform-managed web SSM secrets when incremented."
  type        = number
  default     = 1
}
