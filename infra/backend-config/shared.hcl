# Shared S3 backend config for all infra stacks (aws, github, vercel).
# Each stack adds its own -backend-config with key = "infra/<stack>/..." so the
# GitHub Terraform apply role can access every stack's state in this bucket.
# Bucket and lock table are created by infra/aws/bootstrap-state.

bucket         = "forge-terraform-state-031374266475"
region         = "us-east-2"
encrypt        = true
dynamodb_table = "forge-terraform-locks"
