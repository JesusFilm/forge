resource "aws_route53_zone" "cms" {
  name = var.delegated_zone_name
}

module "platform" {
  for_each = toset(local.target_environments)

  source = "./modules/platform"

  environment = each.value
  aws_region  = var.aws_region
  tags        = var.tags

  route53_zone_id    = aws_route53_zone.cms.zone_id
  alb_domain_name    = local.app_domains[each.value]
  assets_domain_name = local.assets_domains[each.value]
}
