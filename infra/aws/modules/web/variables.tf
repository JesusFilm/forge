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

variable "cms_domain_name" {
  description = "Public DNS hostname of the CMS (e.g. cms.stage.forge.jesusfilm.org)."
  type        = string
}
