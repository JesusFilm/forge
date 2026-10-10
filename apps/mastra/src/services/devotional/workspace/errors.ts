export type DevotionalWorkspaceErrorCode =
  | "hybrid-search-unavailable"
  | "inventory-deadline-exceeded"
  | "inventory-limit-exceeded"
  | "invalid-content"
  | "reconciliation-failed"
  | "required-category-empty"
  | "required-input-invalid"
  | "source-changed"
  | "unsafe-path"

export class DevotionalWorkspaceError extends Error {
  readonly code: DevotionalWorkspaceErrorCode
  readonly details?: Record<string, unknown>
  readonly retryable: boolean

  constructor(
    code: DevotionalWorkspaceErrorCode,
    message: string,
    options: {
      cause?: unknown
      details?: Record<string, unknown>
      retryable?: boolean
    } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = "DevotionalWorkspaceError"
    this.code = code
    this.details = options.details
    this.retryable = options.retryable ?? false
  }
}

export function isDevotionalWorkspaceError(
  error: unknown,
): error is DevotionalWorkspaceError {
  return error instanceof DevotionalWorkspaceError
}
