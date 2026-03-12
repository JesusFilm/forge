output "dev_ssm_parameter_prefix" {
  description = "SSM Parameter Store prefix for web dev secrets."
  value       = "${local.dev_ssm_parameter_prefix}/"
}
