import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { Mastra } from "@mastra/core"
import type { AnySpan, SpanOutputProcessor } from "@mastra/core/observability"
import { registerApiRoute } from "@mastra/core/server"
import { InMemoryStore, MastraCompositeStore } from "@mastra/core/storage"
import { DuckDBStore } from "@mastra/duckdb"
import { PinoLogger } from "@mastra/loggers"
import {
  MastraStorageExporter,
  Observability,
  SamplingStrategyType,
} from "@mastra/observability"
import { PostgresStore } from "@mastra/pg"

import {
  env,
  assertMastraRuntimeEnv,
  getMastraDatabaseUrl,
  getMastraStorageDir,
} from "../config/env"
import { smokeAgent, createSmokeResponse } from "./agents/smoke-agent"
import { seekerAgent } from "./agents/seeker-agent"
import { webResearchAgent } from "./agents/web-research-agent"
import { buildDefaultChatAgent } from "./agents/default-chat-agent"
import { buildSpecializedAgents } from "./agents/specialized-agents"
import { buildAutoEnrichAgent } from "./agents/auto-enrich-agent"
import {
  multiStepDraftWorkflow,
  quickDraftWorkflow,
} from "./workflows/multi-step-draft"
import {
  handleExperienceDraftRouteRequest,
  type DraftWorkflowMastra,
} from "./workflows/experience-draft-route"
import { handleExperienceVariantRouteRequest } from "./workflows/experience-variant-route"
import {
  handleExperienceSectionRouteRequest,
  type SectionAgentMastra,
} from "./workflows/experience-section-route"
import {
  handleExperienceChatRouteRequest,
  type ExperienceChatRouteMastra,
} from "./agents/experience-chat-route"
import {
  handleSeekerRouteRequest,
  type SeekerRouteMastra,
} from "./agents/seeker-route"
import {
  handleTranscriptEmbeddingRouteRequest,
  transcriptEmbeddingWorkflow,
} from "./workflows/transcript-embedding"
import {
  experienceEmbeddingWorkflow,
  handleExperienceEmbeddingRouteRequest,
} from "./workflows/experience-embedding"
import {
  evalQueryGenerationWorkflow,
  handleEvalQueryGenerationRouteRequest,
} from "./workflows/eval-query-generation"
import {
  handleOfflineSearchEvalRouteRequest,
  offlineSearchEvalWorkflow,
} from "./workflows/offline-search-eval"
import {
  handleSearchEvalCandidateReviewRouteRequest,
  searchEvalCandidateReviewWorkflow,
} from "./workflows/search-eval-candidate-review"
import {
  configureSearchEvalNativeSuiteRuntime,
  handleSearchEvalNativeSuiteRouteRequest,
  searchEvalNativeSuiteWorkflow,
} from "./workflows/search-eval-native-suite"
import {
  handleSearchEvalOrchestratorRouteRequest,
  searchEvalOrchestratorWorkflow,
} from "./workflows/search-eval-orchestrator"
import {
  handleSearchEvalBaselinePortabilityRouteRequest,
  searchEvalBaselinePortabilityWorkflow,
} from "./workflows/search-eval-baseline-portability"
import {
  firecrawlWebDataWorkflow,
  handleFirecrawlWebDataRouteRequest,
} from "./workflows/firecrawl-web-data"
import {
  handleSmartCropPlanRouteRequest,
  smartCropPlanWorkflow,
} from "./workflows/smart-crop-plan"
import {
  handleSmartCropAlignRouteRequest,
  smartCropAlignWorkflow,
} from "./workflows/smart-crop-align"
import {
  handleSmartCropQaRouteRequest,
  smartCropQaWorkflow,
} from "./workflows/smart-crop-qa"
import {
  handleSmartCropRepairRouteRequest,
  smartCropRepairWorkflow,
} from "./workflows/smart-crop-repair"
import {
  handleInstagramDiscoveryRouteRequest,
  instagramAiChristianDiscoveryWorkflow,
} from "./workflows/instagram-ai-christian-discovery"
import {
  handleSubtitleEnrichmentRouteRequest,
  subtitleEnrichmentWorkflow,
} from "./workflows/subtitle-enrichment"
import {
  handleTranscriptScriptureCorrectionRouteRequest,
  transcriptScriptureCorrectionWorkflow,
} from "./workflows/transcript-scripture-correction"
import {
  isValidServiceBearer,
  parseServiceApiKeys,
} from "../server/service-bearer"
import { startAiChatRetentionPurge } from "./ai-chat-retention"

