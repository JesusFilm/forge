import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"
const { jobs } = vi.hoisted(() => ({ jobs: new Map<string, JobRecord>() }))
vi.mock("@/config/env", () => ({ env: { MANAGER_API_KEY: "fixture-secret" } }))
vi.mock("@/lib/auth", () => ({ authenticateRequest: async () => null }))
vi.mock("@/lib/state", () => ({
  getJob: async (id: string) => structuredClone(jobs.get(id) ?? null),
  updateJob: async (
    id: string,
    updates: Partial<JobRecord>,
    revision: number,
  ) => {
    const current = jobs.get(id)
    if (!current || current.revision !== revision) return null
    const next = { ...current, ...updates, revision: revision + 1 }
    jobs.set(id, next)
    return structuredClone(next)
  },
  mergeJobArtifacts: async (id: string, artifacts: JobRecord["artifacts"]) => {
    const job = jobs.get(id)!
    job.artifacts = { ...job.artifacts, ...artifacts }
    return job
  },
}))
import {
  enrichmentJobAssetId,
  prepareEnrichmentArtifactNamespace,
} from "./enrichment-artifact-namespace"
import { getJobArtifactStorageAssetId } from "./job-artifacts"
import { executeEnrichmentOperation } from "./enrichment-execution"
import { getJob, updateJob } from "@/lib/state"
import { readArtifact, writeArtifact } from "@/services/storage"
import { GET } from "@/app/api/jobs/[id]/artifacts/[artifact]/route"
import type { ExecutionRequest } from "./enrichment-execution-contract"

const prefixes = new Set<string>()
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  jobs.clear()
  await Promise.all(
    [...prefixes].map((id) =>
      rm(join(process.cwd(), ".tmp/artifacts", id), {
        recursive: true,
        force: true,
      }),
    ),
  )
  prefixes.clear()
})
function job(muxAssetId = `legacy-${randomUUID()}`): JobRecord {
  const id = `isolation-${randomUUID()}`
  prefixes.add(muxAssetId)
  prefixes.add(enrichmentJobAssetId(id))
  return {
    id,
    revision: 0,
    muxAssetId,
    muxPlaybackId: "fixture-playback",
    languages: ["fr"],
    options: { engine: "mastra" },
    status: "pending",
    artifacts: {},
    steps: [],
    errors: [],
    retries: 0,
    createdAt: "",
    updatedAt: "",
  }
}
const claim = vi.fn(async () => ({
  status: "claimed" as const,
  claimToken: "fixture-token",
}))
const complete = vi.fn(async () => ({ status: "replayed" as const }))
async function execute(j: JobRecord, operation: ExecutionRequest["operation"]) {
  return executeEnrichmentOperation(
    { jobId: j.id, runId: "owned-run", inputDigest: "a".repeat(64), operation },
    {
      getJob: async (id) => jobs.get(id) ?? null,
      claim,
      complete,
    },
  )
}
function running(j: JobRecord) {
  const next = {
    ...j,
    status: "running" as const,
    options: { ...j.options, currentRunId: "owned-run" },
  }
  jobs.set(j.id, next)
  return next
}

it("materializes only declared fixed legacy descriptors, preserves bytes and does not approve source reuse", async () => {
  const j = job()
  j.artifacts = {
    transcript: { kind: "downloadable" },
    subtitles: { kind: "downloadable" },
    metadata: { kind: "downloadable" },
  }
  jobs.set(j.id, j)
  for (const [artifactType, ext, body] of [
    ["transcript", "json", '{"legacy":true}'],
    ["subtitles", "vtt", "WEBVTT\nlegacy"],
    ["metadata", "json", '{"title":"old title"}'],
  ]) {
    await writeArtifact({ assetId: j.muxAssetId, artifactType, ext, body })
  }
  const prepared = await prepareEnrichmentArtifactNamespace(j.id)
  expect(prepared.revision).toBe(2)
  expect(prepared.options.enrichmentArtifacts).toEqual({
    assetId: enrichmentJobAssetId(j.id),
    status: "ready",
    sourceVerified: false,
  })
  for (const [type, ext] of [
    ["transcript", "json"],
    ["subtitles", "vtt"],
    ["metadata", "json"],
  ]) {
    expect(
      await readArtifact(getJobArtifactStorageAssetId(prepared), type, ext),
    ).toEqual(await readArtifact(j.muxAssetId, type, ext))
  }
  const read = await GET(new Request("https://manager.test/artifact"), {
    params: Promise.resolve({ id: j.id, artifact: "metadata" }),
  })
  expect(await read.json()).toEqual({ title: "old title" })
  const owned = running(prepared)
  claim.mockClear()
  expect(
    (
      await execute(owned, {
        kind: "run-admission",
        assetId: enrichmentJobAssetId(j.id),
        muxAssetId: j.muxAssetId,
        sourceReuse: "transcript",
      })
    ).body,
  ).toEqual({ error: "unverified_source_reuse" })
  expect(claim).not.toHaveBeenCalled()
})

