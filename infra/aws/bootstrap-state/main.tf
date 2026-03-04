data "aws_caller_identity" "current" {}

locals {
  state_bucket_name = coalesce(
    var.state_bucket_name,
    "${var.project_name}-terraform-state-${data.aws_caller_identity.current.account_id}"
  )
  lock_table_name = coalesce(
    var.lock_table_name,
    "${var.project_name}-terraform-locks"
  )
  state_bucket_object_arn = "${aws_s3_bucket.terraform_state.arn}/*"
}

resource "aws_kms_key" "terraform_state" {
  description             = "KMS key for Terraform remote state data at rest"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-terraform-state-kms"
  })
}

resource "aws_kms_alias" "terraform_state" {
  name          = "alias/${var.project_name}-terraform-state"
  target_key_id = aws_kms_key.terraform_state.key_id
}

resource "aws_s3_bucket" "terraform_state" {
  bucket = local.state_bucket_name

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(var.tags, {
    Name = local.state_bucket_name
  })
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    id     = "expire-noncurrent-state-versions"
    status = "Enabled"

    noncurrent_version_expiration {
      noncurrent_days = 365
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.terraform_state.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "terraform_state_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.terraform_state.arn,
      local.state_bucket_object_arn,
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  dynamic "statement" {
    for_each = length(var.ci_role_arns) == 0 ? [] : [1]
    content {
      sid    = "DenyCIMutations"
      effect = "Deny"
      actions = [
        "s3:DeleteBucket",
        "s3:PutBucketPolicy",
        "s3:DeleteBucketPolicy",
        "s3:PutBucketVersioning",
        "s3:PutEncryptionConfiguration",
        "s3:PutBucketPublicAccessBlock",
      ]
      resources = [
        aws_s3_bucket.terraform_state.arn,
        local.state_bucket_object_arn,
      ]

      principals {
        type        = "AWS"
        identifiers = var.ci_role_arns
      }
    }
  }
}

resource "aws_s3_bucket_policy" "terraform_state_tls_only" {
  bucket = aws_s3_bucket.terraform_state.id
  policy = data.aws_iam_policy_document.terraform_state_bucket.json
}

resource "aws_dynamodb_table" "terraform_lock" {
  name         = local.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.terraform_state.arn
  }

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(var.tags, {
    Name = local.lock_table_name
  })
}

data "aws_iam_policy_document" "deny_bootstrap_state_mutation" {
  statement {
    sid    = "DenyStateBucketMutation"
    effect = "Deny"
    actions = [
      "s3:DeleteBucket",
      "s3:PutBucketPolicy",
      "s3:DeleteBucketPolicy",
      "s3:PutBucketVersioning",
      "s3:PutEncryptionConfiguration",
      "s3:PutBucketPublicAccessBlock",
    ]
    resources = [
      aws_s3_bucket.terraform_state.arn,
      local.state_bucket_object_arn,
    ]
  }

  statement {
    sid    = "DenyStateLockMutation"
    effect = "Deny"
    actions = [
      "dynamodb:DeleteTable",
      "dynamodb:UpdateTable",
    ]
    resources = [aws_dynamodb_table.terraform_lock.arn]
  }

  statement {
    sid    = "DenyStateKMSMutation"
    effect = "Deny"
    actions = [
      "kms:DisableKey",
      "kms:ScheduleKeyDeletion",
      "kms:PutKeyPolicy",
    ]
    resources = [aws_kms_key.terraform_state.arn]
  }
}

resource "aws_iam_policy" "deny_bootstrap_state_mutation" {
  name        = "${var.project_name}-deny-bootstrap-state-mutation"
  description = "Attach to CI roles to prevent any remote-state backend mutation."
  policy      = data.aws_iam_policy_document.deny_bootstrap_state_mutation.json
}
