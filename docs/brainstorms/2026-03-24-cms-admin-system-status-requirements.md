---
date: 2026-03-24
topic: cms-admin-system-status
---

# CMS Admin System Status Panel

## Problem Frame

Core sync status and data snapshots are only accessible via raw API calls. Developers and admins working in the Strapi admin have no visibility into whether sync is running, when it last completed, or how to download the latest backup — they must leave the admin and hit endpoints manually.

## Requirements

- R1. Add a "System Status" page under the Strapi admin Settings section
- R2. Display core sync status: last run timestamp, current state (idle/running/error), current phase name if running, and error summary if failed
- R3. Show live sync progress with record counts during sync — e.g., "Videos: 142/500 (28%)" — updating via polling every few seconds
- R4. After sync completes, show per-phase result summary: created, updated, soft-deleted, and error counts for each phase
- R5. Display data snapshot status: last snapshot timestamp, file size, and a pre-signed download link for the latest backup
- R6. Provide a "Sync Now" button that triggers a core sync, with visual feedback (loading/success/error)
- R7. Provide a "Create Snapshot" button that triggers a new data snapshot, with visual feedback
- R8. Both trigger buttons should be disabled while their respective operation is already running
- R9. Auto-poll the status endpoint every few seconds while a sync or snapshot is in progress; stop polling when idle
- R10. Restrict the page to admin users (Strapi super-admin role)

## Success Criteria

- Admins can see live sync progress (phase + record counts) without leaving the Strapi admin
- Admins can download the latest backup with one click from the settings page
- Admins can trigger sync and snapshot on demand

## Scope Boundaries

- No websocket/SSE — polling is sufficient
- No sync history or logs viewer — just current/last-run status
- No notifications or alerts — status is pull-based (visit the page to see it)

## Key Decisions

- **Settings section over sidebar**: Keeps the page tucked away for admin-only use, avoids cluttering the sidebar for content editors
- **Local plugin pattern**: Strapi v5 local plugin is the standard way to add settings pages; avoids modifying core admin code
- **Live progress requires backend changes**: Currently only the videos phase fetches a total count from the gateway. Other phases (languages, countries, keywords, variants) will need count queries added, and the status endpoint must expose in-progress counts — not just final results

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Needs research] How to add total count queries for languages, countries, keywords, and variants phases in the gateway GraphQL API
- [Affects R3][Technical] How to expose in-progress phase counts through the status endpoint (currently only returns final results after completion)
- [Affects R5][Needs research] What is the exact shape of the data-snapshot status response? Confirm download URL generation.
- [Affects R1][Needs research] What is the Strapi v5 local plugin structure for registering a Settings page? Research the admin extension API.

## Next Steps

-> `/ce:plan` for structured implementation planning
