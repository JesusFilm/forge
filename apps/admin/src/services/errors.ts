// Shared service error classes.
//
// Every service throws these typed errors so GraphQL error formatting
// and middleware can reliably match on `instanceof` rather than string.

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message)
    this.name = "ForbiddenError"
  }
}

export class NotFoundError extends Error {
  constructor(entity: string, id?: string) {
    super(id ? `${entity} not found: ${id}` : `${entity} not found`)
    this.name = "NotFoundError"
  }
}

export class ExperienceDuplicationError extends Error {
  constructor() {
    super("Experience cannot be duplicated from its current saved state")
    this.name = "ExperienceDuplicationError"
  }
}

/**
 * Thrown when an optimistic-concurrency guard detects that a row was
 * modified by another writer between read and write (the conditional
 * `updateMany` matched zero rows because the pre-image `updatedAt` no
 * longer matches). Callers should surface this as a "reload and retry"
 * signal rather than silently clobbering the concurrent change.
 */
export class ConcurrentModificationError extends Error {
  constructor(entity: string, id?: string) {
    super(
      id
        ? `${entity} was modified concurrently: ${id}`
        : `${entity} was modified concurrently`,
    )
    this.name = "ConcurrentModificationError"
  }
}

/**
 * Thrown when a storefront draft write commits but its returned revision no
 * longer carries the operation attribution the caller supplied. Callers must
 * treat this as an ambiguous write outcome and reconcile before retrying.
 */
export class StorefrontStageAttributionMismatchError extends Error {
  constructor() {
    super("Storefront stage attribution did not match the committed draft")
    this.name = "StorefrontStageAttributionMismatchError"
  }
}
