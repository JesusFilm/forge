data "aws_caller_identity" "current" {}

# State bucket and lock table created by infra/aws/bootstrap-state; read from AWS (must exist).
data "aws_s3_bucket" "terraform_state" {
  bucket = "forge-terraform-state-${data.aws_caller_identity.current.account_id}"
}

data "aws_dynamodb_table" "terraform_state_lock" {
  name = "forge-terraform-locks"
}

locals {
  create_delegated_zone = var.environment == "prod"
}

resource "aws_route53_zone" "forge" {
  count = local.create_delegated_zone ? 1 : 0
  name  = var.delegated_zone_name
}

data "aws_route53_zone" "forge" {
  count        = local.create_delegated_zone ? 0 : 1
  name         = var.delegated_zone_name
  private_zone = false
}

locals {
  forge_zone_id           = local.create_delegated_zone ? aws_route53_zone.forge[0].zone_id : data.aws_route53_zone.forge[0].zone_id
  forge_zone_name         = local.create_delegated_zone ? aws_route53_zone.forge[0].name : data.aws_route53_zone.forge[0].name
  forge_zone_name_servers = local.create_delegated_zone ? aws_route53_zone.forge[0].name_servers : data.aws_route53_zone.forge[0].name_servers
}

module "github" {
  source = "./github"

  tags                            = var.tags
  aws_region                      = var.aws_region
  environment                     = var.environment
  terraform_state_bucket_name     = data.aws_s3_bucket.terraform_state.bucket
  terraform_state_lock_table_name = data.aws_dynamodb_table.terraform_state_lock.name
  vercel_ssm_kms_key_arn          = module.vercel.ssm_kms_key_arn
}

module "vercel" {
  source = "./vercel"

  tags        = var.tags
  environment = var.environment
}

module "platform" {
  source = "./modules/platform"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  environment                        = var.environment
  aws_region                         = var.aws_region
  tags                               = var.tags
  db_backup_retention_period         = var.db_backup_retention_period
  db_enabled_cloudwatch_logs_exports = var.db_enabled_cloudwatch_logs_exports
  ecs_service_egress_cidr_blocks     = var.ecs_service_egress_cidr_blocks

  route53_zone_id     = local.forge_zone_id
  delegated_zone_name = var.delegated_zone_name
}
