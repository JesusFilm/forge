---
status: complete
priority: p1
issue_id: "005"
tags:
  - manager
  - cms
  - infrastructure
  - mock
dependencies: []
---
# Manager Single-Process Mock CMS Mode

## Execution Checklist

- [x] Unit 1: Add data-mode env gating and the gateway seam
- [x] Unit 2: Replace Strapi auth with gateway-backed live/mock auth
- [x] Unit 3: Port Manager reads to the gateway and seed honest demo data
- [x] Unit 4: Port job and automation mutations to demo-safe mock writes
- [x] Unit 5: Final validation, doc alignment, screenshots, PR hygiene, and plan status updates

## Validation Checklist

- [x] Red/Green TDD evidence captured through focused failing then passing tests
- [x] `pnpm --filter @forge/manager test`
- [x] `pnpm --filter @forge/manager lint`
- [x] `pnpm --filter @forge/manager typecheck`
- [x] Standalone build/start smoke in mock mode
- [x] User-like browser smoke with screenshots/proof
- [x] Update plan checkboxes in `docs/plans/2026-04-22-feat-manager-single-process-mock-cms-mode-plan.md`
- [x] Update roadmap status when complete
- [ ] Commit, push, and PR with monitoring/validation section
