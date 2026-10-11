import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import {
  createProtectedLocalGaCaptureStore,
  gaCaptureStorageKey,
} from "./ga-capture-store"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  )
})

it("stores one generation-scoped object without replacing an existing artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-ga-store-"))
  roots.push(root)
  const store = createProtectedLocalGaCaptureStore(root)
  const body = Buffer.from("sealed aggregate v1")
  const source = join(root, `${randomUUID()}.source`)
  await writeFile(source, body)
  const digest = createHash("sha256").update(body).digest("hex")
  const key = gaCaptureStorageKey("generation-one", digest)

  expect(await store.putIfAbsent(key, source, body.byteLength)).toBe("created")
  expect(await store.putIfAbsent(key, source, body.byteLength)).toBe("exists")
  expect(await readFile(join(root, key))).toEqual(body)
  const chunks: Buffer[] = []
  for await (const chunk of await store.open(key))
    chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks)).toEqual(body)

  await writeFile(source, "replacement bytes")
  expect(await store.putIfAbsent(key, source, 17)).toBe("exists")
  expect(await readFile(join(root, key))).toEqual(body)
  expect(gaCaptureStorageKey("../escape", digest)).not.toContain("..")
  expect(() => gaCaptureStorageKey("valid", "f".repeat(63))).toThrow()
})
