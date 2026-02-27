resource "aws_route53_record" "alb_alias" {
  zone_id = var.route53_zone_id
  name    = var.alb_domain_name
  type    = "A"

  alias {
    name                   = aws_lb.cms.dns_name
    zone_id                = aws_lb.cms.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "assets_alias" {
  zone_id = var.route53_zone_id
  name    = var.assets_domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.assets.domain_name
    zone_id                = aws_cloudfront_distribution.assets.hosted_zone_id
    evaluate_target_health = false
  }
}
