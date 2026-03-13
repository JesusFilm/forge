# Read Vercel credentials directly from SSM instead of AWS Terraform state.
data "aws_ssm_parameter" "api_token" {
  name            = "/forge/vercel/api_token"
  with_decryption = true
}

# All web env vars sourced from the web SSM namespace.
data "aws_ssm_parameter" "strapi_api_token_stage" {
  name            = "/forge/aws/web/stage/STRAPI_API_TOKEN"
  with_decryption = true
}

data "aws_ssm_parameter" "strapi_api_token_prod" {
  name            = "/forge/aws/web/prod/STRAPI_API_TOKEN"
  with_decryption = true
}

data "aws_ssm_parameter" "strapi_preview_secret_stage" {
  name            = "/forge/aws/web/stage/STRAPI_PREVIEW_SECRET"
  with_decryption = true
}

data "aws_ssm_parameter" "strapi_preview_secret_prod" {
  name            = "/forge/aws/web/prod/STRAPI_PREVIEW_SECRET"
  with_decryption = true
}

data "aws_ssm_parameter" "next_public_graphql_url_stage" {
  name = "/forge/aws/web/stage/NEXT_PUBLIC_GRAPHQL_URL"
}

data "aws_ssm_parameter" "next_public_graphql_url_prod" {
  name = "/forge/aws/web/prod/NEXT_PUBLIC_GRAPHQL_URL"
}

data "aws_ssm_parameter" "next_public_cms_hostname_stage" {
  name = "/forge/aws/web/stage/NEXT_PUBLIC_CMS_HOSTNAME"
}

data "aws_ssm_parameter" "next_public_cms_hostname_prod" {
  name = "/forge/aws/web/prod/NEXT_PUBLIC_CMS_HOSTNAME"
}
