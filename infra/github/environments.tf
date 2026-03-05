# Deployment environments (protection rules, env-specific vars).
# aws-*: terraform-apply; cms-*: cms-deploy.

resource "github_repository_environment" "aws_stage" {
  repository  = github_repository.forge.name
  environment = "aws-stage"
}

resource "github_repository_environment" "aws_prod" {
  repository  = github_repository.forge.name
  environment = "aws-prod"
}

resource "github_repository_environment" "cms_stage" {
  repository  = github_repository.forge.name
  environment = "cms-stage"
}

resource "github_repository_environment" "cms_prod" {
  repository  = github_repository.forge.name
  environment = "cms-prod"
}
