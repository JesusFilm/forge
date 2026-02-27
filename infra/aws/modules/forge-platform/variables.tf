variable "environment" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "cms_container_image" {
  type    = string
  default = "public.ecr.aws/docker/library/nginx:stable"
}

variable "cms_container_port" {
  type    = number
  default = 1337
}

variable "cms_desired_count" {
  type    = number
  default = 1
}

variable "cms_cpu" {
  type    = number
  default = 512
}

variable "cms_memory" {
  type    = number
  default = 1024
}

variable "cms_environment_variables" {
  type    = map(string)
  default = {}
}

variable "db_name" {
  type    = string
  default = "cms"
}

variable "db_username" {
  type    = string
  default = "cms"
}

variable "db_password" {
  type      = string
  sensitive = true
  default   = "replace-me"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "db_engine_version" {
  type    = string
  default = "16.4"
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "waf_rate_limit" {
  type    = number
  default = 2000
}

variable "assets_bucket_name_override" {
  type    = string
  default = null
}
