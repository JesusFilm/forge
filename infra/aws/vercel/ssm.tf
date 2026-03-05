# Vercel API token in SSM (prod only). Terraform creates param; set value in AWS console.
resource "aws_ssm_parameter" "api_token" {
  count = var.environment == "prod" ? 1 : 0

  name  = "/forge/vercel/api_token"
  type  = "SecureString"
  value = "manually set in AWS console"

  lifecycle {
    ignore_changes = [value]
  }
}
