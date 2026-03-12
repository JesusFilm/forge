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
