resource "vercel_project" "web" {
  name      = "forge-web"
  framework = "nextjs"
}

resource "vercel_project_environment_variable" "strapi_api_token_preview" {
  project_id = vercel_project.web.id
  key        = "STRAPI_API_TOKEN"
  value      = data.aws_ssm_parameter.strapi_api_token_stage.value
  target     = ["preview"]
  sensitive  = true
}

resource "vercel_project_environment_variable" "strapi_api_token_production" {
  project_id = vercel_project.web.id
  key        = "STRAPI_API_TOKEN"
  value      = data.aws_ssm_parameter.strapi_api_token_prod.value
  target     = ["production"]
  sensitive  = true
}
