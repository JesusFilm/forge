import { z } from "zod"

import { DevotionalSourceRefSchema } from "../../services/devotional/workspace/state-schema"

export const VideoFirstDevotionalWorkflowInputSchema = z
  .object({
    /** JESUS-film chapter to use; omit to pick the next unused one. */
    chapterIndex: z.number().int().positive().optional(),
    /** Rotation counter; omit to derive it from approved devotional history. */
    sequence: z.number().int().nonnegative().optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** Committed Workspace catalog generation selected before this run. */
    workspaceGeneration: z.number().int().positive(),
    attemptId: z.string().min(1),
    selectedSources: z.array(DevotionalSourceRefSchema).min(1).max(500),
  })
  .strict()

export type VideoFirstDevotionalWorkflowInput = z.infer<
  typeof VideoFirstDevotionalWorkflowInputSchema
>
