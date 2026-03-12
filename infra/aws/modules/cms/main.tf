locals {
  name_prefix               = "forge-cms-${var.environment}"
  ssm_parameter_prefix      = "/forge/aws/cms/${var.environment}"
  dev_ssm_parameter_prefix  = "/forge/aws/cms/dev"
  create_dev_ssm_parameters = var.environment == "stage"
  tags = merge(var.tags, {
    Environment = var.environment
    ManagedBy   = "terraform"
    Service     = "cms"
  })
}

resource "aws_ecr_repository" "cms" {
  name                 = local.name_prefix
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cloudwatch_log_group" "cms" {
  name              = "/ecs/${local.name_prefix}"
  retention_in_days = 30
  tags              = local.tags
}

resource "aws_ecs_cluster" "cms" {
  name = local.name_prefix
  tags = local.tags
}

resource "aws_iam_role" "ecs_execution" {
  name = "${local.name_prefix}-execution-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_execution_secrets" {
  statement {
    sid    = "ReadRdsSecretForInjection"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret"
    ]
    resources = [aws_db_instance.cms.master_user_secret[0].secret_arn]
  }

  statement {
    sid    = "ReadSsmParametersForInjection"
    effect = "Allow"
    actions = [
      "ssm:GetParameters",
      "ssm:GetParameter"
    ]
    resources = [
      aws_ssm_parameter.app_keys.arn,
      aws_ssm_parameter.admin_jwt_secret.arn,
      aws_ssm_parameter.jwt_secret.arn,
      aws_ssm_parameter.api_token_salt.arn,
      aws_ssm_parameter.transfer_token_salt.arn,
      aws_ssm_parameter.encryption_key.arn,
      aws_ssm_parameter.strapi_internal_api_token.arn,
    ]
  }

  statement {
    sid    = "DecryptCmsSsmParameters"
    effect = "Allow"
    actions = [
      "kms:Decrypt"
    ]
    resources = [aws_kms_key.cms_ssm.arn]
  }
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name   = "${local.name_prefix}-execution-secrets"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution_secrets.json
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.name_prefix}-task-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

