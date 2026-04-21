import { beforeEach, describe, expect, it, vi } from "vitest"

const { readObject } = vi.hoisted(() => ({ readObject: vi.fn() }))

vi.mock("@/storage/s3", () => ({ readObject }))

import {
  DEFAULT_CORE_ID_MAPPING_S3_KEY,
  assertMappingS3KeyAllowed,
  loadCoreIdMapping,
} from "./core-id-mapping.service"

function encode(value: unknown): Uint8Array {
  const body = typeof value === "string" ? value : JSON.stringify(value)
  return new TextEncoder().encode(body)
}

describe("loadCoreIdMapping", () => {
  beforeEach(() => {
    readObject.mockReset()
  })

  it("loads a valid mapping into a Map keyed by coreId", async () => {
    readObject.mockResolvedValueOnce(
      encode({
        generatedAt: "2026-04-19T00:00:00.000Z",
        count: 3,
        rows: [
          { coreId: "core-a", cmsVideoId: 1 },
          { coreId: "core-b", cmsVideoId: 22 },
          { coreId: "core-c", cmsVideoId: 333 },
        ],
      }),
    )

    const mapping = await loadCoreIdMapping(
      "admin-migrations/core-id-mapping.json",
    )

    expect(readObject).toHaveBeenCalledWith(
      "admin-migrations/core-id-mapping.json",
    )
    expect(mapping.byCoreId.size).toBe(3)
    expect(mapping.byCoreId.get("core-a")).toBe(1)
    expect(mapping.byCoreId.get("core-c")).toBe(333)
    expect(mapping.generatedAt).toBe("2026-04-19T00:00:00.000Z")
  })

  it("handles an empty rows array", async () => {
    readObject.mockResolvedValueOnce(
      encode({
        generatedAt: "2026-04-19T00:00:00.000Z",
        count: 0,
        rows: [],
      }),
    )

    const mapping = await loadCoreIdMapping(
      "admin-migrations/core-id-mapping.json",
    )
    expect(mapping.byCoreId.size).toBe(0)
  })

  it("throws mapping_missing for a real @aws-sdk/client-s3 NoSuchKey shape", async () => {
    // Mirrors the typed SDK error: name discriminant + server message that
    // does NOT contain any 'not found / missing' substring. The prior
    // message-regex classifier would have misclassified this as read_failed.
    const err = Object.assign(new Error("The specified key does not exist."), {
      name: "NoSuchKey",
      $metadata: { httpStatusCode: 404 },
    })
    readObject.mockRejectedValueOnce(err)

    await expect(
      loadCoreIdMapping("admin-migrations/core-id-mapping.json"),
    ).rejects.toMatchObject({
      name: "CoreIdMappingError",
      code: "mapping_missing",
    })
  })

  it("throws mapping_missing for a 404 shape without the NoSuchKey name", async () => {
    const err = Object.assign(new Error("Not Found"), {
      $metadata: { httpStatusCode: 404 },
    })
    readObject.mockRejectedValueOnce(err)

    await expect(
      loadCoreIdMapping("admin-migrations/core-id-mapping.json"),
    ).rejects.toMatchObject({ code: "mapping_missing" })
  })

  it("throws mapping_missing when the local fallback file does not exist", async () => {
    const err = Object.assign(new Error("ENOENT: no such file or directory"), {
      code: "ENOENT",
    })
    readObject.mockRejectedValueOnce(err)

    await expect(
      loadCoreIdMapping("admin-migrations/core-id-mapping.json"),
    ).rejects.toMatchObject({
      code: "mapping_missing",
    })
  })

  it("throws mapping_read_failed on unexpected S3 errors", async () => {
    readObject.mockRejectedValueOnce(new Error("network is unreachable"))

    await expect(
      loadCoreIdMapping("admin-migrations/core-id-mapping.json"),
    ).rejects.toMatchObject({
      code: "mapping_read_failed",
    })
  })

  it("rejects S3 keys outside admin-migrations/ before any read", async () => {
    await expect(
      loadCoreIdMapping("other-app/secret.json"),
    ).rejects.toMatchObject({ code: "mapping_key_rejected" })
    expect(readObject).not.toHaveBeenCalled()
  })

  it("exposes the canonical default S3 key constant", () => {
    expect(DEFAULT_CORE_ID_MAPPING_S3_KEY).toMatch(/^admin-migrations\//)
    expect(() =>
      assertMappingS3KeyAllowed(DEFAULT_CORE_ID_MAPPING_S3_KEY),
    ).not.toThrow()
    expect(() => assertMappingS3KeyAllowed("../escape.json")).toThrow(
      /must live under admin-migrations\//,
    )
  })

  it("does not misclassify credential errors whose message contains 'missing' or 'not found'", async () => {
    // Prior regex matched 'missing' and 'not found' as substrings, so a
    // CredentialsProviderError or DNS 'host not found' would silently be
    // demoted to mapping_missing. Pin them to mapping_read_failed.
    readObject.mockRejectedValueOnce(
      new Error(
        "CredentialsProviderError: could not load credentials, profile not found",
      ),
    )

    await expect(
      loadCoreIdMapping("admin-migrations/core-id-mapping.json"),
    ).rejects.toMatchObject({ code: "mapping_read_failed" })
  })

  it("throws mapping_invalid on malformed JSON", async () => {
    readObject.mockResolvedValueOnce(encode("{not json"))

    await expect(
      loadCoreIdMapping("admin-migrations/core-id-mapping.json"),
    ).rejects.toMatchObject({ code: "mapping_invalid" })
  })

  it("throws mapping_invalid when a row has the wrong shape", async () => {
    readObject.mockResolvedValueOnce(
      encode({
        generatedAt: "x",
        count: 1,
        rows: [{ coreId: "core-a", cmsVideoId: "not-a-number" }],
      }),
    )

    await expect(
      loadCoreIdMapping("admin-migrations/core-id-mapping.json"),
    ).rejects.toMatchObject({ code: "mapping_invalid" })
  })
})
