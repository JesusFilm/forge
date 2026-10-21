import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { it } from "vitest"
import { measureCacheEntry } from "./measure-cache-entry.mjs"

it("accounts for stored byte sizes without emitting cached content", () => {
  const secret = "fixture-content-must-not-be-emitted"
  const html = `<p>日本語\\"${secret}</p><script>self.__next_f.push([1,"x"])</script>`
  const rsc = Buffer.from("日本語")
  const stored = JSON.stringify({
    lastModified: 0,
    tags: [secret],
    lifespan: { staleAt: 60, expireAt: 120 },
    value: {
      kind: "APP_PAGE",
      html,
      rscData: rsc.toString("base64"),
      segmentData: { [secret]: Buffer.from("x").toString("base64") },
      headers: { [secret]: secret },
      status: 200,
    },
  })
  const result = measureCacheEntry(stored)
  assert.equal(result.totalStoredBytes, Buffer.byteLength(stored))
  assert.ok(result.totalStoredBytes > result.totalStoredCharacters)
  assert.equal(result.fields.rscData.decodedBytes, rsc.length)
  assert.equal(result.fields.segmentData.decodedBytes, 1)
  assert.equal(result.fields.segmentData.segmentCount, 1)
  assert.equal(result.fields.html.contentUtf8Bytes, Buffer.byteLength(html))
  assert.equal(
    result.totalStoredBytes,
    Object.values(result.fields).reduce(
      (sum, field) => sum + field.storedJsonBytes,
      0,
    ) + result.metadataAndJsonEnvelopeBytes,
  )
  assert.equal(
    result.fields.html.contentUtf8Bytes,
    result.htmlBreakdown.embeddedRscScriptBytes +
      result.htmlBreakdown.remainingHtmlBytes,
  )
  assert.equal(result.htmlBreakdown.embeddedRscScriptCount, 1)
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.throws(() => measureCacheEntry('{"value":{"kind":"FETCH"}}'))
})
