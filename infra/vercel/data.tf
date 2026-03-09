# Read Vercel credentials directly from SSM instead of AWS Terraform state.
data "aws_ssm_parameter" "api_token" {
  name            = "/forge/vercel/api_token"
  with_decryption = true
}

data "aws_ssm_parameter" "strapi_api_token_stage" {
  name            = "/forge/aws/cms/stage/STRAPI_INTERNAL_API_TOKEN"
  with_decryption = true
}

data "aws_ssm_parameter" "strapi_api_token_prod" {
  name            = "/forge/aws/cms/prod/STRAPI_INTERNAL_API_TOKEN"
  with_decryption = true
}
