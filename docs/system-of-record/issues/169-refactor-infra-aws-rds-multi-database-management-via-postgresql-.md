---
artifactType: issue
issueNumber: 169
issueTitle: "refactor(infra-aws): RDS multi-database management via postgresql provider and SSM tunnel"
issueUrl: "https://github.com/JesusFilm/forge/issues/169"
state: "CLOSED"
closedAt: "2026-03-09T00:26:43Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #169

## Background

The Forge repo uses a single-stack Terraform layout under `infra/aws/` with environment selection via `-var="environment=..."`. RDS is currently inside `infra/aws/modules/database/main.tf` as a shared platform instance using `manage_master_user_password = true` (AWS Secrets Manager auto-rotation). The VPC, subnets, security groups, NAT gateway, and ALB live in `infra/aws/modules/platform/main.tf`. GitHub Actions applies via OIDC roles with per-environment GitHub environments. State is in S3 with DynamoDB locking.

This issue adds the `cyrilgdn/postgresql` provider to manage databases and roles **inside** the RDS instance, and the infrastructure changes needed for GitHub Actions to reach the private RDS instance (SSM bastion tunnel).

### Architecture

```
GitHub Actions (terraform-apply.yml)
  │
  ├── OIDC → forge-github-actions-terraform-apply-{env}
  │
  ├── aws ssm start-session (port forward localhost:5432 → RDS:5432)
  │       │
  │       ▼
  │   Bastion EC2 t3.nano (private subnet, SSM agent, no SSH key)
  │       │
  │       ▼
  │   forge-platform-{env}-db  (existing RDS, private subnet)
  │       ├── cms         (existing — Strapi CMS)
  │       ├── app2_db     (new — postgresql_database)
  │       └── app3_db     (new — postgresql_database)
  │
  └── terraform apply (postgresql provider via localhost:5432 tunnel)
```

## Expected outcome

- `cyrilgdn/postgresql` provider added, connected via SSM tunnel in CI
- Bastion EC2 (t3.nano, private subnet, SSM-only, no SSH key)
- `application_databases` variable to declaratively add/remove app databases
- Each app gets: `postgresql_role`, `postgresql_database`, `postgresql_grant` (scoped), `aws_ssm_parameter` with `DATABASE_URL`
- GitHub Actions workflows updated to establish SSM tunnel before plan/apply
- IAM roles updated with SSM session and SecretsManager read permissions

## Acceptance criteria

- [ ] `cyrilgdn/postgresql` provider in `infra/aws/providers.tf` with connection variables
- [ ] `infra/aws/databases.tf` manages app databases via `for_each` on `application_databases` var
- [ ] Bastion EC2 in `infra/aws/modules/platform/bastion.tf` (private subnet, IMDSv2, SSM-only)
- [ ] Security group rule allowing bastion → RDS on 5432
- [ ] `scripts/ssm-tunnel.sh` for portable SSM port-forwarding
- [ ] `terraform-apply.yml` installs SSM plugin, fetches RDS password, starts tunnel, passes `pg_*` vars
- [ ] `terraform-plan.yml` updated similarly for plan job
- [ ] IAM policy updated: SSM session + SecretsManager read for apply role
- [ ] Root `outputs.tf` exposes `bastion_instance_id`, `db_instance_endpoint`, `db_master_secret_arn`
- [ ] `terraform fmt -check -recursive` passes
- [ ] Bootstrap sequence documented (first apply creates AWS resources, second apply creates PG resources)

## Possible solution(s)

### File changes (all paths relative to repo root)

1. **`infra/aws/providers.tf`** — Add `cyrilgdn/postgresql ~> 1.25` to `required_providers`; add `provider "postgresql"` block with variables
2. **`infra/aws/variables.tf`** — Add `pg_host`, `pg_port`, `pg_sslmode`, `pg_admin_username`, `pg_admin_password`, `application_databases` variables
3. **`infra/aws/databases.tf`** (new) — `postgresql_role`, `postgresql_database`, `postgresql_grant` (revoke public + grant app), `aws_ssm_parameter` for DATABASE_URL, all via `for_each` on `application_databases`
4. **`infra/aws/modules/platform/bastion.tf`** (new) — Security group, IAM role + instance profile (AmazonSSMManagedInstanceCore), AMI lookup (AL2023), `aws_instance` (t3.nano, private subnet, IMDSv2), ingress rule for bastion→RDS
5. **`infra/aws/modules/platform/outputs.tf`** — Add `bastion_instance_id`, `rds_security_group_id`
6. **`infra/aws/github/terraform.tf`** — Add SSM session + SecretsManager read statements to apply policy
7. **`scripts/ssm-tunnel.sh`** (new) — Portable SSM port-forwarding script with health check
8. **`.github/workflows/terraform-apply.yml`** — SSM plugin install, tunnel setup, `pg_*` vars to apply
9. **`.github/workflows/terraform-plan.yml`** — Same tunnel setup for plan job
10. **`infra/aws/outputs.tf`** — Expose `bastion_instance_id`, `db_instance_endpoint`, `db_master_secret_arn`

### Security notes

- No public access; RDS and bastion in private subnets, only SSM path
- No SSH keys on bastion; IMDSv2 enforced
- Scoped roles: each app role can only access its own database
- Master password fetched from Secrets Manager at runtime, masked in logs
- SSM session scoped to instances tagged `forge-platform-*-bastion`
- SSL in production: app connections use `sslmode=require`; tunnel uses `disable` (SSM encrypts)

### Bootstrap sequence

1. First apply creates AWS resources (bastion, RDS). `postgresql_*` resources fail (expected — no tunnel yet).
2. Second apply establishes tunnel, PG provider connects, databases/roles created.
3. Subsequent applies work in single run. Use `-target=module.platform` on first run to skip PG resources.

## References

- Epic #67
- PR #135 (original review)
- PR #285 (closed — previous approach, database module extraction)
- `cyrilgdn/postgresql` provider: https://registry.terraform.io/providers/cyrilgdn/postgresql/latest

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
