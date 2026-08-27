export const ENVIRONMENT_TARGETS = [
  "local",
  "ci",
  "railway",
  "firecrawl",
  "language-sweep",
  "eval",
  "smoke",
  "dashboard",
  "production-read",
  "production-write",
] as const

export type EnvironmentTarget = (typeof ENVIRONMENT_TARGETS)[number]

export type EnvironmentConfigurationErrorCode =
  | "dashboard_database_required"
  | "dashboard_generic_database_refused"
  | "firecrawl_api_key_required"
  | "language_sweep_output_required"
  | "production_database_host_mismatch"
  | "production_database_required"
  | "production_openrouter_key_required"
  | "production_write_host_required"
  | "production_write_opt_in_required"
  | "railway_bearer_tokens_required"

export class EnvironmentConfigurationError extends Error {
  override readonly name = "EnvironmentConfigurationError"

  constructor(
    readonly code: EnvironmentConfigurationErrorCode,
    message: string,
    readonly target?: EnvironmentTarget,
  ) {
    super(message)
  }
}

export const environmentConfigurationError = (
  code: EnvironmentConfigurationErrorCode,
  message: string,
  target?: EnvironmentTarget,
) => new EnvironmentConfigurationError(code, message, target)
