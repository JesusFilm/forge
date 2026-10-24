export type RagOperationalErrorCode =
  | "acquisition_source_disabled"
  | "argument_invalid"
  | "corpus_state_invalid"
  | "fetch_configuration_invalid"
  | "fetch_destination_refused"
  | "fetch_failed"
  | "upstream_fetch_failed"

export class RagOperationalError extends Error {
  override readonly name = "RagOperationalError"

  constructor(
    readonly code: RagOperationalErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
