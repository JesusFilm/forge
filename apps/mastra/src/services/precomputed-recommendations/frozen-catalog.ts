import { createHash } from "node:crypto"
import { open } from "node:fs/promises"
import { z } from "zod"

import { validateSelectedChunks } from "./selected-transcript"
import {
  chunkSchema,
  videoSchema,
  type SourceCatalog,
} from "./source-generation"

const MAX_BYTES = 32 * 1024 * 1024
const id = z.string().min(1).max(191)
const scopeSchema = z
  .object({
    generationId: id,
    generationInputDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    inputCutoff: z.string().datetime(),
  })
  .strict()
const snapshotSchema = scopeSchema
  .extend({
    version: z.literal("frozen_catalog_v1"),
    entries: z
      .array(
        z
          .object({
            video: videoSchema,
            chunks: z
              .array(chunkSchema.extend({ text: z.string().max(8192) }))
              .max(100_000),
          })
          .strict(),
      )
      .min(1)
      .max(20_000),
  })
  .strict()

function invalid(): never {
  throw new Error("frozen_catalog_invalid")
}

/** Local operator input only. Existing preflight verifies all reviewed digests. */
export async function loadFrozenCatalog(input: {
  path: string
  sha256: string
  scope: z.infer<typeof scopeSchema>
}): Promise<SourceCatalog> {
  const file = await open(input.path, "r")
  let bytes: Buffer
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > MAX_BYTES) invalid()
    // Bound the read even if the file grows after stat.
    bytes = Buffer.alloc(stat.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      )
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset !== stat.size) invalid()
    bytes = bytes.subarray(0, offset)
  } finally {
    await file.close()
  }
  if (createHash("sha256").update(bytes).digest("hex") !== input.sha256)
    invalid()
  const parsed = snapshotSchema.safeParse(JSON.parse(bytes.toString("utf8")))
  if (!parsed.success) invalid()
  const snapshot = parsed.data
  if (
    snapshot.generationId !== input.scope.generationId ||
    snapshot.generationInputDigest !== input.scope.generationInputDigest ||
    snapshot.inputCutoff !== input.scope.inputCutoff
  )
    invalid()
  let previousId: string | undefined
  for (const entry of snapshot.entries) {
    if (previousId && entry.video.id <= previousId) invalid()
    if (!entry.video.transcriptSelection || !entry.video.watchRouteIdentity)
      invalid()
    validateSelectedChunks(entry.video, entry.chunks)
    previousId = entry.video.id
  }
  const byId = new Map(snapshot.entries.map((entry) => [entry.video.id, entry]))
  const checkCutoff = (cutoff: string) => {
    if (cutoff !== snapshot.inputCutoff) invalid()
  }
  const entryFor = (videoId: string) => byId.get(videoId) ?? invalid()
  function page<T extends { id: string }>(
    rows: T[],
    after: string | undefined,
    limit: number,
  ) {
    const start =
      after === undefined ? 0 : rows.findIndex((row) => row.id === after) + 1
    if (after !== undefined && start === 0) invalid()
    const items = rows.slice(start, start + limit)
    return {
      items: structuredClone(items),
      nextCursor: start + limit < rows.length ? items.at(-1)!.id : null,
    }
  }
  return {
    async video({ videoId, cutoff }) {
      checkCutoff(cutoff)
      return structuredClone(entryFor(videoId).video)
    },
    async catalog({ cutoff, afterVideoId }) {
      checkCutoff(cutoff)
      const result = page(
        snapshot.entries.map((entry) => entry.video),
        afterVideoId,
        40,
      )
      return { videos: result.items, nextCursor: result.nextCursor }
    },
    async chunks({ videoId, cutoff, afterChunkId }) {
      checkCutoff(cutoff)
      const result = page(entryFor(videoId).chunks, afterChunkId, 20)
      return { chunks: result.items, nextCursor: result.nextCursor }
    },
  }
}
