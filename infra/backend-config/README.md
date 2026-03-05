# Terraform backend config (shared)

All infra stacks store state in the same S3 bucket; only the state **key** differs.

| Stack       | Key (set in stack's backend-config or init) |
| ----------- | ------------------------------------------- |
| aws (stage) | `infra/aws/stage/terraform.tfstate`         |
| aws (prod)  | `infra/aws/prod/terraform.tfstate`          |
| github      | `infra/github/terraform.tfstate`            |
| vercel      | `infra/vercel/terraform.tfstate`            |

**Usage (per stack):** from the stack directory (e.g. `infra/aws` or `infra/github`):

- **infra/aws:** `terraform init -backend-config=../backend-config/shared.hcl -backend-config=backend-config/stage.hcl` (or `prod.hcl`) `-reconfigure`
- **infra/github / infra/vercel:** `terraform init -backend-config=../backend-config/shared.hcl -backend-config=backend-config.hcl -reconfigure`

Bucket and DynamoDB table are created by `infra/aws/bootstrap-state`. The GitHub Terraform apply (and state) roles have access to this bucket for all stacks.
