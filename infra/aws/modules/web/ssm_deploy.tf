resource "aws_kms_key" "web_ssm" {
  description             = "KMS key for web SSM parameters"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-ssm-kms"
  })
}

resource "aws_kms_alias" "web_ssm" {
  name          = "alias/${local.name_prefix}-ssm"
  target_key_id = aws_kms_key.web_ssm.key_id
}

data "aws_ssm_parameter" "cms_strapi_api_token" {
  name            = "${local.cms_ssm_parameter_prefix}/STRAPI_INTERNAL_API_TOKEN"
  with_decryption = true
}

resource "aws_ssm_parameter" "strapi_api_token" {
  name             = "${local.ssm_parameter_prefix}/STRAPI_API_TOKEN"
  type             = "SecureString"
  key_id           = aws_kms_key.web_ssm.arn
  value_wo         = data.aws_ssm_parameter.cms_strapi_api_token.value
  value_wo_version = var.ssm_secret_version
  tags             = local.tags
}

data "aws_ssm_parameter" "cms_preview_secret" {
  name            = "${local.cms_ssm_parameter_prefix}/PREVIEW_SECRET"
  with_decryption = true
}

resource "aws_ssm_parameter" "strapi_preview_secret" {
  name             = "${local.ssm_parameter_prefix}/STRAPI_PREVIEW_SECRET"
  type             = "SecureString"
  key_id           = aws_kms_key.web_ssm.arn
  value_wo         = data.aws_ssm_parameter.cms_preview_secret.value
  value_wo_version = var.ssm_secret_version
  tags             = local.tags
}
