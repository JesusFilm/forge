resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db-subnets"
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_db_instance" "this" {
  identifier                      = "${var.name_prefix}-db"
  engine                          = "postgres"
  engine_version                  = var.engine_version
  instance_class                  = var.instance_class
  allocated_storage               = var.allocated_storage
  db_name                         = var.db_name
  username                        = var.username
  manage_master_user_password     = true
  master_user_secret_kms_key_id   = var.master_user_secret_kms_key_id
  db_subnet_group_name            = aws_db_subnet_group.this.name
  vpc_security_group_ids          = var.vpc_security_group_ids
  skip_final_snapshot             = var.environment != "prod"
  final_snapshot_identifier       = var.environment == "prod" ? "${var.name_prefix}-final-snapshot" : null
  backup_retention_period         = var.backup_retention_period
  enabled_cloudwatch_logs_exports = var.cloudwatch_logs_exports
  deletion_protection             = var.environment == "prod"
  multi_az                        = var.multi_az
  publicly_accessible             = false
  apply_immediately               = var.environment != "prod"
  storage_encrypted               = true

  tags = var.tags
}
