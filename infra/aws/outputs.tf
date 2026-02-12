output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.forge_platform.ecs_cluster_name
}

output "strapi_service_name" {
  description = "Strapi ECS service name"
  value       = module.forge_platform.strapi_service_name
}

output "ai_service_name" {
  description = "AI orchestration ECS service name"
  value       = module.forge_platform.ai_service_name
}
