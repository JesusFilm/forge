resource "aws_kms_key" "cms_ssm" {
  description             = "KMS key for CMS SSM parameters"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-ssm-kms"
  })
}

resource "aws_kms_alias" "cms_ssm" {
  name          = "alias/${local.name_prefix}-ssm"
  target_key_id = aws_kms_key.cms_ssm.key_id
}

ephemeral "random_password" "app_key_1" {
  length  = 32
  special = false
}

ephemeral "random_password" "app_key_2" {
  length  = 32
  special = false
}

ephemeral "random_password" "app_key_3" {
  length  = 32
  special = false
}

ephemeral "random_password" "app_key_4" {
  length  = 32
  special = false
}

resource "aws_ssm_parameter" "app_keys" {
  name   = "${local.ssm_parameter_prefix}/APP_KEYS"
  type   = "SecureString"
  key_id = aws_kms_key.cms_ssm.arn
  value_wo = join(",", [
    ephemeral.random_password.app_key_1.result,
    ephemeral.random_password.app_key_2.result,
    ephemeral.random_password.app_key_3.result,
    ephemeral.random_password.app_key_4.result
  ])
  value_wo_version = var.ssm_secret_version
  tags             = local.tags
}

ephemeral "random_password" "admin_jwt_secret" {
  length  = 64
  special = false
}

resource "aws_ssm_parameter" "admin_jwt_secret" {
  name             = "${local.ssm_parameter_prefix}/ADMIN_JWT_SECRET"
  type             = "SecureString"
  key_id           = aws_kms_key.cms_ssm.arn
  value_wo         = ephemeral.random_password.admin_jwt_secret.result
  value_wo_version = var.ssm_secret_version
  tags             = local.tags
}

ephemeral "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "aws_ssm_parameter" "jwt_secret" {
  name             = "${local.ssm_parameter_prefix}/JWT_SECRET"
  type             = "SecureString"
  key_id           = aws_kms_key.cms_ssm.arn
  value_wo         = ephemeral.random_password.jwt_secret.result
  value_wo_version = var.ssm_secret_version
  tags             = local.tags
}

ephemeral "random_password" "api_token_salt" {
  length  = 64
  special = false
}

resource "aws_ssm_parameter" "api_token_salt" {
  name             = "${local.ssm_parameter_prefix}/API_TOKEN_SALT"
  type             = "SecureString"
  key_id           = aws_kms_key.cms_ssm.arn
  value_wo         = ephemeral.random_password.api_token_salt.result
  value_wo_version = var.ssm_secret_version
  tags             = local.tags
}

ephemeral "random_password" "transfer_token_salt" {
  length  = 64
  special = false
}

resource "aws_ssm_parameter" "transfer_token_salt" {
  name             = "${local.ssm_parameter_prefix}/TRANSFER_TOKEN_SALT"
  type             = "SecureString"
  key_id           = aws_kms_key.cms_ssm.arn
  value_wo         = ephemeral.random_password.transfer_token_salt.result
  value_wo_version = var.ssm_secret_version
  tags             = local.tags
}

ephemeral "random_password" "encryption_key" {
  length  = 64
  special = false
}

resource "aws_ssm_parameter" "encryption_key" {
  name             = "${local.ssm_parameter_prefix}/ENCRYPTION_KEY"
  type             = "SecureString"
  key_id           = aws_kms_key.cms_ssm.arn
  value_wo         = ephemeral.random_password.encryption_key.result
  value_wo_version = var.ssm_secret_version
  tags             = local.tags
}

ephemeral "random_password" "strapi_internal_api_token" {
  length  = 64
  special = false
}

resource "aws_ssm_parameter" "strapi_internal_api_token" {
  name             = "${local.ssm_parameter_prefix}/STRAPI_INTERNAL_API_TOKEN"
  type             = "SecureString"
  key_id           = aws_kms_key.cms_ssm.arn
  value_wo         = ephemeral.random_password.strapi_internal_api_token.result
  value_wo_version = var.ssm_secret_version
  tags             = local.tags
}

ephemeral "random_password" "preview_secret" {
  length  = 64
  special = false
}

resource "aws_ssm_parameter" "preview_secret" {
  name             = "${local.ssm_parameter_prefix}/PREVIEW_SECRET"
  type             = "SecureString"
  key_id           = aws_kms_key.cms_ssm.arn
  value_wo         = ephemeral.random_password.preview_secret.result
  value_wo_version = var.ssm_secret_version
  tags             = local.tags
}
