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
//   - The "./parity" re-export in packages/graphql/src/index.ts
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

// Public surface — empty initially, populated by U2-U6 implementation units.
export {}
