locals {
  name_prefix               = "forge-web-${var.environment}"
  ssm_parameter_prefix      = "/forge/aws/web/${var.environment}"
  ssm_dev_parameter_prefix  = "/forge/aws/web/dev"
  cms_ssm_parameter_prefix  = "/forge/aws/cms/${var.environment}"
  cms_ssm_dev_prefix        = "/forge/aws/cms/dev"
  create_ssm_dev_parameters = var.environment == "stage"
  tags = merge(var.tags, {
    Environment = var.environment
    ManagedBy   = "terraform"
    Service     = "web"
  })
}
