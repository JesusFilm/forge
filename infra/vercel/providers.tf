terraform {
  required_version = ">= 1.6.0"

  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.32"
    }
    vercel = {
      source  = "vercel/vercel"
      version = "~> 4.6"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

provider "vercel" {
  api_token = data.aws_ssm_parameter.api_token.value
}
