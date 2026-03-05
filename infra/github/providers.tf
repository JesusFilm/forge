terraform {
  required_version = ">= 1.6.0"

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }

  backend "s3" {}
}

provider "github" {
  owner = split("/", var.github_repository)[0]
  token = var.github_token
}
