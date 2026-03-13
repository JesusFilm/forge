# Read GitHub App credentials directly from SSM instead of AWS Terraform state.
data "aws_ssm_parameter" "github_app_id" {
  name = "/forge/github/app_id"
}

data "aws_ssm_parameter" "github_installation_id" {
  name = "/forge/github/installation_id"
}

data "aws_ssm_parameter" "github_app_pem" {
  name            = "/forge/github/app_private_key"
  with_decryption = true
}

# Read CI role ARNs from SSM instead of IAM or AWS Terraform state.
data "aws_ssm_parameter" "terraform_aws_role_apply_arn_stage" {
  name = "/forge/github/terraform_aws_role_apply_stage_arn"
}

data "aws_ssm_parameter" "terraform_aws_role_apply_arn_prod" {
  name = "/forge/github/terraform_aws_role_apply_prod_arn"
}

data "aws_ssm_parameter" "cms_deploy_role_arn_stage" {
  name = "/forge/github/cms_deploy_role_arn_stage"
}

data "aws_ssm_parameter" "cms_deploy_role_arn_prod" {
  name = "/forge/github/cms_deploy_role_arn_prod"
}

data "aws_ssm_parameter" "terraform_aws_role_plan_arn_stage" {
  name = "/forge/github/terraform_aws_role_plan_stage_arn"
}

data "aws_ssm_parameter" "terraform_aws_role_plan_arn_prod" {
  name = "/forge/github/terraform_aws_role_plan_prod_arn"
}

data "aws_ssm_parameter" "terraform_vercel_role_plan_arn" {
  name = "/forge/github/terraform_vercel_role_plan_arn"
}

data "aws_ssm_parameter" "terraform_vercel_role_apply_arn" {
  name = "/forge/github/terraform_vercel_role_apply_arn"
}

data "aws_ssm_parameter" "terraform_github_role_plan_arn" {
  name = "/forge/github/terraform_github_role_plan_arn"
}

data "aws_ssm_parameter" "terraform_github_role_apply_arn" {
  name = "/forge/github/terraform_github_role_apply_arn"
}

data "aws_ssm_parameter" "strapi_api_token_stage" {
  name            = "/forge/aws/cms/stage/STRAPI_INTERNAL_API_TOKEN"
  with_decryption = true
}

data "aws_ssm_parameter" "web_deploy_role_arn_stage" {
  count = var.enable_web_deploy ? 1 : 0
  name  = "/forge/github/web_deploy_role_arn_stage"
}

data "aws_ssm_parameter" "web_deploy_role_arn_prod" {
  count = var.enable_web_deploy ? 1 : 0
  name  = "/forge/github/web_deploy_role_arn_prod"
}

data "aws_ssm_parameter" "vercel_org_id" {
  count = var.enable_web_deploy ? 1 : 0
  name  = "/forge/vercel/org_id"
}

data "aws_ssm_parameter" "vercel_web_project_id" {
  count = var.enable_web_deploy ? 1 : 0
  name  = "/forge/vercel/web_project_id"
}
