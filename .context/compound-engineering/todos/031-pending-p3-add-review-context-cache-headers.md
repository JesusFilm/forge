---
status: pending
priority: p3
issue_id: "031"
tags: [code-review, security, caching, manager]
dependencies: []
---

# Add Review Context Cache Headers

## Problem Statement

The authenticated review-context route returns subtitle URLs and job review state without explicit response cache headers. The client fetch uses `cache: "no-store"`, but the route response itself should also prevent intermediary or shared cache retention.

## Findings

- `apps/manager/src/app/api/jobs/[id]/review-context/route.ts:24` returns `NextResponse.json({ reviewContext })` with default headers.
- The payload can include Mux-signed subtitle URLs and CMS subtitle URLs.

## Proposed Solutions

### Option 1: Add `Cache-Control: private, no-store` and `Vary: Cookie`

**Approach:** Set explicit headers on successful and error responses from the route.

**Pros:**

- Small hardening change.
- Matches authenticated dynamic API expectations.

**Cons:**

- None significant.

**Effort:** 15-30 minutes

**Risk:** Low

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:**

- `apps/manager/src/app/api/jobs/[id]/review-context/route.ts`
- `apps/manager/src/app/api/jobs/[id]/review-context/route.test.ts`

## Resources

- Review finding from security review on 2026-04-12.

## Acceptance Criteria

- [ ] Review-context responses set `Cache-Control: private, no-store`.
- [ ] Review-context responses vary by cookie or equivalent auth signal.
- [ ] Route tests assert the cache headers.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Reviewed route response headers and client fetch settings.
- Confirmed response headers are not explicitly set.

**Learnings:**

- Authenticated API routes should set server-side cache headers even when clients request `no-store`.
