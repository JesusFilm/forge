resource "aws_route53_zone" "forge" {
  name = var.delegated_zone_name
}

locals {
  target_environments = toset(var.environment == null ? var.environments : [var.environment])
}

module "github" {
  source = "./github"

  aws_region          = var.aws_region
  tags                = var.tags
  target_environments = local.target_environments
}

module "platform" {
  for_each = local.target_environments

  source = "./modules/platform"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  environment                        = each.value
  aws_region                         = var.aws_region
  tags                               = var.tags
  db_backup_retention_period         = var.db_backup_retention_period
  db_enabled_cloudwatch_logs_exports = var.db_enabled_cloudwatch_logs_exports
  ecs_service_egress_cidr_blocks     = var.ecs_service_egress_cidr_blocks

  route53_zone_id     = aws_route53_zone.forge.zone_id
  delegated_zone_name = var.delegated_zone_name
}
