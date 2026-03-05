output "vercel_api_token" {
  description = "Vercel API token (prod SSM value; for infra/vercel provider via remote state)."
  value       = var.environment == "prod" ? aws_ssm_parameter.api_token[0].value : null
  sensitive   = true
}
