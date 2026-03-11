# Temporary imports: groups/policy exist in AWS but were removed from state
# during the partial module.iam → module.iam[0] migration.
# Remove this file after a successful apply.

import {
  to = module.iam[0].module.groups.module.admin_readonly.aws_iam_group.admin_readonly
  id = "forge-admin-readonly"
}

import {
  to = module.iam[0].module.groups.module.billing.aws_iam_group.billing
  id = "forge-billing"
}

import {
  to = module.iam[0].module.groups.module.dev_secrets.aws_iam_group.dev_secrets
  id = "forge-dev-secrets"
}

import {
  to = module.iam[0].module.groups.module.login_profile.aws_iam_group.login_profile
  id = "forge-iam-login-profile"
}

import {
  to = module.iam[0].module.groups.module.require_mfa.aws_iam_policy.require_mfa
  id = "arn:aws:iam::031374266475:policy/forge-require-mfa"
}
