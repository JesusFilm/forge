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
  "apps/mastra/src/evals/subtitle-translation/cloud-runner.ts",
  "apps/mastra/src/evals/subtitle-translation/metrics.ts",
  "apps/mastra/src/evals/subtitle-translation/review-evidence.ts",
  "apps/mastra/src/evals/subtitle-translation/runner.ts",
  "apps/mastra/src/evals/subtitle-translation/types.ts",
  "apps/mastra/src/evals/subtitle-translation/vtt.ts",
] as const

// Update only after the byte-pin test confirms this exact ordered file set.
export const SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST =
  "52e1ed3fea0be2fb9165c2bb6f4fc1fb58f107f6fe1692dd828ffb95e3e7a601"
