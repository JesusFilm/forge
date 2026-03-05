# Terraform backend config (shared)

All infra stacks store state in the same S3 bucket; only the state **key** differs.

| Stack       | Key (set in stack's backend-config or init) |
| ----------- | ------------------------------------------- |
| aws (stage) | `infra/aws/stage/terraform.tfstate`         |
| aws (prod)  | `infra/aws/prod/terraform.tfstate`          |
| github      | `infra/github/terraform.tfstate`            |
| vercel      | `infra/vercel/terraform.tfstate`            |

**Usage (per stack):**  
`terraform init -backend-config=../backend-config/shared.hcl -backend-config=<stack-key.hcl> -reconfigure`

Bucket and DynamoDB table are created by `infra/aws/bootstrap-state`. The GitHub Terraform apply role has access to this bucket for all stacks.
