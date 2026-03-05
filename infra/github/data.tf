# AWS state used to sync role ARNs (and other outputs) into repo variables.
data "terraform_remote_state" "aws-prod" {
  backend = "s3"
  config = {
    bucket = "forge-terraform-state-031374266475"
    key    = "infra/aws/prod/terraform.tfstate"
    region = "us-east-2"
  }
}

data "terraform_remote_state" "aws-stage" {
  backend = "s3"
  config = {
    bucket = "forge-terraform-state-031374266475"
    key    = "infra/aws/stage/terraform.tfstate"
    region = "us-east-2"
  }
}
