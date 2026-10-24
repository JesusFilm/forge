export type RecommendationServiceErrorCode =
  | "authentication_required"
  | "invalid_input"
  | "invalid_binding"
  | "conflict"
  | "capability_unavailable"

export class RecommendationServiceError extends Error {
  constructor(
    readonly code: RecommendationServiceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "RecommendationServiceError"
  }
}

export class RecommendationAuthenticationError extends RecommendationServiceError {
  constructor() {
    super("authentication_required", "Web consumer authentication required")
    this.name = "RecommendationAuthenticationError"
  }
}

export class RecommendationInputError extends RecommendationServiceError {
  constructor(message: string) {
    super("invalid_input", message)
    this.name = "RecommendationInputError"
  }
}

export class RecommendationBindingError extends RecommendationServiceError {
  constructor(message: string) {
    super("invalid_binding", message)
    this.name = "RecommendationBindingError"
  }
}

export class RecommendationConflictError extends RecommendationServiceError {
  constructor(message: string) {
    super("conflict", message)
    this.name = "RecommendationConflictError"
  }
}

export class RecommendationCapabilityUnavailableError extends RecommendationServiceError {
  constructor() {
    super("capability_unavailable", "Recommendation capability unavailable")
    this.name = "RecommendationCapabilityUnavailableError"
  }
}

/** Typed unexpected state that must remain an internal GraphQL failure. */
export class RecommendationInternalStateError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "RecommendationInternalStateError"
  }
}
