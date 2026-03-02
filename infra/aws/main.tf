resource "aws_route53_zone" "forge" {
  name = var.delegated_zone_name
}

module "platform" {
  for_each = var.environment == null ? toset(var.environments) : toset([var.environment])

  source = "./modules/platform"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  environment = each.value
  aws_region  = var.aws_region
  tags        = var.tags

  route53_zone_id     = aws_route53_zone.forge.zone_id
  delegated_zone_name = var.delegated_zone_name
}
