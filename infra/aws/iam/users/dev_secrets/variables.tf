variable "tags" {
  description = "Tags applied to dev-secrets IAM users."
  type        = map(string)
  default     = {}
}

variable "group_name" {
  description = "IAM group name to attach dev-secrets users to."
  type        = string
}
