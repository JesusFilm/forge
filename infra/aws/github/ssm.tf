# GitHub App secrets in SSM (prod only). Terraform creates params; set values in AWS console.
resource "aws_ssm_parameter" "github_app_id" {
  count = var.environment == "prod" ? 1 : 0

  name  = "/forge/github/app_id"
  type  = "String"
  value = "manually set in AWS console"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "github_installation_id" {
  count = var.environment == "prod" ? 1 : 0

  name  = "/forge/github/installation_id"
  type  = "String"
  value = "manually set in AWS console"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "github_app_pem" {
  count = var.environment == "prod" ? 1 : 0

  name  = "/forge/github/app_private_key"
  type  = "SecureString"
  value = "manually set in AWS console"

  lifecycle {
    ignore_changes = [value]
  }
}
