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
  owner = "JesusFilm"
  app_auth {
    id              = data.terraform_remote_state.aws-prod.outputs.github_app_id
    installation_id = data.terraform_remote_state.aws-prod.outputs.github_installation_id
    pem_file        = data.terraform_remote_state.aws-prod.outputs.github_app_pem
  }
}
