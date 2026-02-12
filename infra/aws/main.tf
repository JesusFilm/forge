terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

module "forge_platform" {
  source = "./modules/forge-platform"

  environment = var.environment
  aws_region  = var.aws_region
}
