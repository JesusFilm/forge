resource "aws_kms_key" "web_ssm" {
  description             = "KMS key for web SSM parameters"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-ssm-kms"
  })
}

resource "aws_kms_alias" "web_ssm" {
  name          = "alias/${local.name_prefix}-ssm"
  target_key_id = aws_kms_key.web_ssm.key_id
}
