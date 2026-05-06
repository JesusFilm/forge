// Shared Prisma runtime-error helpers for raw-SQL services.
//
// Prisma raw SQL errors (especially `$executeRaw` failures on vector
// writes) can surface the full statement text and parameter values in
// `error.message`. A 1536-element float vector literal embedded in
// `error.message` would round-trip into per-target outcomes and out the
// GraphQL mutation response if a service rethrew the raw error. These
// helpers let services remap a Prisma runtime error to a typed,
// caller-safe error class without echoing the bound parameters.
//
// Mirrors the zod-echo hardening already applied elsewhere — see
// docs/solutions/best-practices/zod-validation-errors-must-not-echo-user-controlled-input-20260420.md.
//
// Detection is shape-based rather than `instanceof`-based because the
// Prisma error class tree differs across runtime/dev and we don't want
// to import @prisma/client at the service boundary just to `instanceof`
// a specific subclass. `code` / `name` presence is stable across
// Prisma 6.x.

/**
 * Returns true when `error` looks like a Prisma runtime error. Detects
 * either the `PrismaClient*` name prefix or the engine's stable
 * `P\d{4}` code surface (P2002, P2025, P2010, etc.).
 */
export function isPrismaRuntimeError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const err = error as { name?: unknown; code?: unknown }
  if (typeof err.name === "string" && err.name.startsWith("PrismaClient")) {
    return true
  }
  if (typeof err.code === "string" && /^P\d{4}$/.test(err.code)) {
    return true
  }
  return false
}

/**
 * Builds a sanitized one-line summary of a Prisma runtime error using
 * only the stable `name` and `code` fields. Explicitly does NOT include
 * `error.message` — it can carry the raw SQL statement plus bound vector
 * literals and other parameter values. `context` is a short, non-PII
 * description of where the error came from (e.g. "transcript-embedding
 * write").
 */
export function sanitizePrismaErrorMessage(
  error: unknown,
  context: string,
): string {
  const name =
    typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "PrismaError"
  const code =
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "unknown"
  return `${name}(${code}) during ${context}`
}
