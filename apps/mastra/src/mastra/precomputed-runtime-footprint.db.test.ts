import { randomUUID } from "node:crypto"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Mastra } from "@mastra/core"
import type { AnySpan, SpanOutputProcessor } from "@mastra/core/observability"
import { MastraCompositeStore } from "@mastra/core/storage"
import { DuckDBStore } from "@mastra/duckdb"
import {
  MastraStorageExporter,
  Observability,
  SamplingStrategyType,
} from "@mastra/observability"
import { PostgresStore } from "@mastra/pg"
import { Pool } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { StructuredModel } from "../services/precomputed-recommendations/astra-provider"
import { SourceGenerationInputSchema } from "../services/precomputed-recommendations/source-generation"
import { precomputedSourceGenerationWorkflow } from "./workflows/precomputed-source-generation"

vi.mock(
  "../services/precomputed-recommendations/source-generation",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../services/precomputed-recommendations/source-generation")
      >()
    return {
      ...actual,
      runPrecomputedSource: async (
        input: Parameters<typeof actual.runPrecomputedSource>[0],
      ) => {
        const video = {
          id: "source-video",
          coreId: "source-core",
          slug: "source-film",
          locale: "en",
          title: "Source film",
          description: "Source description",
          descriptionTruncated: false,
          keywords: [],
          keywordsTruncated: false,
          bibleCitations: [],
          bibleCitationsTruncated: false,
          parentVideoIds: [],
          childVideoIds: [],
          transcriptLanguages: ["en"],
        }
        const chunk = {
          id: "chunk-one",
          language: "en",
          transcriptId: "transcript-one",
          chunkIndex: 0,
          text: "RAW_TRANSCRIPT_SENTINEL_PRIVATE says the central theme clearly.",
        }
        const model: StructuredModel = {
          async generate({ schema, prompt }) {
            let output: unknown
            if (prompt.includes('"task":"source_summary"')) {
              expect(prompt).toContain("RAW_TRANSCRIPT_SENTINEL_PRIVATE")
              output = {
                summaryEnglish:
                  "RAW_MODEL_RESPONSE_SENTINEL_PRIVATE is a sufficiently long English summary.",
              }
            } else {
              expect(prompt).toContain("RAW_MODEL_RESPONSE_SENTINEL_PRIVATE")
              output = { candidateVideoIds: [] }
            }
            return {
              output: schema.parse(output),
              usage: { inputTokens: 12, outputTokens: 8, cachedInputTokens: 0 },
            }
          },
        }
        return actual.runPrecomputedSource(input, {
          catalog: {
            video: async () => video,
            catalog: async () => ({ videos: [video], nextCursor: null }),
            chunks: async () => ({ chunks: [chunk], nextCursor: null }),
          },
          ingest: async (raw) => {
            const action = (raw as { action: string }).action
            if (action === "status") return null
            return {
              state: action === "complete" ? "complete" : "incomplete",
              replay: false,
            }
          },
          model,
        })
      },
    }
  },
)

const url = process.env.PRECOMPUTED_RUNTIME_DB_TEST_URL
const schema = `precomputed_footprint_${randomUUID().replaceAll("-", "").slice(0, 12)}`

