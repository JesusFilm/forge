variable "aws_region" {
  description = "AWS region for the GitHub Terraform stack."
  type        = string
  default     = "us-east-2"
}

variable "enable_web_deploy" {
  description = "Enable web deploy resources. Set to true after the AWS and Vercel stacks have been applied and the required SSM parameters exist."
  type        = bool
  default     = false
}
