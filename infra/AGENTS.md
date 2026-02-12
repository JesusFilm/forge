# Infra Agent Guide

Scope: `infra/*`.

## Rules

- Terraform-only changes.
- No manual console assumptions.
- Keep modules explicit and environment inputs parameterized.
- App code must not contain environment-specific behavior.
