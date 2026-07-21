---
id: feat-274
title: Admin search trace runtime retention default
lane: content-discovery
status: complete
depends_on:
  - feat-272
  - feat-273
blocks: []
---

## Problem

Production Admin search trace writes reached Prisma with an invalid
`rawExpiresAt` date after the retention gate was repaired. The sanitized
diagnostic log reported:

```text
[search] event=trace_record_failed route=graphql outcome=success error_class=PrismaClientValidationError message=Invalid value for argument `rawExpiresAt`
```

This is consistent with the runtime env path returning no value for
`SEARCH_TRACE_RAW_RETENTION_DAYS`, causing the trace writer to compute
`Invalid Date` despite the schema-level default.

## Implementation

- Guard `apps/admin/src/services/search-trace.service.ts` at the trace writer
  boundary with a local `29` day default.
- Accept only integer retention values from `1..29`.
- Add a regression test in
  `apps/admin/src/services/search-trace.service.test.ts` that simulates the
  schema default disappearing at runtime and verifies `rawExpiresAt` remains a
  valid 29-day expiry.

## Verification

- `pnpm --filter @forge/admin test -- search-trace.service.test.ts`
- `pnpm --filter @forge/admin typecheck`