assertMastraRuntimeEnv()

const serviceKeys = parseServiceApiKeys(env.MASTRA_SERVICE_API_KEYS)
const storageDir = getMastraStorageDir()
const storageSchemaName = "mastra"

mkdirSync(storageDir, { recursive: true })

const storage =
  env.MASTRA_STORAGE_BACKEND === "memory"
    ? new InMemoryStore({ id: "mastra-memory-storage" })
    : new PostgresStore({
        id: "mastra-postgres-storage",
        connectionString: getMastraDatabaseUrl(),
        schemaName: storageSchemaName,
      })
const observabilityStore = new DuckDBStore({
  id: "mastra-observability-storage",
  path: join(storageDir, "mastra-observability.duckdb"),
})

const redactPromptBodies: SpanOutputProcessor = {
  name: "forge-redact-prompt-bodies",
  process(span: AnySpan) {
    span.input = span.input == null ? span.input : "[REDACTED_BY_FORGE]"
    span.output = span.output == null ? span.output : "[REDACTED_BY_FORGE]"
    return span
  },
  shutdown: async () => {},
}

// Draft/chat agents ported from admin (consolidation U4). Built once here so
// the experience-chat Memory singleton is shared and the workflow agents are
// registered by id for the workflow's `getAgentById(...)` lookups. The
// planner/critic/reviser/skeleton/fill agents are workflow-only (memory-less);
// experience-default-chat / draft-experience / add-section / rewrite-copy /
// auto-enrich carry the chat memory.
const experienceDraftSpecializedAgents = buildSpecializedAgents()

