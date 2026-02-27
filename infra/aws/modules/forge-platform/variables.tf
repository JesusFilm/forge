variable "environment" {
  description = "Deployment environment name."
  type        = string
}

variable "aws_region" {
  description = "AWS region for resource deployment."
  type        = string
}

variable "tags" {
  description = "Common tags applied to all resources."
  type        = map(string)
  default     = {}
}

variable "cms_container_image" {
  description = "Container image URI for the CMS service."
  type        = string
  default     = "public.ecr.aws/docker/library/nginx:stable"
}

variable "cms_container_port" {
  description = "Container port exposed by the CMS task."
  type        = number
  default     = 1337
}

variable "cms_desired_count" {
  description = "Desired task count for the CMS ECS service."
  type        = number
  default     = 1
}

variable "cms_cpu" {
  description = "CPU units for the CMS Fargate task."
  type        = number
  default     = 512
}

variable "cms_memory" {
  description = "Memory (MiB) for the CMS Fargate task."
  type        = number
  default     = 1024
}

variable "cms_environment_variables" {
  description = "Environment variables injected into the CMS container."
  type        = map(string)
  default     = {}
}

variable "db_name" {
  description = "Database name for the CMS Postgres instance."
  type        = string
  default     = "cms"
}

variable "db_username" {
  description = "Master username for the CMS Postgres instance."
  type        = string
  default     = "cms"
}

variable "db_password" {
  description = "Master password for the CMS Postgres instance."
  type        = string
  sensitive   = true
}

variable "db_instance_class" {
  description = "RDS instance class for CMS Postgres."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage size (GiB) for CMS Postgres."
  type        = number
  default     = 20
}

variable "db_engine_version" {
  description = "Postgres engine version."
  type        = string
  default     = "16.4"
}

variable "db_multi_az" {
  description = "Enable Multi-AZ deployment for the RDS instance."
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

variable "alb_acm_certificate_arn" {
  description = "Optional ACM certificate ARN for enabling HTTPS on the ALB."
  type        = string
  default     = null
}