it("uses CAS to allow only one preparation and never recopies on ready reruns", async () => {
  const j = job()
  jobs.set(j.id, j)
  const results = await Promise.allSettled([
    prepareEnrichmentArtifactNamespace(j.id),
    prepareEnrichmentArtifactNamespace(j.id),
  ])
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1)
  const prepared = await prepareEnrichmentArtifactNamespace(j.id)
  expect(prepared.revision).toBe(2)
})

it("preserves legacy reads after a partial copy failure and refuses automatic preparation replay", async () => {
  const j = job()
  j.artifacts = {
    metadata: { kind: "downloadable" },
    transcript: { kind: "downloadable" },
  }
  jobs.set(j.id, j)
  await writeArtifact({
    assetId: j.muxAssetId,
    artifactType: "metadata",
    ext: "json",
    body: '{"retained":true}',
  })
  await expect(prepareEnrichmentArtifactNamespace(j.id)).rejects.toThrow()
  expect(jobs.get(j.id)?.options.enrichmentArtifacts?.status).toBe("preparing")
  const read = await GET(new Request("https://manager.test/artifact"), {
    params: Promise.resolve({ id: j.id, artifact: "metadata" }),
  })
  expect(await read.json()).toEqual({ retained: true })
  await expect(prepareEnrichmentArtifactNamespace(j.id)).rejects.toThrow(
    "reconciliation",
  )
})

it("rejects shared, foreign, stale and unbound namespace admission before claiming or side effects", async () => {
  const j = job()
  jobs.set(j.id, j)
  const owned = running(await prepareEnrichmentArtifactNamespace(j.id))
  expect(
    (
      await execute(owned, {
        kind: "run-admission",
        assetId: enrichmentJobAssetId(j.id),
        muxAssetId: j.muxAssetId,
        sourceReuse: "none",
      })
    ).status,
  ).toBe(200)
  owned.options.enrichmentArtifacts!.sourceVerified = true
  owned.artifacts.transcript = { kind: "downloadable" }
  expect(
    (
      await execute(owned, {
        kind: "run-admission",
        assetId: enrichmentJobAssetId(j.id),
        muxAssetId: j.muxAssetId,
        sourceReuse: "transcript",
      })
    ).status,
  ).toBe(200)
  const other = job(j.muxAssetId)
  for (const assetId of [
    j.muxAssetId,
    enrichmentJobAssetId(other.id),
    "stale-namespace",
  ]) {
    claim.mockClear()
    expect(
      (
        await execute(owned, {
          kind: "run-admission",
          assetId,
          muxAssetId: j.muxAssetId,
          sourceReuse: "none",
        })
      ).status,
    ).toBe(400)
    expect(claim).not.toHaveBeenCalled()
  }
  owned.options.enrichmentArtifacts = {
    assetId: enrichmentJobAssetId(other.id),
    status: "ready",
    sourceVerified: true,
  }
  claim.mockClear()
  expect(
    (
      await execute(owned, {
        kind: "run-admission",
        assetId: enrichmentJobAssetId(other.id),
        muxAssetId: j.muxAssetId,
        sourceReuse: "none",
      })
    ).status,
  ).toBe(400)
  expect(claim).not.toHaveBeenCalled()
})

