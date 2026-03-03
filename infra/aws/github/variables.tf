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

variable "github_actions_deploy_branches" {
  description = "Environment to branch mapping for GitHub Actions OIDC deploy roles."
  type        = map(string)
}
