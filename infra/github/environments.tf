# Deployment environments (protection rules, env-specific vars).
# aws-*: terraform-apply; aws-plan-*: terraform-plan; cms-*: cms-deploy; vercel/github: separate plan/apply roles.

resource "github_repository_environment" "aws_stage" {
  repository  = github_repository.forge.name
  environment = "aws-stage"
}

resource "github_repository_environment" "aws_prod" {
  repository  = github_repository.forge.name
  environment = "aws-prod"
}

resource "github_repository_environment" "aws_plan_stage" {
  repository  = github_repository.forge.name
  environment = "aws-plan-stage"
}

resource "github_repository_environment" "aws_plan_prod" {
  repository  = github_repository.forge.name
  environment = "aws-plan-prod"
}

resource "github_repository_environment" "cms_stage" {
  repository  = github_repository.forge.name
  environment = "cms-stage"
}

resource "github_repository_environment" "cms_prod" {
  repository  = github_repository.forge.name
  environment = "cms-prod"
}

resource "github_repository_environment" "vercel_plan" {
  repository  = github_repository.forge.name
  environment = "vercel-plan"
}

resource "github_repository_environment" "vercel_prod" {
  repository  = github_repository.forge.name
  environment = "vercel-prod"
}

resource "github_repository_environment" "github_plan" {
  repository  = github_repository.forge.name
  environment = "github-plan"
}

resource "github_repository_environment" "github_prod" {
  repository  = github_repository.forge.name
  environment = "github-prod"
}

resource "github_repository_environment" "web_preview" {
  repository  = github_repository.forge.name
  environment = "web-preview"
}

resource "github_repository_environment" "web_stage" {
  repository  = github_repository.forge.name
  environment = "web-stage"
}

resource "github_repository_environment" "web_prod" {
  repository  = github_repository.forge.name
  environment = "web-prod"
}
