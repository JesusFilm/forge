import express from "express"
import { AnthropicProvider } from "./providers/anthropic.mjs"
import { OpenAIProvider } from "./providers/openai.mjs"
import {
  assertHumanPublishGuard,
  assertModerationPassed,
} from "./policy/guardrails.mjs"
import { loadPromptTemplate } from "./prompts/registry.mjs"
import { VectorStore } from "./rag/vector-store.mjs"
import { saveRevision, listRevisions } from "./provenance/store.mjs"
import { createAiDraftVariant } from "./strapi/gateway.mjs"

const app = express()
const port = Number(process.env.PORT || 4010)
app.use(express.json())

const providers = {
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ai-orchestrator" })
})

app.get("/v1/ai/revisions", (_req, res) => {
  res.json({ revisions: listRevisions() })
})

app.post("/v1/ai/tasks", async (req, res) => {
  const task = req.body ?? {}

  try {
    assertHumanPublishGuard(task)
    const providerName = task.provider ?? "openai"
    const provider = providers[providerName]
    if (!provider) {
      return res.status(400).json({ error: "unknown_provider" })
    }

    const promptTemplateId = task.promptTemplateId ?? "content-draft"
    const promptTemplateVersion = task.promptTemplateVersion ?? "v1"
    const prompt = loadPromptTemplate(promptTemplateId, promptTemplateVersion)
    const vectorStore = new VectorStore()
    const retrieval = await vectorStore.retrieve(
      task.query ?? task.objective ?? "draft",
    )
    const modelOutput = await provider.generate({
      ...task,
      prompt,
      retrieval,
    })

    const moderationState = task.moderationState ?? "passed"
    assertModerationPassed(moderationState)

    const draft = await createAiDraftVariant({
      contentItemId: task.contentItemId,
      body: modelOutput.text,
    })

    const revision = saveRevision({
      contentItemId: task.contentItemId,
      objective: task.objective,
      promptTemplateId,
      promptTemplateVersion,
      policyVersion: task.policyVersion ?? "1.0.0",
      provider: provider.name,
      model: task.model ?? "default",
      confidenceScore: modelOutput.confidenceScore,
      moderationState,
      draftVariantId: draft.variantId,
      ragContextIds: retrieval.map((item) => item.id).filter(Boolean),
    })

    res.status(202).json({ accepted: true, revision, draft })
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) })
  }
})

app.listen(port, () => {
  console.log(`ai-orchestrator listening on ${port}`)
})
