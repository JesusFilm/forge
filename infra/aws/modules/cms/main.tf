locals {
  name_prefix = "forge-cms-${var.environment}"
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

resource "aws_lb" "cms" {
  name                       = substr(replace("${local.name_prefix}-alb", "/[^a-zA-Z0-9-]/", ""), 0, 32)
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [var.alb_security_group_id]
  subnets                    = var.public_subnet_ids
  drop_invalid_header_fields = true
  tags                       = local.tags
}

resource "aws_lb_target_group" "cms" {
  name                 = substr(replace("${local.name_prefix}-tg", "/[^a-zA-Z0-9-]/", ""), 0, 32)
  port                 = var.cms_container_port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30

  health_check {
    enabled             = true
    interval            = 30
    path                = "/"
    port                = "traffic-port"
    healthy_threshold   = 2
    unhealthy_threshold = 5
    timeout             = 5
    matcher             = "200-399"
  }

  tags = local.tags
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.cms.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.cms.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.alb.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.cms.arn
  }
}

resource "aws_ecs_task_definition" "cms" {
  family                   = "${local.name_prefix}-task"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.cms_cpu)
  memory                   = tostring(var.cms_memory)
  network_mode             = "awsvpc"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "cms"
    image     = var.cms_container_image
    essential = true
    portMappings = [{
      containerPort = var.cms_container_port
      hostPort      = var.cms_container_port
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
    environment = [for key, value in var.cms_environment_variables : {
      name  = key
      value = value
    }]
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
  desired_count   = var.cms_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_service_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.cms.arn
    container_name   = "cms"
    container_port   = var.cms_container_port
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.http_redirect, aws_lb_listener.https]
  tags       = local.tags
}

resource "aws_db_subnet_group" "cms" {
  name       = "${local.name_prefix}-db-subnets"
  subnet_ids = var.private_subnet_ids
  tags       = local.tags
}

resource "aws_db_instance" "cms" {
  identifier                    = "${local.name_prefix}-db"
  engine                        = "postgres"
  engine_version                = var.db_engine_version
  instance_class                = var.db_instance_class
  allocated_storage             = var.db_allocated_storage
  db_name                       = var.db_name
  username                      = var.db_username
  manage_master_user_password   = true
  master_user_secret_kms_key_id = var.db_master_user_secret_kms_key_id
  db_subnet_group_name          = aws_db_subnet_group.cms.name
  vpc_security_group_ids        = [var.rds_security_group_id]
  skip_final_snapshot           = var.environment != "prod"
  final_snapshot_identifier     = var.environment == "prod" ? "${local.name_prefix}-final-snapshot" : null
  deletion_protection           = var.environment == "prod"
  multi_az                      = var.db_multi_az
  publicly_accessible           = false
  apply_immediately             = var.environment != "prod"
  storage_encrypted             = true

  tags = local.tags
}

resource "aws_wafv2_web_acl" "alb" {
  name  = "${local.name_prefix}-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-waf-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name_prefix}-waf"
    sampled_requests_enabled   = true
  }

  tags = local.tags
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.cms.arn
  web_acl_arn  = aws_wafv2_web_acl.alb.arn
}
