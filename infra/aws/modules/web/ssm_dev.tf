resource "aws_kms_alias" "web_ssm_dev" {
  count = local.create_ssm_dev_parameters ? 1 : 0

  name          = "alias/forge-web-dev-ssm"
  target_key_id = aws_kms_key.web_ssm.key_id
}

resource "aws_ssm_parameter" "web_dev_next_public_graphql_url" {
  count = local.create_ssm_dev_parameters ? 1 : 0

  name  = "${local.ssm_dev_parameter_prefix}/NEXT_PUBLIC_GRAPHQL_URL"
  type  = "String"
  value = "http://localhost:1337/graphql"
  tags = merge(local.tags, {
    Environment = "dev"
  })
}

data "aws_ssm_parameter" "cms_ssm_dev_strapi_api_token" {
  count = local.create_ssm_dev_parameters ? 1 : 0

  name            = var.cms_ssm_dev_strapi_api_token_param_name
  with_decryption = true
}

resource "aws_ssm_parameter" "web_dev_strapi_api_token" {
  count = local.create_ssm_dev_parameters ? 1 : 0

  name   = "${local.ssm_dev_parameter_prefix}/STRAPI_API_TOKEN"
  type   = "SecureString"
  key_id = aws_kms_key.web_ssm.arn
  value  = data.aws_ssm_parameter.cms_ssm_dev_strapi_api_token[0].value
  tags = merge(local.tags, {
    Environment = "dev"
  })
}

data "aws_ssm_parameter" "cms_ssm_dev_preview_secret" {
  count = local.create_ssm_dev_parameters ? 1 : 0

  name            = var.cms_ssm_dev_preview_secret_param_name
  with_decryption = true
}

resource "aws_ssm_parameter" "web_dev_strapi_preview_secret" {
  count = local.create_ssm_dev_parameters ? 1 : 0

  name   = "${local.ssm_dev_parameter_prefix}/STRAPI_PREVIEW_SECRET"
  type   = "SecureString"
  key_id = aws_kms_key.web_ssm.arn
  value  = data.aws_ssm_parameter.cms_ssm_dev_preview_secret[0].value
  tags = merge(local.tags, {
    Environment = "dev"
  })
}
