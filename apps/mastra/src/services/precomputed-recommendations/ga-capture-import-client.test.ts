import { describe, expect, it, vi } from "vitest"

import { gaCaptureDigest } from "./ga-watch-capture-artifact"
import { createGaCaptureImportClient } from "./ga-capture-import-client"

const commonIdentity = {
  generationId: "subscription-destination",
  generationInputDigest: "1".repeat(64),
  sourceSetDigest: "2".repeat(64),
  inputCutoff: "2026-10-06T20:48:05.001Z",
  selectedCorpusDigest: "3".repeat(64),
  candidatePoolDigest: "4".repeat(64),
  routeMappingDigest: "5".repeat(64),
  sourcePatternTableDigest: "6".repeat(64),
  querySpecDigest: "7".repeat(64),
  propertyId: "320198532" as const,
  propertyTimeZone: "America/New_York" as const,
  requestedStart: "2020-01-01",
  requestedEnd: "2026-10-05",
  usableStart: "2022-08-08",
  usableEnd: "2026-10-05",
  requestedCoverageDigest: "8".repeat(64),
  usableCoverageDigest: "9".repeat(64),
}
const destination = {
  ...commonIdentity,
  qualificationPolicy: "referrer_navigation_v1" as const,
}
const origin = {
  ...commonIdentity,
  generationId: "capture-origin",
  generationInputDigest: "a".repeat(64),
  candidatePoolDigest: "b".repeat(64),
  baseQualificationDigest: "c".repeat(64),
  artifactSha256: "d".repeat(64),
  artifactBytes: 1000,
  headerSha256: "e".repeat(64),
  physicalHttpAttempts: 12,
  physicalSucceededCalls: 10,
}
const version = "ga_capture_import_v1" as const
const copy = {
  artifactSha256: origin.artifactSha256,
  artifactBytes: origin.artifactBytes,
  headerSha256: origin.headerSha256,
}
const binding = { version, destination, origin, copy }
const preparedDigest = gaCaptureDigest({
  version: "ga_capture_import_prepare_v1",
  destination,
})
const prepared = {
  version,
  state: "prepared",
  preparedDigest,
  destination,
  replay: false,
}
const bound = {
  version,
  state: "bound",
  preparedDigest,
  importBinding: { ...binding, bindingDigest: gaCaptureDigest(binding) },
  qualificationDigest: "f".repeat(64),
}
const attemptId = "11111111-1111-4111-8111-111111111111"

describe("verified GA import client", () => {
  it("compares Admin's independently computed destination against the locally frozen catalog", async () => {
    const changed = { ...destination, selectedCorpusDigest: "0".repeat(64) }
    const client = createGaCaptureImportClient(async () => ({
      ...prepared,
      destination: changed,
      preparedDigest: gaCaptureDigest({
        version: "ga_capture_import_prepare_v1",
        destination: changed,
      }),
    }))
    await expect(
      client.prepare({ destination, attemptId }),
    ).rejects.toMatchObject({ code: "ga_import_identity_mismatch" })
  })

  it("sends only declared intent fields, never caller-supplied corpus or route hashes", async () => {
    const ingest = vi.fn(async () => prepared)
    expect(
      await createGaCaptureImportClient(ingest).prepare({
        destination,
        attemptId,
      }),
    ).toEqual(prepared)
    expect(ingest).toHaveBeenCalledExactlyOnceWith({
      action: "ga_import_prepare_v1",
      generationId: destination.generationId,
      generationInputDigest: destination.generationInputDigest,
      attemptId,
      candidatePoolDigest: destination.candidatePoolDigest,
      requestedStart: destination.requestedStart,
      requestedEnd: destination.requestedEnd,
      usableStart: destination.usableStart,
      usableEnd: destination.usableEnd,
      requestedCoverageDigest: destination.requestedCoverageDigest,
      usableCoverageDigest: destination.usableCoverageDigest,
    })
  })

  it("preserves distinct origin and destination pools in a verified binding", async () => {
    const client = createGaCaptureImportClient(async () => bound)
    const result = await client.status({ destination })
    expect(result).toEqual(bound)
    if (result.state !== "bound") throw new Error("Expected bound fixture")
    expect(result.importBinding.origin.candidatePoolDigest).not.toBe(
      result.importBinding.destination.candidatePoolDigest,
    )
  })

  it("rejects a forged binding digest even when its individual fields look valid", async () => {
    const client = createGaCaptureImportClient(async () => ({
      ...bound,
      importBinding: { ...bound.importBinding, bindingDigest: "0".repeat(64) },
    }))
    await expect(client.status({ destination })).rejects.toMatchObject({
      code: "ga_import_identity_mismatch",
    })
  })

  it("rejects relabeled copy bytes despite a self-consistent binding hash", async () => {
    const changed = {
      ...binding,
      copy: { ...copy, artifactSha256: "0".repeat(64) },
    }
    const client = createGaCaptureImportClient(async () => ({
      ...bound,
      importBinding: { ...changed, bindingDigest: gaCaptureDigest(changed) },
    }))
    await expect(client.status({ destination })).rejects.toMatchObject({
      code: "ga_import_identity_mismatch",
    })
  })

  it("refuses a changed origin route universe even when the binding is internally consistent", async () => {
    const changed = {
      ...binding,
      origin: { ...origin, routeMappingDigest: "0".repeat(64) },
    }
    const client = createGaCaptureImportClient(async () => ({
      ...bound,
      importBinding: { ...changed, bindingDigest: gaCaptureDigest(changed) },
    }))
    await expect(client.status({ destination })).rejects.toMatchObject({
      code: "ga_import_identity_mismatch",
    })
  })

  it("reports an in-progress copy without claiming it is usable or retrying it", async () => {
    const copying = {
      version,
      state: "copying",
      preparedDigest,
      stagingDeadlineAt: "2026-10-08T04:00:00.000Z",
      replay: true,
    }
    const ingest = vi.fn(async () => copying)
    expect(
      await createGaCaptureImportClient(ingest).copyBind({
        destination,
        attemptId,
        origin,
        originProofDigest: "0".repeat(64),
      }),
    ).toEqual(copying)
    expect(ingest).toHaveBeenCalledOnce()
  })

  it("never retries an ambiguous copy request", async () => {
    const lost = new Error("lost copy response")
    const ingest = vi.fn(async () => {
      throw lost
    })
    await expect(
      createGaCaptureImportClient(ingest).copyBind({
        destination,
        attemptId,
        origin,
        originProofDigest: "0".repeat(64),
      }),
    ).rejects.toBe(lost)
    expect(ingest).toHaveBeenCalledOnce()
  })

  it("sanitizes an oversized untrusted response", async () => {
    const client = createGaCaptureImportClient(async () =>
      "private-response-".repeat(10_000),
    )
    await expect(client.status({ destination })).rejects.toMatchObject({
      code: "ga_import_invalid_response",
      message: "ga_import_invalid_response",
    })
  })
})
