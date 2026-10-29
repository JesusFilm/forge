export const SUBTITLE_EVAL_WORKFLOW_POLICY_FILES = [
  "apps/mastra/src/services/subtitle-enrichment/chunker.ts",
  "apps/mastra/src/services/subtitle-enrichment/language-config.ts",
  "apps/mastra/src/services/subtitle-enrichment/openrouter.ts",
  "apps/mastra/src/services/subtitle-enrichment/translator.ts",
  "apps/mastra/src/services/subtitle-enrichment/retimer.ts",
  "apps/mastra/src/services/subtitle-enrichment/scripture-context.ts",
  "apps/mastra/src/services/subtitle-enrichment/scripture-validation.ts",
  "apps/mastra/src/services/subtitle-enrichment/types.ts",
  "apps/mastra/src/services/subtitle-enrichment/vtt.ts",
  "apps/mastra/src/services/subtitle-enrichment/run.ts",
  "apps/mastra/src/services/subtitle-enrichment/transcript.ts",
  "apps/mastra/src/evals/subtitle-translation/cloud-runner.ts",
  "apps/mastra/src/evals/subtitle-translation/metrics.ts",
  "apps/mastra/src/evals/subtitle-translation/review-evidence.ts",
  "apps/mastra/src/evals/subtitle-translation/runner.ts",
  "apps/mastra/src/evals/subtitle-translation/types.ts",
  "apps/mastra/src/evals/subtitle-translation/vtt.ts",
] as const

// Update only after the byte-pin test confirms this exact ordered file set.
export const SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST =
  "3e46dd8c3b82e3b32560d5a645c08f5b2795284e3cc997b50cc68a96dc243f62"
