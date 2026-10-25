import { readFile } from "node:fs/promises"
import { resolve, sep, extname } from "node:path"
import { z } from "zod"
import type { Principal } from "@/auth/principal"
import type { MediaStorageBackend } from "@/storage/media"
import { StudioAssetService, byteDigest } from "./assets"
import { studioHash } from "./state"
import { StudioCommandError } from "./errors"

const inventorySchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        bytes: z.number().int().positive(),
        role: z.string(),
        provenance: z.record(z.string(), z.json()),
      }),
    )
    .max(1000),
})
/** Operator import, never generation. Original metadata is evidence, not a cache key or approval. */
export async function importStudioBaseline(
  assets: StudioAssetService,
  user: Principal | null,
  originals: string,
  raw: unknown,
  backend: MediaStorageBackend,
) {
  const inventory = inventorySchema.parse(raw),
    root = resolve(originals)
  const results = []
  for (const file of inventory.files) {
    const path = resolve(root, file.path)
    if (!path.startsWith(root + sep)) throw new StudioCommandError("INVALID")
    const bytes = await readFile(path)
    if (bytes.length !== file.bytes || byteDigest(bytes) !== file.sha256)
      throw new StudioCommandError("INVALID")
    const audio = extname(file.path) === ".mp3"
    results.push(
      await assets.register(
        user,
        {
          filename: file.path.split("/").at(-1),
          mimeType: audio ? "audio/mpeg" : "application/json",
          role: audio
            ? file.role === "narration"
              ? "narration"
              : "music"
            : ["corpus", "script"].includes(file.role)
              ? "document"
              : "archive",
          provenance: {
            status: "unknown",
            recorded: {
              originalPath: file.path,
              originalRole: file.role,
              ...file.provenance,
            },
          },
          idempotencyKey: studioHash({
            source: "lyuba-preserved-baseline",
            path: file.path,
            digest: file.sha256,
          }),
        },
        bytes,
        backend,
      ),
    )
  }
  return results
}
