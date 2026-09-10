import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { VmJournal } from "../src/vm/journal.mjs"
import { uploadVmOutput } from "../src/vm/mux-upload.mjs"
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "shorts-mux-"))
  try {
    const journal = new VmJournal(dir),
      bytes = Buffer.from("verified mp4"),
      digest = createHash("sha256").update(bytes).digest("hex"),
      path = join(dir, "output.mp4")
    await writeFile(path, bytes)
    await journal.writeOnce("verified-output.json", {
      bytes: bytes.length,
      digest,
    })
    await journal.writeOnce("settlement.json", { settlement: "opaque" })
    const target = {
      state: "upload",
      uploadId: "upload",
      url: "https://storage.googleapis.com/mux-upload?signature=fixture",
      digest,
    }
    await fn({
      journal,
      path,
      bytes,
      target,
      api: { json: async () => target },
      claim: {
        capability: "not-forwarded",
        assignment: { expiresAt: Date.now() + 120000 },
      },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
test("PUTs verified local bytes directly with no gateway credential and resumes the same upload after lost response", async () =>
  fixture(async (f) => {
    const requests = []
    await assert.rejects(
      uploadVmOutput({
        ...f,
        fetcher: async (url, options) => {
          requests.push({ url, options })
          if (requests.length === 1) return new Response(null, { status: 308 })
          throw new Error("accepted bytes, response lost")
        },
      }),
    )
    assert.equal(requests[1].url.hostname, "storage.googleapis.com")
    assert.deepEqual(requests[1].options.body, f.bytes)
    assert.equal(requests[1].options.headers.authorization, undefined)
    assert.equal(requests[1].options.redirect, "error")
    let calls = 0
    assert.deepEqual(
      await uploadVmOutput({
        ...f,
        fetcher: async () => {
          calls++
          return new Response(null, { status: 200 })
        },
      }),
      { state: "uploaded" },
    )
    assert.equal(calls, 1)
    assert.equal((await f.journal.read("mux-upload.json")).uploadId, "upload")
  }))
test("resumes only bytes after the provider's confirmed range", async () =>
  fixture(async (f) => {
    let calls = 0
    await uploadVmOutput({
      ...f,
      fetcher: async (_url, options) => {
        if (++calls === 1)
          return new Response(null, {
            status: 308,
            headers: { range: "bytes=0-3" },
          })
        assert.deepEqual(options.body, f.bytes.subarray(4))
        assert.equal(
          options.headers["content-range"],
          `bytes 4-${f.bytes.length - 1}/${f.bytes.length}`,
        )
        return new Response(null, { status: 200 })
      },
    })
  }))
test("rejects changed output/destination before direct network access", async () =>
  fixture(async (f) => {
    const fetcher = async () => {
      assert.fail("must not upload")
    }
    f.target.url = "https://storage.googleapis.com.evil.test/upload"
    await assert.rejects(uploadVmOutput({ ...f, fetcher }), /destination/)
    f.target.url = "https://storage.googleapis.com/upload"
    await writeFile(f.path, Buffer.alloc(f.bytes.length))
    await assert.rejects(uploadVmOutput({ ...f, fetcher }), /bytes changed/)
  }))
test("expired persisted window cannot renew or issue a provider request", async () =>
  fixture(async (f) => {
    await f.journal.writeOnce("mux-window.json", {
      bootId: "old-boot",
      deadlineMs: 1,
    })
    f.api.json = async () => {
      assert.fail("must not request a new upload")
    }
    await assert.rejects(
      uploadVmOutput(f),
      /window exhausted; local output retained/,
    )
    assert.equal(await f.journal.read("mux-outcome.json"), null)
  }))
test("uploads to the Mux-owned direct upload host", async () =>
  fixture(async (f) => {
    f.target.url =
      "https://direct-uploads-oci-us-phoenix-1-vop1.mux.com/upload?signature=fixture"
    let calls = 0
    await uploadVmOutput({
      ...f,
      fetcher: async (url, options) => {
        assert.equal(
          url.hostname,
          "direct-uploads-oci-us-phoenix-1-vop1.mux.com",
        )
        assert.equal(options.headers.authorization, undefined)
        return new Response(null, { status: ++calls === 1 ? 308 : 200 })
      },
    })
    assert.equal(calls, 2)
  }))
for (const host of [
  "mux.com.evil.example",
  "notmux.com",
  "storage.googleapis.com.evil.example",
])
  test(`rejects upload host lookalike ${host}`, async () =>
    fixture(async (f) => {
      f.target.url = `https://${host}/upload`
      await assert.rejects(
        uploadVmOutput({
          ...f,
          fetcher: async () => {
            throw Error("must not fetch")
          },
        }),
        /Invalid Mux upload destination/,
      )
    }))
