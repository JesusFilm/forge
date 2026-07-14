import { z } from "zod"

/**
 * Audience persona definition (origin R9). Mastra-owned: the generator threads a
 * persona into the draft prompts so one topic is shaped for that audience.
 *
 * The roster (`apps/mastra/src/config/personas/persona-roster.ts`) is committed,
 * versioned DATA — editable without a code change (R10). The starter roster is a
 * placeholder pending a ministry-confirmed audience list.
 */
export const PersonaSchema = z
  .object({
    /** Stable kebab-case id used in trigger requests and variant slugs. */
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9-]*$/, "persona id must be kebab-case"),
    /** Human-facing audience name, e.g. "Grieving". */
    name: z.string().min(1).max(120),
    /** One-line description for picker/listing surfaces. */
    blurb: z.string().min(1).max(280),
    /** Voice + register the copy should adopt for this audience. */
    tone: z.string().min(1),
    /** What this audience most needs from the page. */
    needs: z.array(z.string().min(1)).min(1),
    /** How Scripture should be used (or held back) for this audience. */
    scripturePosture: z.string().min(1),
    /** The emotional outcome the page should aim for. */
    emotionalGoal: z.string().min(1),
    /** Where this audience tends to be in their faith journey. */
    faithStage: z.string().min(1),
    /** Cultural context to honour (or avoid assuming). */
    culturalContext: z.string().min(1),
  })
  .strict()

export type Persona = z.infer<typeof PersonaSchema>

/** Compact persona shape for listing/picker surfaces (no steering detail). */
export type PersonaSummary = Pick<Persona, "id" | "name" | "blurb">
