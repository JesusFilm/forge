// =============================================================================
// PARITY HARNESS — DELETION CHECKLIST (per-PR contract; keep current)
// =============================================================================
//
// This module is throwaway scaffolding for the Strapi → admin consumer
// migration. It is deleted when mobile and TV both report their first
// parity-clean window in `admin` mode (no fallback). See:
//
//   docs/brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md
//   docs/plans/2026-05-07-002-feat-consumer-migration-parity-harness-unit-4-plan.md
//   docs/solutions/best-practices/throwaway-operator-harness-deletion-contract-20260430.md
//
// At retirement, remove ALL of the following in one PR:
//
//   - This entire directory: packages/graphql/src/parity/
//   - The capture script: packages/graphql/scripts/capture-parity-fixture.ts
//   - The "./parity" entry in packages/graphql/package.json `exports`
//   - The vitest devDep + test/test:watch scripts in packages/graphql/package.json
//     (only if no other test surface in this package needs them)
//   - The vitest config: packages/graphql/vitest.config.ts
//     (only if no other test surface in this package needs it)
//   - The zod devDep in packages/graphql/package.json
//     (only used by parity/normalize-admin.ts via @forge/admin/domain/blocks)
//   - The exports-map entry "./domain/blocks" in apps/admin/package.json
//     (only if no other workspace consumer imports it; if it becomes the
//     last entry, the entire `exports` map is also removed)
//   - Env vars: FORGE_PARITY_LIVE, FORGE_STRAPI_URL, FORGE_ADMIN_URL,
//     FORGE_STRAPI_PUBLIC_ORIGIN — drop from any deployed env config
//
// What does NOT get removed:
//   - The @forge/admin workspace devDep on packages/graphql — still in use
//     for schema codegen (Unit 3's admin SDL → admin-graphql-env.d.ts flow)
//
// =============================================================================

// Public surface — exposed via the `@forge/graphql/parity` subpath.
// Internal helpers (path-pointer encoding, discriminator lookup tables,
// canonicalization regex predicates) are NOT exported — consumers
// should use the high-level API (`compareNormalizedRoutes`, normalizers,
// live mode) and the surfaced types.

export {
  compareNormalizedRoutes,
  type DiffReport,
  type StructuralDiff,
  type ValueDiff,
  type OrderDiff,
  type SemanticDiff,
  type SemanticSubclass,
  type PotentialTruncationDiff,
  type CompareOptions,
} from "./compare"

export {
  DEFAULT_ALLOW_LIST,
  type AllowListEntry,
  type AllowListChannel,
  type AppliedAllowListEntry,
} from "./allow-list"

export {
  normalizeStrapi,
  StrapiNormalizationError,
  type StrapiExperienceInput,
  type StrapiBlockInput,
  type NormalizeStrapiOptions,
} from "./normalize-strapi"

export {
  normalizeAdmin,
  AdminNormalizationError,
  AdminBlocksValidationError,
  type AdminExperienceLocaleInput,
  type NormalizeAdminOptions,
} from "./normalize-admin"

export type {
  NormalizedExperienceRoute,
  NormalizedBlock,
  NormalizedBlockKind,
  NormalizedMeta,
  NormalizedOgImage,
} from "./shared-shape"

export {
  runLiveComparison,
  assertLiveModeEnabled,
  LiveModeDisabledError,
  LiveModeConfigError,
  type LiveModeOptions,
  type LiveModeResult,
} from "./live"
