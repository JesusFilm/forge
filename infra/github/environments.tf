# Deployment environments (protection rules, env-specific vars).
# aws-*: terraform-apply; cms-*: cms-deploy.

resource "github_repository_environment" "aws_stage" {
  repository  = data.github_repository.forge.name
  environment = "aws-stage"
}

resource "github_repository_environment" "aws_prod" {
  repository  = data.github_repository.forge.name
  environment = "aws-prod"
}

resource "github_repository_environment" "cms_stage" {
  repository  = data.github_repository.forge.name
  environment = "cms-stage"
}

resource "github_repository_environment" "cms_prod" {
  repository  = data.github_repository.forge.name
  environment = "cms-prod"
}
