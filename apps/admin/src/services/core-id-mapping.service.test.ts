import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { loadCoreIdMapping } from "./core-id-mapping.service"

const FIXTURE_DIR = join(tmpdir(), "admin-core-id-mapping-test")

async function writeFixture(name: string, body: unknown): Promise<string> {
  const path = join(FIXTURE_DIR, name)
  await writeFile(path, typeof body === "string" ? body : JSON.stringify(body))
  return path
}

describe("loadCoreIdMapping", () => {
  beforeAll(async () => {
    await mkdir(FIXTURE_DIR, { recursive: true })
  })

  afterAll(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true })
  })

  it("loads a valid mapping into a Map keyed by coreId", async () => {
    const path = await writeFixture("valid.json", {
      generatedAt: "2026-04-19T00:00:00.000Z",
      count: 3,
      rows: [
        { coreId: "core-a", cmsVideoId: 1 },
        { coreId: "core-b", cmsVideoId: 22 },
        { coreId: "core-c", cmsVideoId: 333 },
      ],
    })

    const mapping = await loadCoreIdMapping(path)
    expect(mapping.byCoreId.size).toBe(3)
    expect(mapping.byCoreId.get("core-a")).toBe(1)
    expect(mapping.byCoreId.get("core-c")).toBe(333)
    expect(mapping.generatedAt).toBe("2026-04-19T00:00:00.000Z")
  })

  it("handles an empty rows array", async () => {
    const path = await writeFixture("empty.json", {
      generatedAt: "2026-04-19T00:00:00.000Z",
      count: 0,
      rows: [],
    })

    const mapping = await loadCoreIdMapping(path)
    expect(mapping.byCoreId.size).toBe(0)
  })

  it("throws mapping_missing when the file does not exist", async () => {
    await expect(
      loadCoreIdMapping(join(FIXTURE_DIR, "no-such-file.json")),
    ).rejects.toMatchObject({
      name: "CoreIdMappingError",
      code: "mapping_missing",
    })
  })

  it("throws mapping_invalid on malformed JSON", async () => {
    const path = await writeFixture("bad.json", "{not json")
    await expect(loadCoreIdMapping(path)).rejects.toMatchObject({
      code: "mapping_invalid",
    })
  })

  it("throws mapping_invalid when a row has the wrong shape", async () => {
    const path = await writeFixture("wrong-shape.json", {
      generatedAt: "x",
      count: 1,
      rows: [{ coreId: "core-a", cmsVideoId: "not-a-number" }],
    })
    await expect(loadCoreIdMapping(path)).rejects.toMatchObject({
      code: "mapping_invalid",
    })
  })
})
