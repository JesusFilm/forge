import { loadCoreIdMapping } from "@/services/core-id-mapping.service"
import {
  ManagerArtifactError,
  readSceneAnalysisArtifact,
} from "@/services/manager-artifacts.service"
import {
  assertManagerArtifactsReachable,
  assertObjectStorageReachable,
} from "@/storage/s3"

export type PreflightCheckStatus = "passed" | "warning" | "failed"

export type PreflightCheckReason =
  | "ok"
  | "artifact_missing"
  | "artifact_invalid"
  | "artifact_read_failed"
  | "mapping_missing"
  | "mapping_invalid"
  | "mapping_read_failed"
  | "mapping_key_rejected"
  | "dns_failed"
  | "timeout"
  | "access_denied"
  | "bucket_not_found"
  | "config_missing"
  | "unknown"

export type PreflightCheck = {
  name:
    | "admin_object_storage"
    | "manager_artifact_storage"
    | "core_id_mapping"
    | "sample_scene_artifact"
  status: PreflightCheckStatus
  reason: PreflightCheckReason
  retryable: boolean
  message: string
}

export type ManagerArtifactsPreflightReport = {
  ok: boolean
  checks: PreflightCheck[]
}

export type ManagerArtifactsPreflightInput = {
  mappingS3Key: string
  sampleSceneAssetId?: number
  strictSampleArtifact?: boolean
}

export async function runManagerArtifactsPreflight(
  input: ManagerArtifactsPreflightInput,
): Promise<ManagerArtifactsPreflightReport> {
  const checks: PreflightCheck[] = []

  checks.push(
    await runCheck("admin_object_storage", async () => {
      await assertObjectStorageReachable()
    }),
  )

  checks.push(
    await runCheck("manager_artifact_storage", async () => {
      await assertManagerArtifactsReachable()
    }),
  )

  checks.push(
    await runCheck("core_id_mapping", async () => {
      await loadCoreIdMapping(input.mappingS3Key)
    }),
  )

  if (input.sampleSceneAssetId !== undefined) {
    checks.push(
      await runCheck(
        "sample_scene_artifact",
        async () => {
          await readSceneAnalysisArtifact(String(input.sampleSceneAssetId))
        },
        {
          missingAsWarning: !input.strictSampleArtifact,
        },
      ),
    )
  }

  return {
    ok: checks.every((check) => check.status !== "failed"),
    checks,
  }
}

async function runCheck(
  name: PreflightCheck["name"],
  fn: () => Promise<void>,
  options: { missingAsWarning?: boolean } = {},
): Promise<PreflightCheck> {
  try {
    await fn()
    return {
      name,
      status: "passed",
      reason: "ok",
      retryable: false,
      message: `${name} ok`,
    }
  } catch (error) {
    const classified = classifyPreflightError(error)
    const status =
      options.missingAsWarning && classified.reason === "artifact_missing"
        ? "warning"
        : "failed"
    return {
      name,
      status,
      ...classified,
    }
  }
}

function classifyPreflightError(error: unknown): {
  reason: PreflightCheckReason
  retryable: boolean
  message: string
} {
  const message = sanitizeMessage(
    error instanceof Error ? error.message : String(error),
  )
  const code = getStringProp(error, "code") ?? getStringProp(error, "Code")
  const name = getStringProp(error, "name")
  const lower = message.toLowerCase()

  if (error instanceof ManagerArtifactError) {
    if (error.code === "artifact_read_failed" && error.cause !== undefined) {
      const cause = classifyPreflightError(error.cause)
      if (isInfrastructureReason(cause.reason)) {
        return {
          ...cause,
          message,
        }
      }
    }
    return {
      reason: error.code,
      retryable: error.code === "artifact_read_failed",
      message,
    }
  }

  if (
    code === "mapping_missing" ||
    code === "mapping_invalid" ||
    code === "mapping_read_failed" ||
    code === "mapping_key_rejected"
  ) {
    return {
      reason: code,
      retryable: code === "mapping_read_failed",
      message,
    }
  }

  if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    lower.includes("getaddrinfo enotfound")
  ) {
    return { reason: "dns_failed", retryable: true, message }
  }

  if (
    name === "TimeoutError" ||
    name === "AbortError" ||
    code === "ETIMEDOUT" ||
    lower.includes("timeout") ||
    lower.includes("timed out")
  ) {
    return { reason: "timeout", retryable: true, message }
  }

  if (
    name === "AccessDenied" ||
    code === "AccessDenied" ||
    lower.includes("accessdenied") ||
    lower.includes("access denied")
  ) {
    return { reason: "access_denied", retryable: false, message }
  }

  if (
    name === "NoSuchBucket" ||
    code === "NoSuchBucket" ||
    lower.includes("nosuchbucket")
  ) {
    return { reason: "bucket_not_found", retryable: false, message }
  }

  if (
    lower.includes("is required when") ||
    lower.includes("is not set") ||
    lower.includes("config")
  ) {
    return { reason: "config_missing", retryable: false, message }
  }

  return { reason: "unknown", retryable: false, message }
}

function isInfrastructureReason(reason: PreflightCheckReason): boolean {
  return (
    reason === "dns_failed" ||
    reason === "timeout" ||
    reason === "access_denied" ||
    reason === "bucket_not_found" ||
    reason === "config_missing"
  )
}

function getStringProp(error: unknown, prop: string): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const value = (error as Record<string, unknown>)[prop]
  return typeof value === "string" ? value : undefined
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-db-url]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /(access[_-]?key|secret[_-]?key|api[_-]?key)=\S+/gi,
      "$1=[redacted]",
    )
}
