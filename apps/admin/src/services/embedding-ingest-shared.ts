import { z } from "zod"

export const EmbeddingGenerationModeSchema = z
  .enum(["idempotent", "repair", "force", "model-upgrade"])
  .default("idempotent")

export type EmbeddingGenerationMode = z.infer<
  typeof EmbeddingGenerationModeSchema
>
export type EmbeddingRewriteMode = Exclude<
  EmbeddingGenerationMode,
  "idempotent"
>

export type EmbeddingIngestStatus =
  | "created"
  | "unchanged"
  | "repaired"
  | "forced"
  | "model_upgraded"
  | "rejected"

export const EmbeddingTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "must be a valid timestamp",
  })

export function statusForEmbeddingRewrite(
  mode: EmbeddingRewriteMode,
): Exclude<EmbeddingIngestStatus, "created" | "unchanged" | "rejected"> {
  switch (mode) {
    case "repair":
      return "repaired"
    case "model-upgrade":
      return "model_upgraded"
    case "force":
      return "forced"
  }
}
