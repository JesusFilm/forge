export type ExperimentFailureStage = "preflight" | "pipeline"

/** Stable error contract exposed by the experiment coordinator boundary. */
export class ExperimentExecutionError extends Error {
  readonly code: "EXPERIMENT_PREFLIGHT_FAILED" | "EXPERIMENT_PIPELINE_FAILED"
  readonly stage: ExperimentFailureStage

  constructor(stage: ExperimentFailureStage, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause)
    super(message, { cause })
    this.name = "ExperimentExecutionError"
    this.stage = stage
    this.code =
      stage === "preflight"
        ? "EXPERIMENT_PREFLIGHT_FAILED"
        : "EXPERIMENT_PIPELINE_FAILED"
  }
}

export function asExperimentExecutionError(
  cause: unknown,
  stage: ExperimentFailureStage,
): ExperimentExecutionError {
  return cause instanceof ExperimentExecutionError
    ? cause
    : new ExperimentExecutionError(stage, cause)
}
