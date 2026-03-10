# Load each admin read-only user (billing via group membership).

module "tataihono" {
  source = "./tataihono"

  tags = var.tags
}

module "dev_secrets" {
  source = "./dev_secrets"

  tags       = var.tags
  group_name = "forge-dev-secrets"
}
