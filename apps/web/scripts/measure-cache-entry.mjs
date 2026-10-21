import { Buffer } from "node:buffer"

const bytes = (text) => Buffer.byteLength(text, "utf8")
const jsonBytes = (value) => bytes(JSON.stringify(value))

// Accept an already stored Redis JSON string. Return sizes only, never content,
// keys, headers, tag values or component props. No production hooks or writes.
export function measureCacheEntry(stored) {
  const entry = JSON.parse(stored)
  const value = entry.value
  if (value?.kind !== "APP_PAGE" || typeof value.html !== "string") {
    throw new Error("Expected a stored APP_PAGE entry")
  }

  const fields = {}
  let fieldBytes = 0
  for (const field of ["html", "rscData", "segmentData"]) {
    if (value[field] === undefined) continue
    const storedJsonBytes = jsonBytes(value[field])
    fieldBytes += storedJsonBytes
    fields[field] = { storedJsonBytes }
  }
  fields.html.contentUtf8Bytes = bytes(value.html)
  if (typeof value.rscData === "string") {
    fields.rscData.decodedBytes = Buffer.byteLength(value.rscData, "base64")
  }
  if (value.segmentData) {
    fields.segmentData.segmentCount = Object.keys(value.segmentData).length
    fields.segmentData.decodedBytes = Object.values(value.segmentData).reduce(
      (sum, encoded) => sum + Buffer.byteLength(encoded, "base64"),
      0,
    )
  }

  // HTML also embeds React's stream for initial hydration. These script bytes
  // are a subset of raw HTML, not an extra cache field or an additive saving.
  let embeddedRscScriptBytes = 0
  let embeddedRscScriptCount = 0
  for (const match of value.html.matchAll(
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
  )) {
    if (!match[0].includes("self.__next_f.push(")) continue
    embeddedRscScriptBytes += bytes(match[0])
    embeddedRscScriptCount += 1
  }

  const totalStoredBytes = bytes(stored)
  return {
    kind: "APP_PAGE",
    totalStoredBytes,
    totalStoredCharacters: stored.length,
    fields,
    metadataAndJsonEnvelopeBytes: totalStoredBytes - fieldBytes,
    htmlBreakdown: {
      embeddedRscScriptBytes,
      embeddedRscScriptCount,
      remainingHtmlBytes: bytes(value.html) - embeddedRscScriptBytes,
    },
    metadataCounts: {
      tags: Array.isArray(entry.tags) ? entry.tags.length : 0,
      headers: Object.keys(value.headers ?? {}).length,
    },
    lastModifiedUtc:
      typeof entry.lastModified === "number"
        ? new Date(entry.lastModified).toISOString()
        : null,
  }
}
