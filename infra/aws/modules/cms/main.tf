locals {
  name_prefix     = "forge-cms-${var.environment}"
  container_image = "strapi/strapi:latest"
  container_port  = 1337
  desired_count   = 1
  task_cpu        = 512
  task_memory     = 1024
  tags = merge(var.tags, {
    Environment = var.environment
    ManagedBy   = "terraform"
    Service     = "cms"
  })
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

data "aws_iam_policy_document" "ecs_task_secrets" {
  statement {
    sid    = "ReadRdsManagedSecret"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret"
    ]
    resources = [aws_db_instance.cms.master_user_secret[0].secret_arn]
  }
}

resource "aws_iam_role_policy" "ecs_task_secrets" {
  name   = "${local.name_prefix}-task-secrets"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task_secrets.json
}

resource "aws_lb_target_group" "cms" {
  name                 = substr(replace("${local.name_prefix}-tg", "/[^a-zA-Z0-9-]/", ""), 0, 32)
  port                 = local.container_port
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
  from_port                    = local.container_port
  to_port                      = local.container_port
  referenced_security_group_id = var.ecs_service_security_group_id
}

resource "aws_vpc_security_group_ingress_rule" "cms_from_alb" {
  security_group_id            = var.ecs_service_security_group_id
  description                  = "ALB to cms service"
  ip_protocol                  = "tcp"
  from_port                    = local.container_port
  to_port                      = local.container_port
  referenced_security_group_id = var.alb_security_group_id
}

resource "aws_ecs_task_definition" "cms" {
  family                   = "${local.name_prefix}-task"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(local.task_cpu)
  memory                   = tostring(local.task_memory)
  network_mode             = "awsvpc"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "cms"
    image     = local.container_image
    essential = true
    portMappings = [{
      containerPort = local.container_port
      hostPort      = local.container_port
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
    secrets = [
      {
        name      = "DATABASE_PASSWORD"
        valueFrom = "${aws_db_instance.cms.master_user_secret[0].secret_arn}:password::"
      }
    ]
  }])

  tags = local.tags
}

resource "aws_ecs_service" "cms" {
  name            = "${local.name_prefix}-service"
  cluster         = aws_ecs_cluster.cms.id
  task_definition = aws_ecs_task_definition.cms.arn
  desired_count   = local.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_service_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.cms.arn
    container_name   = "cms"
    container_port   = local.container_port
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  tags = local.tags
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

