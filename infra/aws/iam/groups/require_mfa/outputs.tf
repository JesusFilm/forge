output "policy_arn" {
  description = "ARN of the forge-require-mfa managed policy."
  value       = aws_iam_policy.require_mfa.arn
}
