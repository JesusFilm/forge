terraform {
  required_version = ">= 1.6.0"

  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "~> 2.0"
    }
  }
}

provider "vercel" {
  api_token = var.vercel_api_token
}

resource "vercel_project" "web" {
  name      = "forge-web-${var.environment}"
  framework = "nextjs"
}
