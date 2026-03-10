variable "tags" {
  description = "Tags applied to dev-secrets IAM users."
  type        = map(string)
  default     = {}
}