describe.skipIf(!url)("real precomputed workflow runtime footprint", () => {
  let directory: string
  let duckdb: DuckDBStore
  const pool = new Pool({ connectionString: url, max: 1 })

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${schema}"`)
    directory = await mkdtemp(join(tmpdir(), "forge-precomputed-footprint-"))
    duckdb = new DuckDBStore({
      id: "precomputed-footprint",
      path: join(directory, "traces.duckdb"),
    })
    await duckdb.observability.init()
  })

  afterAll(async () => {
    await duckdb?.close()
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it("persists a compact precomputed run and redacted trace without raw work payloads", async () => {
    const redact: SpanOutputProcessor = {
      name: "forge-redact-prompt-bodies",
      process(span: AnySpan) {
        span.input = span.input == null ? span.input : "[REDACTED_BY_FORGE]"
        span.output = span.output == null ? span.output : "[REDACTED_BY_FORGE]"
        return span
      },
      shutdown: async () => {},
    }
    const pgstore = new PostgresStore({
      id: "precomputed-footprint-pg",
      connectionString: url!,
      schemaName: schema,
    })
    const mastra = new Mastra({
      workflows: { precomputedSourceGenerationWorkflow },
      storage: new MastraCompositeStore({
        id: "precomputed-footprint-store",
        default: pgstore,
        domains: { observability: duckdb.observability },
      }),
      observability: new Observability({
        sensitiveDataFilter: true,
        configs: {
          default: {
            serviceName: "precomputed-footprint",
            sampling: { type: SamplingStrategyType.ALWAYS },
            spanOutputProcessors: [redact],
            exporters: [new MastraStorageExporter({ maxBatchWaitMs: 100 })],
          },
        },
      }),
    })
    const workflow = mastra.getWorkflow("precomputedSourceGenerationWorkflow")
    const run = await workflow.createRun({ runId: randomUUID() })
    const started = await run.startAsync({
      inputData: SourceGenerationInputSchema.parse({
        generationId: "footprint-generation",
        sourceVideoId: "source-video",
        inputCutoff: "2026-08-01T00:00:00.000Z",
        historyRequired: false,
      }),
      tracingOptions: {
        hideInput: true,
        hideOutput: true,
        metadata: {
          precomputedGenerationId: "footprint-generation",
          precomputedInputCutoff: "2026-08-01T00:00:00.000Z",
          precomputedHistoryRequired: false,
        },
      },
    })
    expect(started.runId).toBe(run.runId)
    let state = await workflow.getWorkflowRunById(run.runId)
    for (
      let attempt = 0;
      attempt < 40 && state?.status !== "success";
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      state = await workflow.getWorkflowRunById(run.runId)
    }
    expect(state?.status).toBe("success")
    const snapshot = await pool.query<{
      snapshot: string
      snapshot_bytes: number
    }>(
      `SELECT snapshot::text, pg_column_size(snapshot) AS snapshot_bytes
       FROM "${schema}".mastra_workflow_snapshot WHERE run_id = $1`,
      [run.runId],
    )
    expect(snapshot.rows).toHaveLength(1)
    expect(snapshot.rows[0].snapshot).toContain("footprint-generation")
    for (const marker of [
      "RAW_TRANSCRIPT_SENTINEL",
      "RAW_MODEL_RESPONSE_SENTINEL",
    ])
      expect(snapshot.rows[0].snapshot).not.toContain(marker)

    let traces = await duckdb.observability.listTraces({
      filters: { entityId: "precomputed-source-generation" },
      pagination: { page: 0, perPage: 10 },
    })
    for (
      let attempt = 0;
      attempt < 20 && traces.spans.length === 0;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      traces = await duckdb.observability.listTraces({
        filters: { entityId: "precomputed-source-generation" },
        pagination: { page: 0, perPage: 10 },
      })
    }
    expect(traces.spans.length).toBeGreaterThan(0)
    expect(traces.spans[0]).toMatchObject({
      entityId: "precomputed-source-generation",
      runId: run.runId,
      metadata: {
        precomputedGenerationId: "footprint-generation",
        precomputedInputCutoff: "2026-08-01T00:00:00.000Z",
        precomputedHistoryRequired: false,
      },
    })
    const trace = await duckdb.observability.getTrace({
      traceId: traces.spans[0].traceId,
    })
    const serializedTrace = JSON.stringify(trace)
    for (const marker of [
      "RAW_TRANSCRIPT_SENTINEL",
      "RAW_MODEL_RESPONSE_SENTINEL",
    ])
      expect(serializedTrace).not.toContain(marker)
    await mastra.shutdown()
    const duckdbFileBytes = (await stat(join(directory, "traces.duckdb"))).size
    console.info(
      `[precomputed-footprint-fixture] snapshot_column_bytes=${snapshot.rows[0].snapshot_bytes} trace_json_bytes=${Buffer.byteLength(serializedTrace)} shared_duckdb_file_bytes=${duckdbFileBytes}`,
    )
  })
})
