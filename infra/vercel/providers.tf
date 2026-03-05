terraform {
  required_version = ">= 1.6.0"

  backend "s3" {}

  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "~> 4.6"
    }
  }
}

provider "vercel" {
  api_token = data.terraform_remote_state.aws_prod.outputs.vercel_api_token
}
