# Read Vercel credentials directly from SSM instead of AWS Terraform state.
data "aws_ssm_parameter" "api_token" {
  name            = "/forge/vercel/api_token"
  with_decryption = true
}

data "aws_ssm_parameter" "strapi_api_token_stage" {
  name            = "/forge/vercel/strapi_api_token_stage"
  with_decryption = true
}

data "aws_ssm_parameter" "strapi_api_token_prod" {
  name            = "/forge/vercel/strapi_api_token_prod"
  with_decryption = true
}
