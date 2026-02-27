terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.32"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

locals {
  target_environments = var.environment == null ? var.environments : [var.environment]
}

module "forge_platform" {
  for_each = toset(local.target_environments)

  source = "./modules/forge-platform"

  environment = each.value
  aws_region  = var.aws_region
  tags        = var.tags
}
