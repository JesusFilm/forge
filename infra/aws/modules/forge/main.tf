module "cms" {
  source = "../cms"

  environment = var.environment
  aws_region  = var.aws_region
  tags        = var.tags

  cms_container_image              = var.cms_container_image
  cms_container_port               = var.cms_container_port
  cms_desired_count                = var.cms_desired_count
  cms_cpu                          = var.cms_cpu
  cms_memory                       = var.cms_memory
  cms_environment_variables        = var.cms_environment_variables
  db_name                          = var.db_name
  db_username                      = var.db_username
  db_instance_class                = var.db_instance_class
  db_allocated_storage             = var.db_allocated_storage
  db_engine_version                = var.db_engine_version
  db_multi_az                      = var.db_multi_az
  waf_rate_limit                   = var.waf_rate_limit
  assets_bucket_name_override      = var.assets_bucket_name_override
  route53_zone_id                  = var.route53_zone_id
  db_master_user_secret_kms_key_id = var.db_master_user_secret_kms_key_id
  alb_domain_name                  = var.alb_domain_name
  assets_domain_name               = var.assets_domain_name
}
