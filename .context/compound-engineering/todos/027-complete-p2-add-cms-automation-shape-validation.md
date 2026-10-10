---
status: complete
priority: p2
issue_id: "027"
tags: [code-review, cms, data-integrity, automations]
dependencies: []
---

# Add CMS Automation Shape Validation

## Problem Statement

The Manager create route validates automation drafts, but CMS stores `schedule` and `targetLanguageIds` as opaque JSON. A direct Strapi/admin write can persist malformed automation records that the cron worker later leases and dispatches.

## Findings

- Review found that `apps/cms/src/api/enrichment-automation/content-types/enrichment-automation/schema.json` defines `schedule` and `targetLanguageIds` as JSON fields without a CMS-side validation boundary.
- `apps/cms/src/api/enrichment-automation/services/scheduler.ts` normalizes `targetLanguageIds` to strings but does not validate schedule shape or enforce the target-subtitle one-language invariant before dispatch.
- Manager-side defenses make malformed target subtitle records safe at enqueue time, but invalid CMS records can still be saved and can create failed or misleading run history.

## Proposed Solutions

### Option 1: Add Strapi Lifecycle Validation

**Approach:** Add a lifecycle guard for `enrichment-automation` create/update that validates schedule shape, template values, refresh mode, max cap, and the target-subtitle one-language rule.

**Pros:**

- Blocks invalid records at the canonical data boundary.
- Protects admin/manual writes and GraphQL mutations.

**Cons:**

- Adds CMS validation code that must stay aligned with Manager's contract.

**Effort:** 2-4 hours

**Risk:** Medium

---

### Option 2: Shared Contract Package

**Approach:** Extract the automation draft/schedule validation contract into a shared package consumed by both CMS and Manager.

**Pros:**

- Avoids duplicated validation logic.
- Keeps future template rules consistent.

**Cons:**

- Larger refactor and cross-package dependency discussion.

**Effort:** 1 day

**Risk:** Medium

## Recommended Action

Implemented Option 1: add CMS-side lifecycle validation with a local contract guard and focused validation tests.

## Technical Details

Affected files:

- `apps/cms/src/api/enrichment-automation/content-types/enrichment-automation/schema.json`
- `apps/cms/src/api/enrichment-automation/services/scheduler.ts`
- Potential new lifecycle file under `apps/cms/src/api/enrichment-automation/content-types/enrichment-automation/`

## Resources

- Review finding from workflows-review on 2026-04-12.
- Related Manager validation: `apps/manager/src/features/agents/automation-contract.ts`

## Acceptance Criteria

- [x] CMS rejects malformed automation schedules on create/update.
- [x] CMS rejects target subtitle automations with zero or multiple target languages.
- [x] CMS validation tests cover valid and invalid automation shapes.
- [x] Manager validation remains aligned with CMS validation.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Captured workflows-review finding about opaque CMS JSON fields and scheduler dispatch.
- Confirmed Manager guards protect enqueue, but CMS can still persist malformed records.

**Learnings:**

- The safest follow-up is to validate at the CMS persistence boundary rather than relying only on Manager API validation.

### 2026-04-12 - Implemented

**By:** Codex

**Actions:**

- Added CMS automation validation and lifecycle guards for create/update.
- Added red/green validation coverage for invalid schedule shape, invalid target language payload shape, and target-subtitle one-language enforcement.
- Verified with `pnpm --filter @forge/cms test -- src/api/enrichment-automation/services/validation.test.ts src/api/enrichment-automation/services/scheduler.test.ts`, `pnpm --filter @forge/cms test`, `pnpm --filter @forge/cms typecheck`, and root `pnpm test`.

**Learnings:**

- The lifecycle guard keeps opaque CMS JSON fields from bypassing Manager's create-time contract.
