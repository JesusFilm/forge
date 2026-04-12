import type { JobArtifactManifest } from "@/types/job"

export type MuxEnvironment = "staging" | "production"

function getMaterializationMetadata(
  artifacts: JobArtifactManifest,
): Record<string, unknown> | null {
  const materialization = artifacts.materialization
  if (!materialization || materialization.kind !== "metadata") {
    return null
  }

  return materialization.data
}

export function getJobMuxEnvironment(
  artifacts: JobArtifactManifest,
): MuxEnvironment {
  const metadata = getMaterializationMetadata(artifacts)
  if (!metadata) {
    return "production"
  }

  if (metadata.targetEnvironment === "mux-stage") {
    return "staging"
  }

  if (metadata.targetEnvironment === "mux-production") {
    return "production"
  }

  if (metadata.mode === "snapshot_to_stage_clone") {
    return "staging"
  }

  return "production"
}

export function getMuxEnvironmentTooltip(environment: MuxEnvironment): string {
  return environment === "staging"
    ? "Staging Mux environment"
    : "Production Mux environment"
}

export function getMuxEnvironmentLabel(environment: MuxEnvironment): string {
  return environment === "staging" ? "stage" : "prod"
}
