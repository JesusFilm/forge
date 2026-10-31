export class SubtitleSourceError extends Error {
  constructor(
    readonly reason:
      | "source_invalid"
      | "source_failed"
      | "source_config_missing",
    readonly retryable: boolean,
    message: string,
  ) {
    super(message)
    this.name = "SubtitleSourceError"
  }
}

export function subtitleLanguageRoot(language: string) {
  return language.toLowerCase().split(/[-_]/)[0]
}
