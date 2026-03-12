resource "random_password" "web_dev_strapi_revalidate_token" {
  count = local.create_dev_ssm_parameters ? 1 : 0

  length  = 64
  special = false
}

resource "random_password" "web_dev_strapi_preview_token" {
  count = local.create_dev_ssm_parameters ? 1 : 0

  length  = 64
  special = false
}

resource "aws_kms_alias" "web_dev_ssm" {
  count = local.create_dev_ssm_parameters ? 1 : 0

  name          = "alias/forge-web-dev-ssm"
  target_key_id = var.ssm_kms_key_arn
}

resource "aws_ssm_parameter" "web_dev_next_public_graphql_url" {
  count = local.create_dev_ssm_parameters ? 1 : 0

  name  = "${local.dev_ssm_parameter_prefix}/NEXT_PUBLIC_GRAPHQL_URL"
  type  = "String"
  value = "http://localhost:1337/graphql"
  tags = merge(local.tags, {
    Environment = "dev"
  })
}

resource "aws_ssm_parameter" "web_dev_strapi_revalidate_token" {
  count = local.create_dev_ssm_parameters ? 1 : 0

  name   = "${local.dev_ssm_parameter_prefix}/STRAPI_REVALIDATE_TOKEN"
  type   = "SecureString"
  key_id = var.ssm_kms_key_arn
  value  = random_password.web_dev_strapi_revalidate_token[0].result

  tags = merge(local.tags, {
    Environment = "dev"
  })
}

resource "aws_ssm_parameter" "web_dev_strapi_preview_token" {
  count = local.create_dev_ssm_parameters ? 1 : 0

  name   = "${local.dev_ssm_parameter_prefix}/STRAPI_PREVIEW_TOKEN"
  type   = "SecureString"
  key_id = var.ssm_kms_key_arn
  value  = random_password.web_dev_strapi_preview_token[0].result

  tags = merge(local.tags, {
    Environment = "dev"
  })
}
