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

# Read CI role ARNs directly from IAM instead of AWS Terraform state.
data "aws_iam_role" "terraform_apply_stage" {
  name = "forge-github-actions-terraform-apply-stage"
}

data "aws_iam_role" "terraform_apply_prod" {
  name = "forge-github-actions-terraform-apply-prod"
}

data "aws_iam_role" "cms_deploy_stage" {
  name = "forge-github-actions-cms-deploy-stage"
}

data "aws_iam_role" "cms_deploy_prod" {
  name = "forge-github-actions-cms-deploy-prod"
}

data "aws_iam_role" "terraform_plan_stage" {
  name = "forge-github-actions-terraform-plan-stage"
}

data "aws_iam_role" "terraform_plan_prod" {
  name = "forge-github-actions-terraform-plan-prod"
}

data "aws_iam_role" "terraform_vercel" {
  name = "forge-github-actions-terraform-vercel"
}

data "aws_iam_role" "terraform_github" {
  name = "forge-github-actions-terraform-github"
}
