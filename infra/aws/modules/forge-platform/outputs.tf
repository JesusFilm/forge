output "ecs_cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "strapi_service_name" {
  value = "strapi-${var.environment}"
}

output "ai_service_name" {
  value = "ai-orchestrator-${var.environment}"
}
