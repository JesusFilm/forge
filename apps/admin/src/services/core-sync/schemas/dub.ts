import { z } from "zod"

export const CoreDubSchema = z.object({
  id: z.string().min(1),
  videoId: z.string().min(1),
  slug: z.string().nullable(),
  language: z
    .object({
      id: z.string().min(1),
    })
    .nullable(),
  duration: z.number().int(),
  lengthInMilliseconds: z.union([z.string(), z.number().int()]).nullable(),
  hls: z.string().nullable(),
  dash: z.string().nullable(),
  share: z.string().nullable(),
  downloadable: z.boolean(),
  published: z.boolean(),
  brightcoveId: z.string().nullable(),
  videoEdition: z
    .object({
      id: z.string().min(1),
      name: z.string().nullable(),
    })
    .nullable(),
  muxVideo: z
    .object({
      id: z.string().min(1),
      assetId: z.string().nullable(),
      playbackId: z.string().nullable(),
    })
    .nullable(),
  downloads: z.array(
    z.object({
      id: z.string().min(1),
      quality: z.string().nullable(),
      size: z.union([z.string(), z.number().int()]).nullable(),
      height: z.number().int().nullable(),
      width: z.number().int().nullable(),
      bitrate: z.number().int().nullable(),
      url: z.string().nullable(),
    }),
  ),
  updatedAt: z.string().min(1).optional(),
})
