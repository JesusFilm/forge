# infra

Infrastructure as code only.

- **`backend-config/`** — Shared S3 backend config (bucket, region, DynamoDB) for all stacks. Each stack uses the same bucket with a different state key; the GitHub Terraform apply role can access all of them.
- `aws/`: ECS-based backend platform, data stores, storage, networking.
- `github/`: Forge repo config (Actions variables, repo settings, deployment environments); may expand to org management. Reads role ARNs from AWS state. State in same S3 bucket.
- `vercel/`: Next.js project, env vars, domain setup. State in same S3 bucket.
