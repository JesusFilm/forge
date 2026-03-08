variable "environment" {
  description = "Deployment environment name."
  type        = string
}

variable "aws_region" {
  description = "Primary AWS region for platform resources."
  type        = string
}

variable "tags" {
  description = "Common tags applied to all resources."
  type        = map(string)
  default     = {}
}

variable "db_instance_class" {
  description = "RDS instance class for the shared platform database."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_multi_az" {
  description = "Enable Multi-AZ for the shared platform database."
  type        = bool
  default     = false
}

variable "waf_rate_limit" {
  description = "Per-IP request rate limit used by ALB WAF."
  type        = number
  default     = 2000
}

variable "assets_bucket_name_override" {
  description = "Optional explicit S3 bucket name override for CMS assets."
  type        = string
  default     = null
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID where cert validation and DNS aliases are created."
  type        = string
}

variable "delegated_zone_name" {
  description = "Delegated DNS zone name used to derive app and assets hostnames."
  type        = string
}

variable "cms_ssm_secret_version" {
  description = "Version used to rotate Terraform-managed CMS SSM secrets when incremented."
  type        = number
  default     = 1
}

variable "ecs_service_egress_cidr_blocks" {
  description = "CIDR ranges allowed for outbound ECS task traffic."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "cms_ecs_desired_count" {
  description = "Desired number of ECS tasks for the CMS service (initial value; scaler owns it in prod)."
  type        = number
  default     = 1
}

