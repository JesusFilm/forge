module "groups" {
  source = "./groups"

  tags = var.tags
}

module "users" {
  source = "./users"

  tags = var.tags

  depends_on = [module.groups]
}
