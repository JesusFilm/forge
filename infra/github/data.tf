# AWS state used to sync role ARNs (and other outputs) into repo variables.
# Prod state only (apply-github runs on main).
data "terraform_remote_state" "aws" {
  backend = "s3"
  config = {
    bucket = "forge-terraform-state-031374266475"
    key    = "infra/aws/prod/terraform.tfstate"
    region = "us-east-2"
  }
}

data "github_repository" "forge" {
  full_name = var.github_repository
}
