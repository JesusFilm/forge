data "aws_caller_identity" "current" {}

# State bucket and lock table created by infra/aws/bootstrap-state; read from AWS (must exist).
data "aws_s3_bucket" "terraform_state" {
  bucket = "forge-terraform-state-${data.aws_caller_identity.current.account_id}"
}

data "aws_dynamodb_table" "terraform_state_lock" {
  name = "forge-terraform-locks"
}

locals {
  target_environments = toset(var.environment == null ? var.environments : [var.environment])
}

resource "aws_route53_zone" "forge" {
  name = var.delegated_zone_name
}

module "github" {
  source = "./github"

  aws_region                      = var.aws_region
  tags                            = var.tags
  target_environments             = local.target_environments
  terraform_state_bucket_name     = data.aws_s3_bucket.terraform_state.bucket
  terraform_state_lock_table_name = data.aws_dynamodb_table.terraform_state_lock.name
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
