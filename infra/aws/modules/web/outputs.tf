output "ssm_parameter_prefix" {
  description = "SSM Parameter Store prefix for web application secrets."
  value       = "${local.ssm_parameter_prefix}/"
}

output "ssm_kms_key_arn" {
  description = "KMS key ARN used for web SecureString SSM parameters."
  value       = aws_kms_key.web_ssm.arn
  sensitive   = true
}
