locals {
  name_prefix = "forge-cms-${var.environment}"
  tags = merge(var.tags, {
    Environment = var.environment
    ManagedBy   = "terraform"
    Service     = "platform"
  })
  alb_domain_name    = var.environment == "prod" ? "cms.${var.delegated_zone_name}" : "cms.stage.${var.delegated_zone_name}"
  assets_domain_name = var.environment == "prod" ? "assets.${var.delegated_zone_name}" : "assets.stage.${var.delegated_zone_name}"
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "platform" {
  cidr_block           = "10.${var.environment == "prod" ? 30 : 31}.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-vpc"
  })
}

resource "aws_internet_gateway" "platform" {
  vpc_id = aws_vpc.platform.id
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-igw"
  })
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.platform.id
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  cidr_block              = cidrsubnet(aws_vpc.platform.cidr_block, 8, count.index)
  map_public_ip_on_launch = true
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-public-${count.index + 1}"
    Tier = "public"
  })
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.platform.id
  availability_zone = data.aws_availability_zones.available.names[count.index]
  cidr_block        = cidrsubnet(aws_vpc.platform.cidr_block, 8, count.index + 10)
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-private-${count.index + 1}"
    Tier = "private"
  })
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-nat-eip"
  })
}

resource "aws_nat_gateway" "platform" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-nat"
  })
  depends_on = [aws_internet_gateway.platform]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.platform.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.platform.id
  }
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-public-rt"
  })
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.platform.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.platform.id
  }
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-private-rt"
  })
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "ALB ingress security group"
  vpc_id      = aws_vpc.platform.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-alb-sg"
  })
}

resource "aws_security_group" "ecs_service" {
  name        = "${local.name_prefix}-ecs-sg"
  description = "CMS ECS service security group"
  vpc_id      = aws_vpc.platform.id

  ingress {
    description     = "ALB to CMS container"
    from_port       = var.cms_container_port
    to_port         = var.cms_container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-ecs-sg"
  })
}

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds-sg"
  description = "CMS postgres security group"
  vpc_id      = aws_vpc.platform.id

  ingress {
    description     = "ECS to Postgres"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_service.id]
  }

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-rds-sg"
  })
}

module "cms" {
  source = "../cms"

  environment = var.environment
  aws_region  = var.aws_region
  tags        = var.tags

  cms_container_image              = var.cms_container_image
  cms_container_port               = var.cms_container_port
  cms_desired_count                = var.cms_desired_count
  cms_cpu                          = var.cms_cpu
  cms_memory                       = var.cms_memory
  cms_environment_variables        = var.cms_environment_variables
  db_name                          = var.db_name
  db_username                      = var.db_username
  db_instance_class                = var.db_instance_class
  db_allocated_storage             = var.db_allocated_storage
  db_engine_version                = var.db_engine_version
  db_multi_az                      = var.db_multi_az
  waf_rate_limit                   = var.waf_rate_limit
  route53_zone_id                  = var.route53_zone_id
  db_master_user_secret_kms_key_id = var.db_master_user_secret_kms_key_id
  alb_domain_name                  = local.alb_domain_name
  vpc_id                           = aws_vpc.platform.id
  public_subnet_ids                = [for subnet in aws_subnet.public : subnet.id]
  private_subnet_ids               = [for subnet in aws_subnet.private : subnet.id]
  alb_security_group_id            = aws_security_group.alb.id
  ecs_service_security_group_id    = aws_security_group.ecs_service.id
  rds_security_group_id            = aws_security_group.rds.id
}

module "assets" {
  source = "../assets"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  environment                 = var.environment
  tags                        = var.tags
  assets_bucket_name_override = var.assets_bucket_name_override
  route53_zone_id             = var.route53_zone_id
  assets_domain_name          = local.assets_domain_name
}
