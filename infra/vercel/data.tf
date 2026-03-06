# Read Vercel credentials directly from SSM instead of AWS Terraform state.
data "aws_ssm_parameter" "api_token" {
  name            = "/forge/vercel/api_token"
  with_decryption = true
}
