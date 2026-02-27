variable "environment" {
  description = "Optional single deployment environment override"
  type        = string
  default     = null
}

variable "environments" {
  description = "Default deployment environments"
  type        = list(string)
  default     = ["stage", "prod"]
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "tags" {
  description = "Common tags applied to all resources"
  type        = map(string)
  default     = {}
}

variable "delegated_zone_name" {
  description = "Delegated Route53 zone used for CMS DNS records."
  type        = string
  default     = "cms.jesusfilm.org"
}
