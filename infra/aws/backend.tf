# bucket, key, region, dynamodb_table come from -backend-config (e.g. infra/backend-config/shared.hcl and stack-specific key).
terraform {
  backend "s3" {}
}