export const mastra = new Mastra({
  agents: {
    smokeAgent,
    seekerAgent,
    webResearchAgent,
    "experience-default-chat": buildDefaultChatAgent(),
    ...experienceDraftSpecializedAgents,
    "auto-enrich": buildAutoEnrichAgent(),
  },
  workflows: {
    transcriptEmbeddingWorkflow,
    experienceEmbeddingWorkflow,
    evalQueryGenerationWorkflow,
    offlineSearchEvalWorkflow,
    searchEvalCandidateReviewWorkflow,
    searchEvalNativeSuiteWorkflow,
    searchEvalOrchestratorWorkflow,
    searchEvalBaselinePortabilityWorkflow,
    firecrawlWebDataWorkflow,
    smartCropPlanWorkflow,
    smartCropAlignWorkflow,
    smartCropQaWorkflow,
    smartCropRepairWorkflow,
    instagramAiChristianDiscoveryWorkflow,
    subtitleEnrichmentWorkflow,
    transcriptScriptureCorrectionWorkflow,
    // Ported draft-authoring workflows (consolidation U4). Registered by their
    // workflow id so the U5 route can drive them via
    // `mastra.getWorkflowById("multi-step-draft" | "quick-draft")` — which
    // injects this Mastra instance so each step's `getAgentById(...)` resolves
    // the planner/skeleton/fill/critic/reviser agents registered above.
    "multi-step-draft": multiStepDraftWorkflow,
    "quick-draft": quickDraftWorkflow,
  },
  logger: new PinoLogger({
    name: "ForgeMastra",
    prettyPrint: env.NODE_ENV !== "production",
    redact: {
      paths: [
        "authorization",
        "headers.authorization",
        "cookie",
        "headers.cookie",
        "*.token",
        "*.secret",
        "*.apiKey",
      ],
      censor: "[REDACTED]",
    },
  }),
  storage: new MastraCompositeStore({
    id: "mastra-storage",
    default: storage,
    domains: {
      observability: observabilityStore.observability,
    },
  }),
  observability: new Observability({
    sensitiveDataFilter: true,
    configs: {
      default: {
        serviceName: "forge-mastra",
        sampling: { type: SamplingStrategyType.ALWAYS },
        logging: { enabled: true, level: "info" },
        spanOutputProcessors: [redactPromptBodies],
        exporters: [new MastraStorageExporter()],
      },
    },
  }),
  server: {
    studioBase: "/studio",
    apiRoutes: [
      registerApiRoute("/forge-smoke", {
        method: "POST",
        handler: async (c) => {
          const authHeader = c.req.header("authorization")
          if (
            !isValidServiceBearer({
              authHeader,
              allowlist: serviceKeys,
            })
          ) {
            return c.json({ error: "Service bearer required" }, 401)
          }

          const body = (await c.req.json().catch(() => ({}))) as {
            input?: unknown
          }
          return c.json(createSmokeResponse(String(body.input ?? "smoke")))
        },
      }),
      registerApiRoute("/forge-transcript-embeddings", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleTranscriptEmbeddingRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-scene-embeddings", {
        method: "POST",
        handler: (c) =>
          c.json(
            {
              error: "Legacy scene embedding workflow has been retired",
              reason: "legacy_scene_embedding_pipeline_removed",
              retryable: false,
              replacement:
                "Search uses transcript embeddings; historical scene data is retained for feat-199.",
            },
            410,
          ),
      }),
      registerApiRoute("/forge-firecrawl-web-data", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleFirecrawlWebDataRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-experience-embeddings", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleExperienceEmbeddingRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-experience-draft", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleExperienceDraftRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
            // Thunk resolves at request time, after `mastra` is constructed —
            // so the workflow steps' `getAgentById(...)` lookups resolve the
            // registered planner/skeleton/fill/critic/reviser agents. Boundary
            // cast: the route's `DraftWorkflowMastra` is a deliberately narrow
            // structural surface (getWorkflowById → createRun → start/cancel),
            // all present at runtime; the real Mastra's `getWorkflowById` has a
            // narrower id-union param than `(id: string)`, so the structural
            // types don't unify. Tests inject a fully-typed fake.
            getMastra: () => mastra as unknown as DraftWorkflowMastra,
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-experience-variant", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleExperienceVariantRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
            // Same narrow workflow surface as the draft route (it delegates to
            // the draft generation path); the thunk resolves post-construction.
            getMastra: () => mastra as unknown as DraftWorkflowMastra,
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-experience-section", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleExperienceSectionRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
            // Thunk resolves at request time so the agent registry is built.
            getMastra: () => mastra as unknown as SectionAgentMastra,
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-experience-chat", {
        method: "POST",
        handler: async (c) =>
          handleExperienceChatRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
            getMastra: () => mastra as unknown as ExperienceChatRouteMastra,
            requestSignal: c.req.raw.signal,
          }),
      }),
      registerApiRoute("/forge-seeker", {
        method: "POST",
        handler: async (c) =>
          handleSeekerRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
            getMastra: () => mastra as unknown as SeekerRouteMastra,
            requestSignal: c.req.raw.signal,
          }),
      }),
      registerApiRoute("/forge-eval-query-generation", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleEvalQueryGenerationRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-offline-search-eval", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleOfflineSearchEvalRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            request: c.req.raw,
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-search-eval-candidate-review", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleSearchEvalCandidateReviewRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-search-eval-native-suite", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleSearchEvalNativeSuiteRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            request: c.req.raw,
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-search-eval-orchestrator", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleSearchEvalOrchestratorRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            request: c.req.raw,
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-smart-crop-plan", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleSmartCropPlanRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-smart-crop-align", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleSmartCropAlignRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-smart-crop-qa", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleSmartCropQaRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-smart-crop-repair", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleSmartCropRepairRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-search-eval-baseline-portability", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleSearchEvalBaselinePortabilityRouteRequest(
            {
              authHeader: c.req.header("authorization"),
              serviceKeys,
              request: c.req.raw,
            },
          )

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-instagram-discovery", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleInstagramDiscoveryRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-subtitle-enrichment", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleSubtitleEnrichmentRouteRequest({
            authHeader: c.req.header("authorization"),
            serviceKeys,
            readJson: () => c.req.json(),
          })

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
      registerApiRoute("/forge-transcript-scripture-correction", {
        method: "POST",
        handler: async (c) => {
          const outcome = await handleTranscriptScriptureCorrectionRouteRequest(
            {
              authHeader: c.req.header("authorization"),
              serviceKeys,
              readJson: () => c.req.json(),
            },
          )

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: { "content-type": "application/json" },
          })
        },
      }),
    ],
  },
})

configureSearchEvalNativeSuiteRuntime(() => mastra)

// ai-chat retention purge (feat-208): boot drain + daily timer over the
// `ai_chat` schema. Gated to the deployed runtime (NODE_ENV=production) so a
// build / `mastra dev` CLI-analysis import never fires DB I/O at module load;
// it additionally no-ops unless a postgres backend is configured at all
// (canAiChatDataPersist) — deliberately NOT the resolved ai-chat backend: the
// kill-switch (AI_CHAT_MEMORY_BACKEND=memory) stops writes, never retention
// on already-stored rows. Single-instance assumption: replicas would each run
// redundant (harmless, wasteful) sweeps — add a leader guard before scaling out.
if (env.NODE_ENV === "production") {
  startAiChatRetentionPurge()
}
