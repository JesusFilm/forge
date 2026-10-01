---
id: "feat-592"
title: "Apply the September 30 Next.js security patches"
owner: "tataihono"
priority: "P0"
status: "complete"
start_date: "2026-10-02"
duration: 1
depends_on: []
blocks: []
tags: ["infrastructure", "security"]
---

## Scope

Upgrade all seven Next.js apps and matching tooling to 16.3.8. Preserve the existing preload promise patch in both server builds and regenerate the pnpm lockfile.

The [official release](https://nextjs.org/blog/september-2026-security-release) fixes seven vulnerabilities. Version 16.3.7 does not include these fixes; the previously announced critical and additional high issue remain postponed upstream.

## Verification

Verify resolved package versions and patch application, run app lint/typecheck/test checks and representative builds, and require passing PR checks before merging. Record actual results and any environmental limits in the PR.

All seven app lint/type checks passed. Chat and Roadmap production builds passed; Auth, Gateway, Manager, Web, Chat and Admin unit suites were exercised. Two Auth timeout cases passed on focused retry. The Admin Redis fallback test now explicitly mocks failure instead of depending on localhost Redis being unavailable; its focused suite passes. Database-dependent suites remain gated on CI fixtures. Both CJS and ESM preload promise hooks were verified in installed Next.js 16.3.8.
