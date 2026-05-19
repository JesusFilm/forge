import { beforeEach, describe, expect, it, vi } from "vitest"
import { CoreIdMappingError } from "./core-id-mapping.service"
import { ManagerArtifactError } from "./manager-artifacts.service"

vi.mock("@/storage/s3", () => ({
  assertObjectStorageReachable: vi.fn(async () => undefined),
  assertManagerArtifactsReachable: vi.fn(async () => undefined),
}))

vi.mock("@/services/core-id-mapping.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./core-id-mapping.service")>()
  return {
    ...actual,
    loadCoreIdMapping: vi.fn(async () => ({
      generatedAt: "2026-05-20T00:00:00.000Z",
      byCoreId: new Map(),
    })),
  }
})

vi.mock("@/services/manager-artifacts.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./manager-artifacts.service")>()
  return {
    ...actual,
    readSceneAnalysisArtifact: vi.fn(async () => ({ scenes: [] })),
  }
})

const { assertObjectStorageReachable, assertManagerArtifactsReachable } =
  await import("@/storage/s3")
const { loadCoreIdMapping } = await import("./core-id-mapping.service")
const { readSceneAnalysisArtifact } =
  await import("./manager-artifacts.service")
const { runManagerArtifactsPreflight } =
  await import("./manager-artifacts-preflight.service")

describe("runManagerArtifactsPreflight", () => {
  beforeEach(() => {
    vi.mocked(assertObjectStorageReachable).mockReset()
    vi.mocked(assertObjectStorageReachable).mockResolvedValue(undefined)
    vi.mocked(assertManagerArtifactsReachable).mockReset()
    vi.mocked(assertManagerArtifactsReachable).mockResolvedValue(undefined)
    vi.mocked(loadCoreIdMapping).mockReset()
    vi.mocked(loadCoreIdMapping).mockResolvedValue({
      generatedAt: "2026-05-20T00:00:00.000Z",
      byCoreId: new Map(),
    })
    vi.mocked(readSceneAnalysisArtifact).mockReset()
    vi.mocked(readSceneAnalysisArtifact).mockResolvedValue({ scenes: [] })
  })

  it("passes when storage, mapping, and sample artifact are reachable", async () => {
    const report = await runManagerArtifactsPreflight({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      sampleSceneAssetId: 123,
    })

    expect(report.ok).toBe(true)
    expect(report.checks.map((check) => check.status)).toEqual([
      "passed",
      "passed",
      "passed",
      "passed",
    ])
    expect(readSceneAnalysisArtifact).toHaveBeenCalledWith("123")
  })

  it("classifies manager artifact DNS failure as retryable dns_failed", async () => {
    vi.mocked(assertManagerArtifactsReachable).mockRejectedValueOnce(
      Object.assign(new Error("getaddrinfo ENOTFOUND t3.storageapi.dev"), {
        code: "ENOTFOUND",
      }),
    )

    const report = await runManagerArtifactsPreflight({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.ok).toBe(false)
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "manager_artifact_storage",
        status: "failed",
        reason: "dns_failed",
        retryable: true,
      }),
    )
  })

  it("classifies sample artifact read failure by underlying transport cause", async () => {
    vi.mocked(readSceneAnalysisArtifact).mockRejectedValueOnce(
      new ManagerArtifactError(
        "artifact_read_failed",
        "failed to read scene-analysis artifact for assetId=123: getaddrinfo ENOTFOUND t3.storageapi.dev",
        Object.assign(new Error("getaddrinfo ENOTFOUND t3.storageapi.dev"), {
          code: "ENOTFOUND",
        }),
      ),
    )

    const report = await runManagerArtifactsPreflight({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      sampleSceneAssetId: 123,
    })

    expect(report.ok).toBe(false)
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "sample_scene_artifact",
        status: "failed",
        reason: "dns_failed",
        retryable: true,
      }),
    )
  })

  it("classifies Smithy timeout as retryable timeout", async () => {
    vi.mocked(assertManagerArtifactsReachable).mockRejectedValueOnce(
      Object.assign(new Error("request timed out"), { name: "TimeoutError" }),
    )

    const report = await runManagerArtifactsPreflight({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.ok).toBe(false)
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "manager_artifact_storage",
        status: "failed",
        reason: "timeout",
        retryable: true,
      }),
    )
  })

  it("classifies AccessDenied as non-retryable access_denied", async () => {
    vi.mocked(assertManagerArtifactsReachable).mockRejectedValueOnce(
      Object.assign(new Error("AccessDenied"), { name: "AccessDenied" }),
    )

    const report = await runManagerArtifactsPreflight({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.ok).toBe(false)
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        reason: "access_denied",
        retryable: false,
      }),
    )
  })

  it("preserves mapping_key_rejected classification", async () => {
    vi.mocked(loadCoreIdMapping).mockRejectedValueOnce(
      new CoreIdMappingError("mapping_key_rejected", "bad key"),
    )

    const report = await runManagerArtifactsPreflight({
      mappingS3Key: "../bad.json",
    })

    expect(report.ok).toBe(false)
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "core_id_mapping",
        status: "failed",
        reason: "mapping_key_rejected",
      }),
    )
  })

  it("treats sample artifact_missing as warning by default", async () => {
    vi.mocked(readSceneAnalysisArtifact).mockRejectedValueOnce(
      new ManagerArtifactError("artifact_missing", "not found"),
    )

    const report = await runManagerArtifactsPreflight({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      sampleSceneAssetId: 123,
    })

    expect(report.ok).toBe(true)
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "sample_scene_artifact",
        status: "warning",
        reason: "artifact_missing",
      }),
    )
  })

  it("does not attempt a sample artifact read when no sample is provided", async () => {
    const report = await runManagerArtifactsPreflight({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.ok).toBe(true)
    expect(report.checks).toHaveLength(3)
    expect(readSceneAnalysisArtifact).not.toHaveBeenCalled()
  })
})
