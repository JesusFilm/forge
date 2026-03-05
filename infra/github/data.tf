# AWS state used to sync role ARNs (and other outputs) into repo variables.
data "terraform_remote_state" "aws-prod" {
  backend = "s3"
  config = {
    bucket = "forge-terraform-state-031374266475"
    key    = "infra/aws/prod/terraform.tfstate"
    region = "us-east-2"
  }
}

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
data "terraform_remote_state" "aws-stage" {
  backend = "s3"
  config = {
    bucket = "forge-terraform-state-031374266475"
    key    = "infra/aws/stage/terraform.tfstate"
    region = "us-east-2"
  }
}
