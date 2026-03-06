terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.32"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region = var.aws_region
}

provider "github" {
  owner = "JesusFilm"
  app_auth {
    id              = data.aws_ssm_parameter.github_app_id.value
    installation_id = data.aws_ssm_parameter.github_installation_id.value
    pem_file        = data.aws_ssm_parameter.github_app_pem.value
  }
}
