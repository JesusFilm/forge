// Standalone constants for the coreId mapping flow.
//
// Extracted from core-id-mapping.service.ts so that the refresh CLI
// (apps/admin/src/scripts/refresh-core-id-mapping.ts) can import them
// without pulling in @/storage/s3 → @/config/env. The CLI deliberately
// bypasses the admin env validator so it can run with only the
// RAILWAY_S3_* vars populated — not the full server env matrix
// (DATABASE_URL, ADMIN_SESSION_SECRET, etc.). A transitive import of
// env.ts from the service file broke that contract.

/**
 * Canonical S3 key for the coreId → cms video id snapshot that the admin
 * refresh CLI uploads. Consumed by transcript embedding backfills, the
 * refresh CLI's upload target, and the operator runbook.
 */
export const DEFAULT_CORE_ID_MAPPING_S3_KEY =
  "admin-migrations/core-id-mapping.json"

/**
 * Any S3 key handed to the mutation must live under this prefix. The
 * bucket is shared across services (manager writes
 * `{assetId}/scene-analysis.json` etc.); confining ADMIN-supplied keys
 * to the admin namespace stops a compromised ADMIN session from using
 * the mutation to enumerate other apps' objects via error-code timing.
 */
export const ADMIN_MIGRATIONS_S3_PREFIX = "admin-migrations/"
