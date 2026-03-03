variable "aws_region" {
  description = "AWS region."
  type        = string
}

variable "tags" {
  description = "Common tags applied to resources."
  type        = map(string)
  default     = {}
}

variable "target_environments" {
  description = "Environments to provision GitHub deploy roles for."
  type        = set(string)
}
