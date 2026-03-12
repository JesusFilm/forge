variable "environment" {
  description = "Deployment environment name."
  type        = string
}

variable "tags" {
  description = "Common tags applied to all resources."
  type        = map(string)
}

variable "ssm_kms_key_arn" {
  description = "KMS key ARN used to encrypt SecureString SSM parameters."
  type        = string
}

variable "cms_alb_domain_name" {
  description = "CMS ALB domain name used to derive the GraphQL endpoint for dev."
  type        = string
}
