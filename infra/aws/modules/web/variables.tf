variable "environment" {
  description = "Deployment environment name."
  type        = string
}

variable "tags" {
  description = "Common tags applied to all resources."
  type        = map(string)
}

variable "cms_strapi_api_token_param_name" {
  description = "CMS SSM parameter name for STRAPI_INTERNAL_API_TOKEN (deploy)."
  type        = string
}

variable "cms_preview_secret_param_name" {
  description = "CMS SSM parameter name for PREVIEW_SECRET (deploy)."
  type        = string
}

variable "cms_ssm_dev_strapi_api_token_param_name" {
  description = "CMS SSM parameter name for dev STRAPI_INTERNAL_API_TOKEN (empty when not created)."
  type        = string
  default     = ""
}

variable "cms_ssm_dev_preview_secret_param_name" {
  description = "CMS SSM parameter name for dev PREVIEW_SECRET (empty when not created)."
  type        = string
  default     = ""
}
