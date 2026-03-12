locals {
  name_prefix               = "forge-web-${var.environment}"
  dev_ssm_parameter_prefix  = "/forge/aws/web/dev"
  create_dev_ssm_parameters = var.environment == "stage"
  tags = merge(var.tags, {
    Environment = var.environment
    ManagedBy   = "terraform"
    Service     = "web"
  })
}
