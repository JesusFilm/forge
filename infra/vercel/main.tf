resource "vercel_project" "web" {
  name           = "forge-web"
  framework      = "nextjs"
  root_directory = "apps/web"
}

# --- STRAPI_API_TOKEN ---

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

# --- STRAPI_PREVIEW_SECRET ---

resource "vercel_project_environment_variable" "strapi_preview_secret_preview" {
  project_id = vercel_project.web.id
  key        = "STRAPI_PREVIEW_SECRET"
  value      = data.aws_ssm_parameter.strapi_preview_secret_stage.value
  target     = ["preview"]
  sensitive  = true
}

resource "vercel_project_environment_variable" "strapi_preview_secret_production" {
  project_id = vercel_project.web.id
  key        = "STRAPI_PREVIEW_SECRET"
  value      = data.aws_ssm_parameter.strapi_preview_secret_prod.value
  target     = ["production"]
  sensitive  = true
}

# --- NEXT_PUBLIC_GRAPHQL_URL ---

resource "vercel_project_environment_variable" "next_public_graphql_url_preview" {
  project_id = vercel_project.web.id
  key        = "NEXT_PUBLIC_GRAPHQL_URL"
  value      = data.aws_ssm_parameter.next_public_graphql_url_stage.value
  target     = ["preview"]
}

resource "vercel_project_environment_variable" "next_public_graphql_url_production" {
  project_id = vercel_project.web.id
  key        = "NEXT_PUBLIC_GRAPHQL_URL"
  value      = data.aws_ssm_parameter.next_public_graphql_url_prod.value
  target     = ["production"]
}

# --- NEXT_PUBLIC_CMS_HOSTNAME ---

resource "vercel_project_environment_variable" "next_public_cms_hostname_preview" {
  project_id = vercel_project.web.id
  key        = "NEXT_PUBLIC_CMS_HOSTNAME"
  value      = data.aws_ssm_parameter.next_public_cms_hostname_stage.value
  target     = ["preview"]
}

resource "vercel_project_environment_variable" "next_public_cms_hostname_production" {
  project_id = vercel_project.web.id
  key        = "NEXT_PUBLIC_CMS_HOSTNAME"
  value      = data.aws_ssm_parameter.next_public_cms_hostname_prod.value
  target     = ["production"]
}
