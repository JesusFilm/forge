# Application databases inside the shared CMS RDS instance.
# Runs from CodeBuild in VPC with direct RDS access.
#
# The CMS "cms" database already exists (created by aws_db_instance).
# This root manages additional application databases and their scoped roles.

resource "postgresql_role" "app" {
  for_each = var.application_databases

  name            = each.value.username
  login           = true
  password        = each.value.password
  create_database = false
  create_role     = false
}

resource "postgresql_database" "app" {
  for_each = var.application_databases

  name              = each.value.db_name
  owner             = postgresql_role.app[each.key].name
  template          = "template0"
  encoding          = "UTF8"
  lc_collate        = "en_US.UTF-8"
  lc_ctype          = "en_US.UTF-8"
  allow_connections = true
}

resource "postgresql_grant" "revoke_public" {
  for_each = var.application_databases

  database    = postgresql_database.app[each.key].name
  role        = "public"
  schema      = "public"
  object_type = "database"
  privileges  = []
}

resource "postgresql_grant" "app_connect" {
  for_each = var.application_databases

  database    = postgresql_database.app[each.key].name
  role        = postgresql_role.app[each.key].name
  schema      = "public"
  object_type = "database"
  privileges  = ["CREATE", "CONNECT", "TEMPORARY"]
}

resource "aws_ssm_parameter" "app_db_connection" {
  for_each = var.application_databases

  name   = "/forge/aws/${each.key}/${var.environment}/DATABASE_URL"
  type   = "SecureString"
  key_id = var.ssm_kms_key_arn
  value = format(
    "postgresql://%s:%s@%s:%s/%s?sslmode=require",
    each.value.username,
    each.value.password,
    var.pg_host,
    "5432",
    each.value.db_name
  )

  tags = var.tags
}
