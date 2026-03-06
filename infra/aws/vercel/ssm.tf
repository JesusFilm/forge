locals {
  create_vercel_ssm_resources = var.environment == "prod"
  vercel_ssm_tags = merge(var.tags, {
    Environment = var.environment
    ManagedBy   = "terraform"
    Service     = "vercel"
  })
}

# Vercel API token in SSM (prod only). Terraform creates param; set value in AWS console.
resource "aws_kms_key" "vercel_ssm" {
  count = local.create_vercel_ssm_resources ? 1 : 0

  description             = "KMS key for Vercel SSM parameters"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags = merge(local.vercel_ssm_tags, {
    Name = "forge-vercel-${var.environment}-ssm-kms"
  })

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "vercel_ssm" {
  count = local.create_vercel_ssm_resources ? 1 : 0

  name          = "alias/forge-vercel-${var.environment}-ssm"
  target_key_id = aws_kms_key.vercel_ssm[0].key_id
}

resource "aws_ssm_parameter" "api_token" {
  count = local.create_vercel_ssm_resources ? 1 : 0

  name   = "/forge/vercel/api_token"
  type   = "SecureString"
  key_id = aws_kms_key.vercel_ssm[0].arn
  value  = "manually set in AWS console"

  lifecycle {
    ignore_changes = [value]
  }
}
