---
id: "feat-414"
title: "Production playlist-sharing control plane"
owner: "unassigned"
priority: "P0"
status: "not-started"
start_date: "2026-08-22"
duration: 5
depends_on:
  - "feat-411"
blocks: []
tags:
  - "platform"
  - "security"
  - "privacy"
  - "railway"
  - "cloudflare"
  - "ugc"
---

## Problem

Playlist code fails closed locally, but public sharing is not production-safe
until lifecycle renewal, edge/origin isolation, telemetry redaction, sensitive
report purging, and backup expiry run continuously with recorded evidence.
A raw capability retained at any provider would turn an unlisted URL into a
recoverable bearer secret.

## Entry Points — Read These First

1. `apps/auth/src/scripts/run-consumer-lifecycle.ts` and
   `apps/auth/src/services/consumer-lifecycle-outbox.service.ts` — reconciliation,
   leases, and delivery worker.
2. `apps/admin/src/app/api/internal/user-playlists/lifecycle/route.ts` and
   `apps/admin/src/services/consumer-lifecycle.service.ts` — signed lifecycle
   ingestion and five-minute fail-closed lease.
3. `apps/web/src/proxy.ts` and `apps/web/src/lib/user-playlist-public-boundary.ts`
   — public capability ingress and response controls.
4. `apps/web/src/instrumentation.ts` — Web telemetry initialization boundary.
5. `apps/admin/src/scripts/purge-user-playlist-report-sensitive-material.ts` —
   encrypted detail and keyed-IP purge entry point.
6. `apps/admin/src/services/user-playlist-capability.ts` — versioned capability
   lookup digest and ciphertext key rings.
7. `docs/runbooks/user-playlist-sharing.md` — operator gates and rollback.

## Grep These

- `consumer_lifecycle_run|leaseExpiresAt|deliverBatch`.
- `playlists/|X-Robots-Tag|Referrer-Policy|no-store`.
- `datadog|rum|google analytics|gtag` in `apps/web/src`.
- `user_playlist_report_sensitive_material_purge|detailDeleteAfter|reporterDigestDeleteAfter`.
- `capabilityDigestKeyId|capabilityCiphertextKeyId|capabilityNonce`.

## What To Build

1. Deploy lifecycle reconciliation/delivery as an always-on Railway worker or
   schedule with a maximum two-minute interval; add liveness, delivery-lag,
   lease-expiry, and failure alerts so five-minute Admin leases stay renewed.
2. Restrict production Web/Admin origins to approved Cloudflare ingress and
   prove direct-origin requests cannot bypass edge rate limits or headers.
3. Configure Cloudflare request/Logpush, Railway proxy/access logs, origin logs,
   and Datadog/APM processors to exclude or irreversibly redact playlist path
   capabilities before storage.
4. Run a permissioned sentinel through create, copy, view, rotate, and restore;
   record zero raw-token matches in Cloudflare, Railway, application/APM,
   browser RUM, and Google Analytics data. Keep only nonsensitive receipts.
5. Schedule the report-sensitive-material purge daily, alert on missed/failed
   runs, and prove raw detail is absent before 30 days and keyed IP digests
   before seven days.
6. Restore a controlled backup and record evidence that raw report detail and
   IP digest material expire from every backup within 35 days.
7. Add a bounded, resumable capability re-key command that recomputes lookup
   digests and re-encrypts recoverable ciphertext under the active HMAC/AES key
   IDs with compare-and-swap updates, dry-run counts, checkpoints, and
   idempotent retries. Before retiring an old key, prove no live row or retained
   in-policy backup depends on it and record authorized reveal/lookup evidence
   from the replacement keys.

## Constraints

- Keep anonymous public reads disabled until every control and sentinel query
  is green; a provider that cannot redact the path is a launch blocker.
- Never place the sentinel capability in tickets, logs, metrics, screenshots,
  alert labels, CI artifacts, or committed evidence.
- Do not weaken dynamic/no-store/no-referrer/noindex behavior or rely on
  application logging alone to compensate for provider access logs.
- Never retire an HMAC/AES key from Railway before the re-key inventory and
  oldest retained backup both prove that key is no longer required.
- Production changes follow the normal PR-to-main and reviewed platform
  configuration flow; no direct local deployment.

## Verification

- Observe at least three consecutive lifecycle intervals at or below two
  minutes with zero expired eligible-owner projections and tested failure
  alerts.
- Probe Cloudflare and direct origins, confirming only approved ingress reaches
  Web/Admin and public responses retain security/crawler headers.
- Query every named telemetry provider for the permissioned sentinel and retain
  a dated, access-controlled zero-match receipt, including RUM and GA.
- Backdate test report material, run the daily purge, and prove detail/IP
  deletion plus idempotent reruns and missed-run alerting.
- Restore the oldest in-policy and first out-of-policy backups and record the
  35-day deletion boundary before enabling public reads.
- Run the re-key command in dry-run and bounded execution modes; prove restart
  safety, zero old-key live rows, successful lookup/reveal after migration, and
  a restore from the oldest retained backup before recording key retirement.
