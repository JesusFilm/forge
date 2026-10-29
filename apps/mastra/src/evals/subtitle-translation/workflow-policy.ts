export const SUBTITLE_EVAL_WORKFLOW_POLICY_FILES = [
  "apps/mastra/src/services/subtitle-enrichment/chunker.ts",
  "apps/mastra/src/services/subtitle-enrichment/language-config.ts",
  "apps/mastra/src/services/subtitle-enrichment/openrouter.ts",
  "apps/mastra/src/services/video-enrichment/provider-spend.ts",
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
  "6d65176d66f9b71ca7de75a14abdd978c7cbcc0cae74c42b0e727f52b367d426"
