import { z } from "zod"

export const createJobSchema = z.object({
  inputUrl: z
    .string()
    .url()
    .refine(
      (u: string) => u.startsWith("https://"),
      "Only HTTPS URLs are allowed",
    ),
  language: z.string().max(10).optional(),
  translateTo: z.array(z.string().max(10)).max(10).optional(),
  generateVoiceover: z.boolean().optional(),
})

export type CreateJobRequest = z.infer<typeof createJobSchema>

export function getPersistedJobLanguages(
  request: Pick<
    CreateJobRequest,
    "generateVoiceover" | "language" | "translateTo"
  >,
): string[] {
  const targets = request.translateTo ?? []
  if (!request.generateVoiceover) {
    return targets
  }

  const sourceLanguage = request.language ?? "en"

  return Array.from(new Set([sourceLanguage, ...targets]))
}
