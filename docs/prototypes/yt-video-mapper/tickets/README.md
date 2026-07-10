---
title: "yt-video-mapper prototype tickets"
---

# yt-video-mapper Prototype Tickets

These tickets track follow-up implementation slices for the yt-video-mapper
prototype. They intentionally live outside `docs/roadmap/` so they do not appear
on the roadmap website.

Use these for implementation slices after the backend scaffold lands. Keep
roadmap tickets broad; keep this folder practical and close to the mapper code.

## Queue

| ID                                                             | Status   | Priority | Title                                        |
| -------------------------------------------------------------- | -------- | -------- | -------------------------------------------- |
| [YTM-001](./ytm-001-deploy-service-and-database.md)            | complete | P1       | Deploy service and database                  |
| [YTM-002](./ytm-002-admin-flat-catalog-projection.md)          | complete | P1       | Admin flat catalog projection                |
| [YTM-003](./ytm-003-mapper-catalog-sync.md)                    | complete | P1       | Mapper catalog sync                          |
| [YTM-004](./ytm-004-official-media-signature-indexing.md)      | complete | P1       | Official media signature indexing            |
| [YTM-005](./ytm-005-replace-placeholders-with-real-matcher.md) | complete | P1       | Replace placeholders with real matcher       |
| [YTM-006](./ytm-006-evaluation-harness-and-thresholds.md)      | todo     | P1       | Evaluation harness and confidence thresholds |
| [YTM-007](./ytm-007-ops-hardening.md)                          | todo     | P2       | Operations hardening                         |
| [YTM-008](./ytm-008-model-assisted-review-research.md)         | backlog  | P3       | Model-assisted review research               |
| [YTM-009](./ytm-009-queued-job-expiry-cleaner.md)              | complete | P1       | Expire abandoned queued match jobs           |
| [YTM-010](./ytm-010-prisma-migration-deploy-safety.md)         | complete | P1       | Guard Prisma migration deploy safety         |
