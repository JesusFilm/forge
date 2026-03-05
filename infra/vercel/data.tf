# AWS prod state: Vercel API token for provider (set in infra/aws SSM, output in state).
data "terraform_remote_state" "aws_prod" {
  backend = "s3"
  config = {
    bucket = "forge-terraform-state-031374266475"
    key    = "infra/aws/prod/terraform.tfstate"
    region = "us-east-2"
  }
}
