resource "aws_security_group" "codebuild" {
  name_prefix = "${local.name_prefix}-codebuild-"
  description = "CodeBuild for database management"
  vpc_id      = aws_vpc.platform.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-codebuild-sg"
  })
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_codebuild" {
  security_group_id            = aws_security_group.rds.id
  description                  = "CodeBuild to Postgres for database management"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.codebuild.id
}

resource "aws_iam_role" "codebuild_databases" {
  name = "${local.name_prefix}-codebuild-databases"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "codebuild.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.tags
}

data "aws_iam_policy_document" "codebuild_databases" {
  statement {
    sid    = "CloudWatchLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/codebuild/${local.name_prefix}-databases:*"]
  }

  statement {
    sid    = "TerraformStateObject"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject"
    ]
    resources = [
      "arn:aws:s3:::${var.terraform_state_bucket_name}/infra/aws/databases/${var.environment}/terraform.tfstate",
      "arn:aws:s3:::${var.terraform_state_bucket_name}/codebuild/databases-source.zip"
    ]
  }

  statement {
    sid     = "TerraformStateBucketList"
    effect  = "Allow"
    actions = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.terraform_state_bucket_name}"]
  }

  statement {
    sid    = "TerraformStateLock"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:DescribeTable"
    ]
    resources = ["arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${var.terraform_state_lock_table_name}"]
  }

  statement {
    sid    = "TerraformStateKms"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey"
    ]
    resources = [var.terraform_state_kms_key_arn]
  }

  statement {
    sid       = "SecretsManagerReadRdsMasterPassword"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:rds!*"]
  }

  statement {
    sid    = "SsmParameterManagement"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:PutParameter",
      "ssm:DeleteParameter",
      "ssm:AddTagsToResource",
      "ssm:ListTagsForResource",
      "ssm:RemoveTagsFromResource"
    ]
    resources = ["arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/forge/aws/*/${var.environment}/DATABASE_URL"]
  }

  statement {
    sid    = "SsmKmsEncryptDecrypt"
    effect = "Allow"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:GenerateDataKey"
    ]
    resources = [module.application.ssm_kms_key_arn]
  }

  statement {
    sid    = "VpcNetworkInterface"
    effect = "Allow"
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface",
      "ec2:DescribeSubnets",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeDhcpOptions",
      "ec2:DescribeVpcs",
      "ec2:CreateNetworkInterfacePermission"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "codebuild_databases" {
  name   = "codebuild-databases"
  role   = aws_iam_role.codebuild_databases.id
  policy = data.aws_iam_policy_document.codebuild_databases.json
}

resource "aws_cloudwatch_log_group" "codebuild_databases" {
  name              = "/aws/codebuild/${local.name_prefix}-databases"
  retention_in_days = 30
  tags              = local.tags
}

resource "aws_codebuild_project" "databases" {
  name          = "${local.name_prefix}-databases"
  description   = "Manage PostgreSQL databases inside the shared RDS instance"
  service_role  = aws_iam_role.codebuild_databases.arn
  build_timeout = 10

  source {
    type     = "S3"
    location = "${var.terraform_state_bucket_name}/codebuild/databases-source.zip"
  }

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type = "BUILD_GENERAL1_SMALL"
    image        = "aws/codebuild/amazonlinux-x86_64-standard:5.0"
    type         = "LINUX_CONTAINER"

    environment_variable {
      name  = "ENVIRONMENT"
      value = var.environment
    }
    environment_variable {
      name  = "STATE_BUCKET"
      value = var.terraform_state_bucket_name
    }
    environment_variable {
      name  = "LOCK_TABLE"
      value = var.terraform_state_lock_table_name
    }
    environment_variable {
      name  = "RDS_ENDPOINT"
      value = module.application.db_instance_endpoint
    }
    environment_variable {
      name  = "RDS_SECRET_ARN"
      value = module.application.db_master_secret_arn
    }
    environment_variable {
      name  = "SSM_KMS_KEY_ARN"
      value = module.application.ssm_kms_key_arn
    }
  }

  vpc_config {
    vpc_id             = aws_vpc.platform.id
    subnets            = [for subnet in aws_subnet.private : subnet.id]
    security_group_ids = [aws_security_group.codebuild.id]
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.codebuild_databases.name
    }
  }

  tags = local.tags
}
