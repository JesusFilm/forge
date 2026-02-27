locals {
  target_environments = var.environment == null ? var.environments : [var.environment]
  app_domains = {
    prod  = var.delegated_zone_name
    stage = "stage.${var.delegated_zone_name}"
  }
  assets_domains = {
    prod  = "assets.${var.delegated_zone_name}"
    stage = "assets.stage.${var.delegated_zone_name}"
  }
}
