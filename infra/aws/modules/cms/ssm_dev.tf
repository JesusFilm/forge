resource "aws_kms_alias" "cms_dev_ssm" {
  count = local.create_dev_ssm_parameters ? 1 : 0

  name          = "alias/forge-cms-dev-ssm"
  target_key_id = aws_kms_key.cms_ssm.key_id
}

ephemeral "random_password" "dev_app_key_1" {
  length  = 32
  special = false
}

ephemeral "random_password" "dev_app_key_2" {
  length  = 32
  special = false
}

ephemeral "random_password" "dev_app_key_3" {
  length  = 32
  special = false
}

ephemeral "random_password" "dev_app_key_4" {
  length  = 32
  special = false
}

ephemeral "random_password" "dev_admin_jwt_secret" {
  length  = 64
  special = false
}

ephemeral "random_password" "dev_jwt_secret" {
  length  = 64
  special = false
}

ephemeral "random_password" "dev_api_token_salt" {
  length  = 64
  special = false
}

ephemeral "random_password" "dev_transfer_token_salt" {
  length  = 64
  special = false
}

ephemeral "random_password" "dev_encryption_key" {
  length  = 64
  special = false
}

resource "aws_ssm_parameter" "dev_app_keys" {
  count = local.create_dev_ssm_parameters ? 1 : 0

  name   = "${local.dev_ssm_parameter_prefix}/APP_KEYS"
  type   = "SecureString"
  key_id = aws_kms_key.cms_ssm.arn
  value_wo = join(",", [
    ephemeral.random_password.dev_app_key_1.result,
    ephemeral.random_password.dev_app_key_2.result,
    ephemeral.random_password.dev_app_key_3.result,
    ephemeral.random_password.dev_app_key_4.result
  ])
  value_wo_version = var.ssm_secret_version
  tags = merge(local.tags, {
    Environment = "dev"
  })
}

resource "aws_ssm_parameter" "dev_admin_jwt_secret" {
  count = local.create_dev_ssm_parameters ? 1 : 0

  name             = "${local.dev_ssm_parameter_prefix}/ADMIN_JWT_SECRET"
  type             = "SecureString"
  key_id           = aws_kms_key.cms_ssm.arn
  value_wo         = ephemeral.random_password.dev_admin_jwt_secret.result
  value_wo_version = var.ssm_secret_version
  tags = merge(local.tags, {
    Environment = "dev"
  })
}

resource "aws_ssm_parameter" "dev_jwt_secret" {
  count = local.create_dev_ssm_parameters ? 1 : 0

  name             = "${local.dev_ssm_parameter_prefix}/JWT_SECRET"
  type             = "SecureString"
  key_id           = aws_kms_key.cms_ssm.arn
  value_wo         = ephemeral.random_password.dev_jwt_secret.result
  value_wo_version = var.ssm_secret_version
  tags = merge(local.tags, {
    Environment = "dev"
  })
}

resource "aws_ssm_parameter" "dev_api_token_salt" {
  count = local.create_dev_ssm_parameters ? 1 : 0

  name             = "${local.dev_ssm_parameter_prefix}/API_TOKEN_SALT"
  type             = "SecureString"
  key_id           = aws_kms_key.cms_ssm.arn
  value_wo         = ephemeral.random_password.dev_api_token_salt.result
  value_wo_version = var.ssm_secret_version
  tags = merge(local.tags, {
    Environment = "dev"
  })
}

resource "aws_ssm_parameter" "dev_transfer_token_salt" {
  count = local.create_dev_ssm_parameters ? 1 : 0

  name             = "${local.dev_ssm_parameter_prefix}/TRANSFER_TOKEN_SALT"
  type             = "SecureString"
  key_id           = aws_kms_key.cms_ssm.arn
  value_wo         = ephemeral.random_password.dev_transfer_token_salt.result
  value_wo_version = var.ssm_secret_version
  tags = merge(local.tags, {
    Environment = "dev"
  })
}

resource "aws_ssm_parameter" "dev_encryption_key" {
  count = local.create_dev_ssm_parameters ? 1 : 0

  name             = "${local.dev_ssm_parameter_prefix}/ENCRYPTION_KEY"
  type             = "SecureString"
  key_id           = aws_kms_key.cms_ssm.arn
  value_wo         = ephemeral.random_password.dev_encryption_key.result
  value_wo_version = var.ssm_secret_version
  tags = merge(local.tags, {
    Environment = "dev"
  })
}
