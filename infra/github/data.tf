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
data "aws_ssm_parameter" "terraform_apply_role_arn_stage" {
  name = "/forge/github/terraform_apply_role_arn_stage"
}

data "aws_ssm_parameter" "terraform_apply_role_arn_prod" {
  name = "/forge/github/terraform_apply_role_arn_prod"
}

data "aws_ssm_parameter" "cms_deploy_role_arn_stage" {
  name = "/forge/github/cms_deploy_role_arn_stage"
}

data "aws_ssm_parameter" "cms_deploy_role_arn_prod" {
  name = "/forge/github/cms_deploy_role_arn_prod"
}

data "aws_ssm_parameter" "terraform_plan_role_arn_stage" {
  name = "/forge/github/terraform_plan_role_arn_stage"
}

data "aws_ssm_parameter" "terraform_plan_role_arn_prod" {
  name = "/forge/github/terraform_plan_role_arn_prod"
}

data "aws_ssm_parameter" "terraform_vercel_role_arn" {
  name = "/forge/github/terraform_vercel_role_arn"
}

data "aws_ssm_parameter" "terraform_github_role_arn" {
  name = "/forge/github/terraform_github_role_arn"
}
