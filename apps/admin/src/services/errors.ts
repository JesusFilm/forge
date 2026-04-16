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
