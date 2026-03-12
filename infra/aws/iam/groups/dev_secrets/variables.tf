variable "mfa_policy_arn" {
  description = "ARN of the MFA requirement policy."
  type        = string
}

variable "tags" {
  description = "Tags applied to IAM group and policies."
  type        = map(string)
  default     = {}
}
