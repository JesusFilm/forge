import { z } from "zod"

export const concepts = [
  "spotlight",
  "continue",
  "collection",
  "short",
  "journey",
] as const
export type Concept = (typeof concepts)[number]
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/)
const image = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password
  })
export const itemSchema = z
  .object({
    id: identifier,
    slug: identifier,
    title: z.string().min(1).max(200),
    summary: z.string().max(500),
    imageURL: image,
    duration: z.number().finite().nonnegative(),
    kind: z.enum(["video", "section"]),
    progress: z.number().min(0).max(1).optional(),
    previewURL: image.optional(),
  })
  .strict()
export type ShelfItem = z.infer<typeof itemSchema>
export const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    concept: z.enum(concepts),
    language: identifier,
    source: z.enum(["recommendations", "editorial"]).default("editorial"),
    generatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    items: z.array(itemSchema).max(10),
  })
  .strict()
export type ShelfSnapshot = z.infer<typeof snapshotSchema>
export type Rotation = { day: string; concept: Concept; remaining: Concept[] }
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}
export function selectConcept(
  eligible: readonly Concept[],
  previous: Rotation | null,
  day: string,
  random: () => number = Math.random,
): Rotation | null {
  const choices = [...new Set(eligible)]
  if (!choices.length) return null
  if (previous?.day === day && choices.includes(previous.concept))
    return previous
  let remaining =
    previous?.remaining.filter((value) => choices.includes(value)) ?? []
  if (!remaining.length) {
    remaining = [...choices]
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))))
      ;[remaining[i], remaining[j]] = [remaining[j], remaining[i]]
    }
  }
  if (remaining[0] === previous?.concept && choices.length > 1) {
    const next = remaining.findIndex((value) => value !== previous.concept)
    if (next >= 0)
      [remaining[0], remaining[next]] = [remaining[next], remaining[0]]
    else remaining = choices.filter((value) => value !== previous.concept)
  }
  return { day, concept: remaining[0], remaining: remaining.slice(1) }
}
export function parseRotation(raw: string | null): Rotation | null {
  try {
    return z
      .object({
        day: z.string(),
        concept: z.enum(concepts),
        remaining: z.array(z.enum(concepts)),
      })
      .parse(JSON.parse(raw ?? "null"))
  } catch {
    return null
  }
}
