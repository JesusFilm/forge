variable "tags" {
  description = "Tags applied to the group."
  type        = map(string)
  default     = {}
}

variable "mfa_policy_arn" {
  description = "ARN of the forge-require-mfa policy to attach so MFA is required after first sign-in."
  type        = string
}
