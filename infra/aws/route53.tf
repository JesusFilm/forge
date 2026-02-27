resource "aws_route53_zone" "cms" {
  name = var.delegated_zone_name
}
