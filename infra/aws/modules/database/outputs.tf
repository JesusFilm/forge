output "address" {
  description = "RDS instance hostname."
  value       = aws_db_instance.this.address
  sensitive   = true
}

output "port" {
  description = "RDS instance port."
  value       = aws_db_instance.this.port
}

output "master_secret_arn" {
  description = "Secrets Manager ARN for the RDS-managed master user secret."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
  sensitive   = true
}
