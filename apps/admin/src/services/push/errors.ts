export type PushServiceErrorCode = "invalid_input"

export class PushServiceError extends Error {
  constructor(
    readonly code: PushServiceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "PushServiceError"
  }
}

export class PushInputError extends PushServiceError {
  constructor(message: string) {
    super("invalid_input", message)
    this.name = "PushInputError"
  }
}
