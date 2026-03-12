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
