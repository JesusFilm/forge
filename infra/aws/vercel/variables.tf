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
