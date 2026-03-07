output "ssm_kms_key_arn" {
  description = "KMS key ARN for Vercel SecureString SSM parameters."
  value       = try(aws_kms_key.vercel_ssm[0].arn, null)
  sensitive   = true
}