data "aws_iam_policy_document" "ecs_task" {
  statement {
    sid    = "S3AssetsBucketList"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
    ]
    resources = [var.assets_bucket_arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${var.assets_cdn_root_path}/*"]
    }
  }
  statement {
    sid    = "S3CmsPrefixReadWrite"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${var.assets_bucket_arn}/${var.assets_cdn_root_path}/*"]
  }
  statement {
    sid    = "KmsAssetsKeyUse"
    effect = "Allow"
    actions = [
      "kms:GenerateDataKey",
      "kms:Decrypt",
    ]
    resources = [var.assets_kms_key_arn]
  }
  statement {
    sid    = "SesSendEmail"
    effect = "Allow"
    actions = [
      "ses:SendEmail",
      "ses:SendRawEmail",
    ]
    resources = ["*"]
  }
  statement {
    sid    = "EcsExec"
    effect = "Allow"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ecs_task" {
  name   = "${local.name_prefix}-task-policy"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task.json
}

resource "aws_lb_target_group" "cms" {
  name                 = substr(replace("${local.name_prefix}-tg", "/[^a-zA-Z0-9-]/", ""), 0, 32)
  port                 = 1337
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30

  health_check {
    enabled             = true
    interval            = 30
    path                = "/_health"
    port                = "traffic-port"
    healthy_threshold   = 2
    unhealthy_threshold = 5
    timeout             = 5
    matcher             = "200-399"
  }

  tags = local.tags
}

resource "aws_vpc_security_group_egress_rule" "alb_to_cms" {
  security_group_id            = var.alb_security_group_id
  description                  = "ALB to cms service"
  ip_protocol                  = "tcp"
  from_port                    = 1337
  to_port                      = 1337
  referenced_security_group_id = var.ecs_service_security_group_id
}

resource "aws_vpc_security_group_ingress_rule" "cms_from_alb" {
  security_group_id            = var.ecs_service_security_group_id
  description                  = "ALB to cms service"
  ip_protocol                  = "tcp"
  from_port                    = 1337
  to_port                      = 1337
  referenced_security_group_id = var.alb_security_group_id
}

resource "aws_ecs_task_definition" "cms" {
  family                   = "${local.name_prefix}-task"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  network_mode             = "awsvpc"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "cms"
    image     = "${aws_ecr_repository.cms.repository_url}:latest"
    essential = true
    portMappings = [{
      containerPort = 1337
      hostPort      = 1337
      protocol      = "tcp"
    }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.cms.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "cms"
      }
    }
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "HOST", value = "0.0.0.0" },
      { name = "PORT", value = "1337" },
      { name = "DATABASE_CLIENT", value = "postgres" },
      { name = "DATABASE_HOST", value = aws_db_instance.cms.address },
      { name = "DATABASE_PORT", value = tostring(aws_db_instance.cms.port) },
      { name = "DATABASE_NAME", value = var.db_name },
      { name = "DATABASE_USERNAME", value = var.db_username },
      { name = "DATABASE_SSL", value = "true" },
      { name = "DATABASE_SSL_REJECT_UNAUTHORIZED", value = "false" },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "AWS_BUCKET", value = var.assets_bucket_name },
      { name = "CDN_URL", value = var.assets_cdn_url },
      { name = "CDN_ROOT_PATH", value = var.assets_cdn_root_path },
      { name = "AWS_KMS_KEY_ID", value = var.assets_kms_key_id },
      { name = "EMAIL_DEFAULT_FROM", value = var.email_default_from },
      { name = "EMAIL_DEFAULT_REPLY_TO", value = var.email_default_reply_to },
    ]
    secrets = [
      {
        name      = "DATABASE_PASSWORD"
        valueFrom = "${aws_db_instance.cms.master_user_secret[0].secret_arn}:password::"
      },
      {
        name      = "APP_KEYS"
        valueFrom = aws_ssm_parameter.app_keys.arn
      },
      {
        name      = "ADMIN_JWT_SECRET"
        valueFrom = aws_ssm_parameter.admin_jwt_secret.arn
      },
      {
        name      = "JWT_SECRET"
        valueFrom = aws_ssm_parameter.jwt_secret.arn
      },
      {
        name      = "API_TOKEN_SALT"
        valueFrom = aws_ssm_parameter.api_token_salt.arn
      },
      {
        name      = "TRANSFER_TOKEN_SALT"
        valueFrom = aws_ssm_parameter.transfer_token_salt.arn
      },
      {
        name      = "ENCRYPTION_KEY"
        valueFrom = aws_ssm_parameter.encryption_key.arn
      },
      {
        name      = "STRAPI_INTERNAL_API_TOKEN"
        valueFrom = aws_ssm_parameter.strapi_internal_api_token.arn
      },
    ]
  }])

  tags = local.tags
}

resource "aws_ecs_service" "cms" {
  name                   = "${local.name_prefix}-service"
  cluster                = aws_ecs_cluster.cms.id
  task_definition        = aws_ecs_task_definition.cms.arn
  desired_count          = var.ecs_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = var.environment != "prod"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_service_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.cms.arn
    container_name   = "cms"
    container_port   = 1337
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  lifecycle {
    ignore_changes = [desired_count]
  }
}

# Prod only: Application Auto Scaling owns desired_count (min 1, max 3). Lifecycle above lets the scaler change it.
resource "aws_appautoscaling_target" "cms" {
  count              = var.environment == "prod" ? 1 : 0
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.cms.name}/${aws_ecs_service.cms.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = 1
  max_capacity       = 3
}

resource "aws_appautoscaling_policy" "cms_cpu" {
  count              = var.environment == "prod" ? 1 : 0
  name               = "${local.name_prefix}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.cms[0].resource_id
  scalable_dimension = aws_appautoscaling_target.cms[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.cms[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_db_subnet_group" "cms" {
  name       = "${local.name_prefix}-db-subnets"
  subnet_ids = var.private_subnet_ids
  tags       = local.tags
}

resource "aws_db_instance" "cms" {
  identifier                      = "${local.name_prefix}-db"
  engine                          = "postgres"
  engine_version                  = var.db_engine_version
  instance_class                  = var.db_instance_class
  allocated_storage               = var.db_allocated_storage
  db_name                         = var.db_name
  username                        = var.db_username
  manage_master_user_password     = true
  master_user_secret_kms_key_id   = var.db_master_user_secret_kms_key_id
  db_subnet_group_name            = aws_db_subnet_group.cms.name
  vpc_security_group_ids          = [var.rds_security_group_id]
  skip_final_snapshot             = var.environment != "prod"
  final_snapshot_identifier       = var.environment == "prod" ? "${local.name_prefix}-final-snapshot" : null
  backup_retention_period         = var.db_backup_retention_period
  enabled_cloudwatch_logs_exports = var.db_enabled_cloudwatch_logs_exports
  deletion_protection             = var.environment == "prod"
  multi_az                        = var.db_multi_az
  publicly_accessible             = false
  apply_immediately               = var.environment != "prod"
  storage_encrypted               = true

  tags = local.tags
}

resource "aws_lb_listener_rule" "cms_host" {
  listener_arn = var.alb_https_listener_arn
  priority     = 100

  condition {
    host_header {
      values = [var.alb_domain_name]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.cms.arn
  }
}
