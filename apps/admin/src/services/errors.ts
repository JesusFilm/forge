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

export class InvalidInputError extends Error {
  constructor(message = "Invalid input") {
    super(message)
    this.name = "InvalidInputError"
  }
}

export class LimitExceededError extends Error {
  constructor(message = "Resource limit exceeded") {
    super(message)
    this.name = "LimitExceededError"
  }
}

export class ServiceUnavailableError extends Error {
  readonly retryable = true

  constructor(message = "Service temporarily unavailable") {
    super(message)
    this.name = "ServiceUnavailableError"
  }
}

export class ServiceConfigurationError extends Error {
  constructor(message = "Service is not configured") {
    super(message)
    this.name = "ServiceConfigurationError"
  }
}
