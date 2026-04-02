---
id: "feat-027"
title: "Infrastructure Evolution (AWS → Railway)"
owner: "tataihono"
priority: "P0"
status: "complete"
start_date: "2026-03-03"
duration: 28
depends_on: []
blocks: []
tags:
  - "infrastructure"
  - "railway"
---

## Problem

The platform needed reliable deployment infrastructure. Initially provisioned on AWS (ECS, ECR, RDS, S3, Terraform), the complexity of managing containers, IAM, and Terraform state was disproportionate to team size. Railway offered dramatically simpler deployment with the same reliability guarantees.

## Entry Points — Read These First

1. `apps/cms/railway.toml` — CMS Railway deployment configuration (if present)
2. `apps/web/railway.toml` — Web app Railway configuration
3. `apps/roadmap/railway.toml` — Roadmap app Railway configuration
4. `infra/` — legacy AWS Terraform code (superseded but still in repo)

## Grep These

- `railway.toml` in project root — all Railway deployment configs
- `railpack` in `apps/` — Railpack builder usage
- `RAILWAY_` in `apps/` — Railway environment variable references
- `terraform` in `infra/` — legacy AWS infrastructure code

## What Was Built

**Phase 1: AWS Infrastructure (Mar 3 – Mar 16)**

1. Provisioned ECS for CMS, ECR for Docker images, RDS PostgreSQL, S3/CloudFront for uploads.
2. Built CI/CD pipeline for Docker builds and ECS deployments.
3. Managed SSM secrets, KMS encryption, IAM admin groups with MFA.
4. ~40 commits of Terraform/ECS/IAM configuration.

**Phase 2: Railway Migration (Mar 16 – Mar 31)**

1. Migrated all apps (CMS, web, manager, roadmap) to Railway with Railpack builder.
2. Moved secrets management from AWS SSM to Doppler.
3. Simplified deployment — no more Docker builds, ECS rolls, or Terraform state.
4. Added Cloudflare for DNS, WAF, and Authenticated Origin Pulls in front of Railway.

## Verification

- All apps deploy successfully to Railway
- `ls infra/` — legacy AWS code exists but is no longer the deploy target
- Cloudflare DNS resolves to Railway services
