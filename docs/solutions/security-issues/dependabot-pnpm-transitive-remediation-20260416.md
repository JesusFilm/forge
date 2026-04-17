---
title: Dependabot pnpm Transitive Remediation
date: 2026-04-16
category: security-issues
module: monorepo-dependencies
problem_type: security_issue
component: tooling
symptoms:
  - Dependabot reports security alerts against pnpm-lock.yaml while grouped update PRs fail CI.
  - pnpm audit may still report a low-severity advisory when the package has no patched version.
root_cause: config_error
resolution_type: dependency_update
severity: medium
tags: [dependabot, pnpm, overrides, audit, security]
---

# Dependabot pnpm Transitive Remediation

## Problem

Dependabot grouped updates can bundle security fixes with unrelated major
framework and toolchain upgrades. When those broad PRs fail CI, remediate the
vulnerable lockfile paths directly instead of accepting every grouped update.

## Symptoms

- Open Dependabot alerts point at `pnpm-lock.yaml`.
- Grouped Dependabot PRs include risky unrelated majors such as framework,
  compiler, lint, or mobile SDK upgrades.
- `pnpm audit --audit-level low --json` can exit non-zero even after all
  fixable advisories are remediated, if a remaining advisory has no patched
  version.

## What Didn't Work

- Taking the full grouped Dependabot PR scope made CI harder to stabilize
  because it mixed security patching with major upgrade migrations.
- A global override can break unrelated tools. For example, overriding every
  `ajv` or `brace-expansion` version changes consumers that still require an
  older major.
- Pinning a package to the same vulnerable latest version is not remediation.
  If an advisory reports `patched_versions: <0.0.0`, leave the residual risk
  documented rather than adding a no-op override.

## Solution

Use three levels of dependency remediation, in this order:

1. Patch or minor upgrade the direct parent package when the current major line
   supports it.
2. Add a narrowly scoped pnpm override for a vulnerable transitive package when
   no parent package has released a compatible fixed range.
3. Document residual advisories that have no patched version, including the
   exact dependency path and severity.

Keep overrides scoped by major when older consumers remain in the graph:

```json
{
  "pnpm": {
    "overrides": {
      "ajv@8": "8.18.0",
      "brace-expansion@4": "5.0.5",
      "minimatch@3": "3.1.5",
      "minimatch@9": "9.0.7",
      "minimatch@10": "10.2.5"
    }
  }
}
```

For residual advisories, record why they remain. In this remediation, the only
remaining audit finding was `elliptic@6.6.1` through:

```text
apps/cms > @strapi/plugin-users-permissions > jwk-to-pem > elliptic
```

The advisory had no patched version, so a pnpm override could not reduce risk.

## Why This Works

Direct compatible upgrades let package owners resolve their own dependency
ranges. Narrow pnpm overrides address vulnerable transitive packages without
forcing unrelated major versions into older consumers. Documenting unfixable
advisories prevents future agents from mistaking a known residual risk for an
unfinished remediation.

## Prevention

- Inspect grouped Dependabot PRs before adopting them wholesale.
- Prefer major-scoped override keys such as `yaml@1` and `yaml@2` when multiple
  major lines are present.
- Run `pnpm install --lockfile-only` after changing dependency metadata; do not
  hand-edit `pnpm-lock.yaml`.
- Run `pnpm why <package> --recursive` for every residual audit finding.
- Remove overrides that only pin the vulnerable package to the same latest
  vulnerable version.

## Related Issues

- `docs/roadmap/platform/feat-102-dependabot-security-remediation.md`
