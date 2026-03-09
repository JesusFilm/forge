output "db_instance_endpoint" {
  description = "RDS endpoint hostname."
  value       = module.platform.db_instance_endpoint
  sensitive   = true
}

output "db_master_secret_arn" {
  description = "Secrets Manager ARN for the RDS master user secret."
  value       = module.platform.db_master_secret_arn
  sensitive   = true
}

output "codebuild_databases_project_name" {
  description = "CodeBuild project name for database management."
  value       = module.platform.codebuild_databases_project_name
}
