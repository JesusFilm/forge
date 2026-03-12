locals {
  create_ses_identity = var.environment == "prod"
}

resource "aws_ses_domain_identity" "forge" {
  count  = local.create_ses_identity ? 1 : 0
  domain = var.delegated_zone_name
}

resource "aws_route53_record" "ses_verification" {
  count   = local.create_ses_identity ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "_amazonses.${var.delegated_zone_name}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.forge[0].verification_token]
}

resource "aws_ses_domain_identity_verification" "forge" {
  count  = local.create_ses_identity ? 1 : 0
  domain = aws_ses_domain_identity.forge[0].id

  depends_on = [aws_route53_record.ses_verification]
}

resource "aws_ses_domain_dkim" "forge" {
  count  = local.create_ses_identity ? 1 : 0
  domain = aws_ses_domain_identity.forge[0].domain
}

resource "aws_route53_record" "ses_dkim" {
  count   = local.create_ses_identity ? 3 : 0
  zone_id = var.route53_zone_id
  name    = "${aws_ses_domain_dkim.forge[0].dkim_tokens[count.index]}._domainkey.${var.delegated_zone_name}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.forge[0].dkim_tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_ses_domain_mail_from" "forge" {
  count            = local.create_ses_identity ? 1 : 0
  domain           = aws_ses_domain_identity.forge[0].domain
  mail_from_domain = "mail.${var.delegated_zone_name}"
}

resource "aws_route53_record" "ses_mail_from_mx" {
  count   = local.create_ses_identity ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "mail.${var.delegated_zone_name}"
  type    = "MX"
  ttl     = 600
  records = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
}

resource "aws_route53_record" "ses_mail_from_spf" {
  count   = local.create_ses_identity ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "mail.${var.delegated_zone_name}"
  type    = "TXT"
  ttl     = 600
  records = ["v=spf1 include:amazonses.com -all"]
}
