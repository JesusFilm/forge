terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.32"
    }
    postgresql = {
      source  = "cyrilgdn/postgresql"
      version = "~> 1.25"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

provider "postgresql" {
  host             = var.pg_host
  port             = 5432
  username         = var.pg_admin_username
  password         = var.pg_admin_password
  sslmode          = "require"
  superuser        = false
  expected_version = "16.8"
  connect_timeout  = 15
}
