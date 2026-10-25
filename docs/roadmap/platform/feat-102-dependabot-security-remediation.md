---
id: "feat-102"
title: "Dependabot Security Remediation"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-04-16"
duration: 1
depends_on: []
blocks: []
tags:
  - "infrastructure"
  - "security"
---

## Problem

GitHub Dependabot reports unresolved npm security alerts against `pnpm-lock.yaml`.
The open grouped Dependabot PRs include broad major framework and toolchain updates
that fail CI, so the remediation needs a narrower lockfile-focused path.

## Entry Points - Read These First

1. `package.json` - root scripts, dev tooling versions, and pnpm override policy.
2. `pnpm-lock.yaml` - canonical resolved dependency graph.
3. `apps/*/package.json` - direct package constraints that may need patch or minor updates.
4. `packages/*/package.json` - shared package constraints consumed by apps.
5. `.github/workflows/ci.yml` - PR validation jobs that must stay green for dependency-only changes.

## Grep These

1. `rg -n "\"pnpm\"|\"overrides\"|\"resolutions\"" package.json apps packages`
2. `pnpm audit --audit-level low --json`
3. `gh api repos/JesusFilm/forge/dependabot/alerts --paginate --jq '.[] | select(.state=="open") | {number,package:.dependency.package.name,manifest:.dependency.manifest_path,severity:.security_advisory.severity,patched:.security_vulnerability.first_patched_version.identifier}'`

## What To Build

1. Remediate vulnerable transitive packages in `pnpm-lock.yaml` without taking unrelated major framework/toolchain upgrades.
2. Prefer direct patch/minor dependency updates when they are already compatible with the current package major.
3. Use root pnpm overrides only for vulnerable transitive packages where the parent package has not yet released a compatible fixed range.
4. Keep Dependabot PR scope separated from application feature changes.

## Constraints

1. Do not upgrade Expo SDK, Prisma major, ESLint major, TypeScript major, Vitest major, or React Native major in this ticket.
2. Do not hand-edit generated dependency metadata in `pnpm-lock.yaml`; regenerate with pnpm.
3. Do not modify `apps/mobile/`; use `apps/mobile-v2` only for new mobile feature work. Dependency metadata may still reference existing package manifests when required by the monorepo lockfile.
4. Do not relax CI checks to make dependency updates pass.

## Verification

1. `pnpm install --lockfile-only`
2. `pnpm audit --audit-level low --json`
3. `pnpm format:check`
4. `pnpm lint`
5. `pnpm test`
6. `pnpm build`
