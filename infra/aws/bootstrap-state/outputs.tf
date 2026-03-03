output "state_bucket_name" {
  description = "S3 bucket name used for Terraform remote state."
  value       = aws_s3_bucket.terraform_state.bucket
}

output "lock_table_name" {
  description = "DynamoDB table name used for Terraform state locking."
  value       = aws_dynamodb_table.terraform_lock.name
}

output "kms_key_arn" {
  description = "KMS key ARN used to encrypt Terraform state resources."
  value       = aws_kms_key.terraform_state.arn
}

output "deny_bootstrap_state_mutation_policy_arn" {
  description = "IAM policy ARN to attach to CI roles to block backend mutations."
  value       = aws_iam_policy.deny_bootstrap_state_mutation.arn
}