it("keeps concurrent jobs sharing Mux isolated through real correction, download and Mux publication readers", async () => {
  const a = job(),
    b = job(a.muxAssetId)
  jobs.set(a.id, a)
  jobs.set(b.id, b)
  const [left, right] = (
    await Promise.all([
      prepareEnrichmentArtifactNamespace(a.id),
      prepareEnrichmentArtifactNamespace(b.id),
    ])
  ).map(running)
  expect(getJobArtifactStorageAssetId(left)).not.toBe(
    getJobArtifactStorageAssetId(right),
  )
  vi.stubEnv("MANAGER_PUBLIC_URL", "https://manager.test")
  const publicationUrls: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === "POST") {
        publicationUrls.push(JSON.parse(String(init.body)).url)
        return Response.json({
          data: { id: `track-${publicationUrls.length}` },
        })
      }
      return Response.json({ data: { tracks: [] } })
    }),
  )
  await Promise.all(
    [left, right].map(async (j, index) => {
      const text = index === 0 ? "Jesus was good" : "Jesus was wise"
      const assetId = getJobArtifactStorageAssetId(j)
      await writeArtifact({
        assetId,
        artifactType: "transcript",
        ext: "json",
        body: JSON.stringify({
          text,
          segments: [{ start: 0, end: 2, text }],
          language: "en",
        }),
      })
      const correction = await execute(j, {
        kind: "apply-transcript-corrections",
        correction: {
          status: "reviewed",
          basis: "model_knowledge",
          contentDomain: "bible_story",
          confidence: 1,
          checkedReferenceCount: 1,
          candidateCount: 1,
          flaggedCount: 0,
          likelyBibleReferences: [],
          findings: [
            {
              action: "apply_candidate",
              category: "scripture_phrase",
              segmentIndex: 0,
              start: 0,
              end: 2,
              originalText: index === 0 ? "good" : "wise",
              correctedText: index === 0 ? "kind" : "true",
              confidence: 1,
              basis: "model_knowledge",
              rationale: "Fixture judgment",
            },
          ],
        },
      })
      expect(correction.status).toBe(200)
      await writeArtifact({
        assetId,
        artifactType: "subtitles-fr",
        ext: "vtt",
        body: `WEBVTT\n\n00:00.000 --> 00:02.000\ntranslation for ${j.id}\n`,
      })
      j.artifacts = {
        transcript: { kind: "downloadable" },
        "subtitles-fr": { kind: "downloadable" },
      }
      const publication = await execute(j, {
        kind: "mux-publication",
        languageResults: [{ lang: "fr", status: "completed" }],
      })
      expect(publication.status).toBe(200)
      expect(j.artifacts.muxSync).toMatchObject({
        kind: "metadata",
        data: {
          comparisons: [
            expect.objectContaining({
              status: "synced",
              generatedPreview: `translation for ${j.id}`,
            }),
          ],
        },
      })
    }),
  )
  expect(publicationUrls).toHaveLength(2)
  for (const [j, text] of [
    [left, "Jesus was kind"],
    [right, "Jesus was true"],
  ] as const) {
    const read = await GET(new Request("https://manager.test/artifact"), {
      params: Promise.resolve({ id: j.id, artifact: "transcript" }),
    })
    expect(await read.json()).toMatchObject({ text })
    const url = publicationUrls.find((url) => url.includes(j.id))!
    const published = await GET(new Request(url), {
      params: Promise.resolve({ id: j.id, artifact: "subtitles-fr" }),
    })
    expect(await published.text()).toContain(`translation for ${j.id}`)
  }
})

it("rejects unsupported or excessive legacy manifests without changing the legacy read binding", async () => {
  const j = job()
  j.artifacts = { "unrecognized-file": { kind: "downloadable" } }
  jobs.set(j.id, j)
  await expect(prepareEnrichmentArtifactNamespace(j.id)).rejects.toThrow(
    "Unsupported legacy artifact",
  )
  expect(jobs.get(j.id)?.revision).toBe(0)
  expect(getJobArtifactStorageAssetId(jobs.get(j.id)!)).toBe(j.muxAssetId)
  j.artifacts = Object.fromEntries(
    Array.from({ length: 257 }, (_, i) => [
      `subtitles-lang${i}`,
      { kind: "downloadable" },
    ]),
  )
  await expect(prepareEnrichmentArtifactNamespace(j.id)).rejects.toThrow(
    "manifest exceeds",
  )
  expect(jobs.get(j.id)?.revision).toBe(0)
})

it("cancels oversized legacy streams, keeps preparation consumed and never writes or dispatches them", async () => {
  const j = job()
  j.artifacts = { transcript: { kind: "downloadable" } }
  jobs.set(j.id, j)
  const cancel = vi.fn()
  const write = vi.fn()
  const size = 64 * 1024 * 1024 + 1
  await expect(
    prepareEnrichmentArtifactNamespace(j.id, {
      getJob,
      updateJob,
      writeArtifact: write,
      openArtifactStream: async () => ({
        body: new ReadableStream({ cancel }),
        contentLength: size,
        totalSize: size,
        rangeStart: 0,
        rangeEnd: size - 1,
      }),
    }),
  ).rejects.toThrow("bytes exceed")
  expect(cancel).toHaveBeenCalledOnce()
  expect(write).not.toHaveBeenCalled()
  expect(jobs.get(j.id)?.options.enrichmentArtifacts?.status).toBe("preparing")
  expect(getJobArtifactStorageAssetId(jobs.get(j.id)!)).toBe(j.muxAssetId)
})

it("requires durable monotone revision CAS before copying legacy bytes", async () => {
  const j = job()
  delete j.revision
  jobs.set(j.id, j)
  await expect(prepareEnrichmentArtifactNamespace(j.id)).rejects.toThrow(
    "durable job revision",
  )
  expect(j.options.enrichmentArtifacts).toBeUndefined()
  j.revision = 0
  const read = vi.fn()
  const write = vi.fn()
  await expect(
    prepareEnrichmentArtifactNamespace(j.id, {
      getJob,
      updateJob: async (_id, updates) => ({ ...j, ...updates }),
      openArtifactStream: read,
      writeArtifact: write,
    }),
  ).rejects.toThrow("lost revision ownership")
  expect(read).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
})
