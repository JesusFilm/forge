import { z } from "zod"
import { studioDocumentSchema } from "./index"
export const STUDIO_RUNTIME_VERSION =
  "studio-proof-1/remotion-4.0.475/react-19.2.4/sucrase-3.35.1/hls-1.6.16"
export const studioPreviewSchema = z
  .object({
    document: studioDocumentSchema,
    media: z.record(
      z.string(),
      z
        .object({
          file: z.string().regex(/^[a-zA-Z0-9._-]{1,160}$/),
          sourceStartMs: z.number().nonnegative(),
          kind: z.enum(["hls", "audio", "image"]),
        })
        .strict(),
    ),
    code: z.record(z.string(), z.string().max(32768)),
  })
  .strict()
export type StudioPreview = z.infer<typeof studioPreviewSchema>
