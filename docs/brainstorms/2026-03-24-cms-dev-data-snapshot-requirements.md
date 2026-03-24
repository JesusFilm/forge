---
date: 2026-03-24
topic: cms-dev-data-snapshot
---

# CMS Dev Data Snapshot

## Problem Frame

The gateway-sync process takes 4+ hours to populate a local CMS database with video, language, and country data from the JesusFilm API Gateway. Every developer who sets up or resets their local environment pays this cost. Developers need a way to pull a pre-synced snapshot and restore it locally in minutes, not hours.

An earlier proposal used GitHub Actions to run `pg_dump` externally, requiring production database credentials in GitHub Secrets and Railway S3 credentials duplicated across systems. This was rejected in favor of having Strapi own the process — it already has database access and S3 credentials.

## Requirements

- R1. **Nightly snapshot production** — After the existing gateway-sync cron completes, Strapi produces a compressed PostgreSQL dump of content data and uploads it to Railway S3.
- R2. **Video, language, and country tables only** — The snapshot includes only tables related to videos, languages, and countries (as defined by the gateway-sync scope). No admin users, API tokens, permissions, roles, or other Strapi system data.
- R3. **Secret-protected download endpoint** — Strapi exposes an API endpoint that returns a pre-signed S3 URL to the latest snapshot. The endpoint is protected by a Doppler-managed secret (not Strapi admin auth).
- R4. **Developer import command** — A local CLI command (e.g. `pnpm data-import`) downloads the latest snapshot via the endpoint and restores it into the developer's local PostgreSQL database.
- R5. **Manual trigger** — A separate endpoint allows manually triggering a new snapshot (same auth), following the existing gateway-sync trigger pattern.
- R6. **Production safety** — The import command refuses to run when `NODE_ENV=production`.

## Success Criteria

- A developer with a fresh local PostgreSQL database can run one command and have a working CMS dataset in under 5 minutes.
- No production database credentials leave the Railway/Strapi service boundary.
- No new secrets are needed in GitHub Actions.

## Scope Boundaries

- **Not disaster recovery** — Railway's native volume backups handle that.
- **Not a full database clone** — User/auth data is deliberately excluded.
- **Not automated dev environment refresh** — Developers run the import manually when they need it.
- **No JSON export fallback** — pg_dump is the only export format. Developers need local PostgreSQL.

## Key Decisions

- **Strapi owns the export** — No external CI/CD. Strapi already has DB + S3 access. Follows the gateway-sync cron/service/endpoint pattern.
- **pg_dump with table allowlist** — Uses `pg_dump -t` to include only named content tables. Safer than exclude-based approach; new system tables never leak.
- **Hardcoded table list** — Explicit array in the export service. Updated when content types are added (infrequent). Easy to audit.
- **Doppler-managed secret for auth** — Added to the `forge-cms / dev` Doppler config. Pulled via `pnpm fetch-secrets`. Consistent with existing env var workflow.

## Dependencies / Assumptions

- Production Railway container has `pg_dump` available (PostgreSQL client tools installed or installable).
- Developers have local PostgreSQL and `pg_restore` available.
- Railway S3 supports pre-signed URLs (or the endpoint can proxy/stream the file).

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Needs research] Which PostgreSQL tables correspond to each content type? Need to map Strapi content type names to actual table names for the allowlist.
- [Affects R1][Technical] Is `pg_dump` available in the production Strapi container, or does it need to be added to the Docker image?
- [Affects R3][Needs research] Does the Railway S3 SDK support generating pre-signed URLs? If not, the endpoint may need to stream the file directly.
- ~~[Affects R1][Technical] How should snapshot retention work?~~ **Resolved:** Auto-delete previous snapshot on each new export. Only the latest snapshot is kept to minimize S3 storage costs.
- [Affects R4][Technical] Should the import script drop and recreate content tables, or truncate and restore? Need to handle the case where the dev DB already has data.

## Next Steps

→ `/ce:plan` for structured implementation planning
