import { beforeEach, describe, expect, it, vi } from "vitest"

const { readObject } = vi.hoisted(() => ({ readObject: vi.fn() }))

vi.mock("@/storage/s3", () => ({ readObject }))

import { loadCoreIdMapping } from "./core-id-mapping.service"

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

  it("throws mapping_missing when S3 surfaces a NoSuchKey error", async () => {
    readObject.mockRejectedValueOnce(
      new Error("NoSuchKey: the specified key does not exist"),
    )

    await expect(
      loadCoreIdMapping("admin-migrations/core-id-mapping.json"),
    ).rejects.toMatchObject({
      name: "CoreIdMappingError",
      code: "mapping_missing",
    })
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
