/**
 * `@forge/experience-schema` — the single-sourced LLM experience-draft
 * generation contract.
 *
 * These three modules are PURE Zod + string utilities with no runtime
 * dependency on `apps/admin` (or any other app). They are consumed by BOTH
 * the generator (`apps/mastra` draft/chat workflows) and admin's
 * re-validator so the two sides cannot drift. Keep this package admin-free:
 * the persistence-layer `BlocksSchema` (`@/domain/blocks`) and admin's
 * `normalizeExperienceDraft` deliberately stay in `apps/admin`.
 */
export * from "./experience-ai.schemas"
export * from "./extract-json-object"
export * from "./coerce-draft"
