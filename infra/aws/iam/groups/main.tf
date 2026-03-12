module "require_mfa" {
  source = "./require_mfa"

  tags = var.tags
}

module "admin_readonly" {
  source = "./admin_readonly"

  tags           = var.tags
  mfa_policy_arn = module.require_mfa.policy_arn
}

module "billing" {
  source = "./billing"

  tags           = var.tags
  mfa_policy_arn = module.require_mfa.policy_arn
}

module "login_profile" {
  source = "./login_profile"

  tags           = var.tags
  mfa_policy_arn = module.require_mfa.policy_arn
}

module "dev_secrets" {
  source = "./dev_secrets"

  tags           = var.tags
  mfa_policy_arn = module.require_mfa.policy_arn
}
