import { randomUUID } from "node:crypto"
import { access, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  cacheDirFor,
  clearCachedDevotional,
  loadCachedDevo,
} from "./devotional-cache"

describe("devotional cache", () => {
  it("keeps different devotional dates in different cache directories", () => {
    expect(cacheDirFor(19, 3, "2026-07-21")).not.toBe(
      cacheDirFor(19, 3, "2026-07-22"),
    )
  })

  it("treats parseable but schema-invalid JSON as a cache miss", async () => {
    const dir = path.join(tmpdir(), `devo-cache-invalid-${randomUUID()}`)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, "devo.json"), JSON.stringify({ title: 42 }))

    expect(await loadCachedDevo(dir)).toBeNull()
    await clearCachedDevotional(dir)
  })

  it("clears text and audio together after rejection", async () => {
    const dir = path.join(tmpdir(), `devo-cache-clear-${randomUUID()}`)
    await mkdir(path.join(dir, "audio"), { recursive: true })
    await writeFile(path.join(dir, "devo.json"), "{}")
    await writeFile(path.join(dir, "audio", "index.json"), "{}")

    await clearCachedDevotional(dir)

    await expect(access(dir)).rejects.toMatchObject({ code: "ENOENT" })
  })
})
