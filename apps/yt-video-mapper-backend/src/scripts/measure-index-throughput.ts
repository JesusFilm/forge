import type { PrismaClient } from "../generated/prisma/index.js"
import {
  FfmpegVisualFrameExtractor,
  type FfmpegCommandRunner,
} from "../services/ffmpeg-visual-frame-extraction.js"
import {
  InMemoryMediaIndexRepository,
  MediaIndexingService,
  PrismaMediaIndexRepository,
  type InMemoryCatalogVariant,
  type MediaIndexRepository,
} from "../services/media-indexing.js"
import type {
  MediaSignatureDraft,
  OfficialMediaSignatureExtractor,
} from "../services/media-signature-extraction.js"
import {
  OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
  VISUAL_FRAME_FINGERPRINT_KIND,
} from "../services/visual-fingerprint.js"

const BENCHMARK_VARIANTS = 24
const EXTRACT_DELAY_MS = 30
const WRITE_DELAY_MS = 2
const CHECKPOINT_DELAY_MS = 2

class BenchmarkRepository extends InMemoryMediaIndexRepository {
  upsertCalls = 0
  checkpointCalls = 0
  failCheckpointCall: number | null = null

  override async updateIndexRun(
    ...args: Parameters<MediaIndexRepository["updateIndexRun"]>
  ) {
    const [, patch] = args
    if (patch.status == null) {
      this.checkpointCalls += 1
      await delay(CHECKPOINT_DELAY_MS)
      if (this.checkpointCalls === this.failCheckpointCall) {
        throw new Error("synthetic checkpoint failure")
      }
    }
    return await super.updateIndexRun(...args)
  }

  override async upsertMediaSignatures(
    ...args: Parameters<MediaIndexRepository["upsertMediaSignatures"]>
  ): Promise<void> {
    this.upsertCalls += 1
    await delay(WRITE_DELAY_MS)
    await super.upsertMediaSignatures(...args)
  }
}

class DelayedVisualExtractor implements OfficialMediaSignatureExtractor {
  inFlight = 0
  maxInFlight = 0
  readonly taskDurations: number[] = []

  constructor(private readonly failingVariantId: string | null = null) {}

  async extract({
    variant,
    algorithmVersion = OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
  }: Parameters<OfficialMediaSignatureExtractor["extract"]>[0]): Promise<
    MediaSignatureDraft[]
  > {
    const startedAt = performance.now()
    this.inFlight += 1
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)

    try {
      await delay(EXTRACT_DELAY_MS)
      if (variant.videoVariantId === this.failingVariantId) {
        throw new Error("synthetic extractor failure")
      }

      return frameDrafts(
        variant.coreId,
        variant.videoVariantId,
        algorithmVersion,
      )
    } finally {
      this.inFlight -= 1
      this.taskDurations.push(performance.now() - startedAt)
    }
  }
}

async function measureThroughput() {
  const variants = benchmarkVariants(BENCHMARK_VARIANTS)
  const failingVariant = variants[7]!
  const repository = new BenchmarkRepository(variants)
  const extractor = new DelayedVisualExtractor(failingVariant.videoVariantId)
  const service = new MediaIndexingService({
    repository,
    extractor,
    algorithmVersion: OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
    pageSize: variants.length,
  })

  const startedAt = performance.now()
  const result = await service.indexCatalog()
  const elapsedMs = performance.now() - startedAt
  const expectedIndexed = variants.length - 1
  const expectedSignatures = expectedIndexed * 12

  return {
    result,
    elapsedMs,
    variantsPerSecond: variants.length / (elapsedMs / 1_000),
    repository,
    extractor,
    correctnessOk:
      result.status === "completed" &&
      result.variantsAttempted === variants.length &&
      result.variantsIndexed === expectedIndexed &&
      result.variantsFailed === 1 &&
      repository.signatures.size === expectedSignatures,
    failureIsolationOk:
      result.failureSummary?.failedCount === 1 &&
      result.failureSummary.failures?.[0]?.videoVariantId ===
        failingVariant.videoVariantId,
  }
}

async function measureResumeSafety(): Promise<boolean> {
  const variants = benchmarkVariants(8)
  const repository = new BenchmarkRepository(variants)
  const firstExtractor = new DelayedVisualExtractor()
  repository.failCheckpointCall = 2

  const first = await new MediaIndexingService({
    repository,
    extractor: firstExtractor,
    algorithmVersion: OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
    pageSize: variants.length,
  }).indexCatalog()

  repository.failCheckpointCall = null
  const resumedExtractor = new DelayedVisualExtractor()
  const resumed = await new MediaIndexingService({
    repository,
    extractor: resumedExtractor,
    algorithmVersion: OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
    pageSize: variants.length,
  }).indexCatalog({ resumeAfterVariantId: first.cursorVariantId })

  return (
    first.status === "failed" &&
    first.cursorVariantId === variants[3]?.id &&
    first.variantsAttempted === 4 &&
    first.variantsIndexed === 4 &&
    first.variantsFailed === 0 &&
    firstExtractor.taskDurations.length === variants.length &&
    resumed.status === "completed" &&
    resumed.cursorVariantId === variants.at(-1)?.id &&
    resumed.variantsAttempted === 4 &&
    resumed.variantsIndexed === 0 &&
    resumed.variantsFailed === 0 &&
    resumedExtractor.taskDurations.length === 0 &&
    repository.upsertCalls === variants.length &&
    repository.signatures.size === variants.length * 12
  )
}

async function measureFrameContract(): Promise<boolean> {
  const runCommand: FfmpegCommandRunner = async () => ({
    stdout: Buffer.alloc(12 * 8 * 8),
    stderr: "",
  })
  const extractor = new FfmpegVisualFrameExtractor({ runCommand })
  const frames = await extractor.extractFromUrl({
    url: "https://media.example.com/video.mp4",
    durationMilliseconds: 120_000,
  })

  return (
    frames.length === 12 &&
    frames.every(
      (frame, index) =>
        frame.offsetMilliseconds === index * 10_000 &&
        frame.payload.kind === VISUAL_FRAME_FINGERPRINT_KIND &&
        frame.payload.frameWidth === 8 &&
        frame.payload.frameHeight === 8,
    )
  )
}

async function measureRepositoryWrites(): Promise<number> {
  let operations = 0
  const database = {
    mediaSignature: {
      upsert() {
        operations += 1
        return Promise.resolve({})
      },
    },
    $executeRaw() {
      operations += 1
      return Promise.resolve(12)
    },
    async $transaction<T>(queries: Promise<T>[]) {
      return await Promise.all(queries)
    },
  } as unknown as PrismaClient

  await new PrismaMediaIndexRepository(database).upsertMediaSignatures(
    frameDrafts(
      "benchmark-core",
      "benchmark-variant",
      OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
    ).map((signature) => ({
      ...signature,
      sourceMediaUrl: "https://media.example.com/video.mp4",
    })),
  )

  return operations
}

async function main(): Promise<void> {
  const throughput = await measureThroughput()
  const [resumeOk, frameContractOk, repositoryWrites] = await Promise.all([
    measureResumeSafety(),
    measureFrameContract(),
    measureRepositoryWrites(),
  ])
  const sortedDurations = [...throughput.extractor.taskDurations].sort(
    (left, right) => left - right,
  )
  const p95Index = Math.max(0, Math.ceil(sortedDurations.length * 0.95) - 1)

  process.stdout.write(
    `${JSON.stringify({
      variants_per_second: round(throughput.variantsPerSecond),
      correctness_ok: Number(throughput.correctnessOk),
      resume_ok: Number(resumeOk),
      failure_isolation_ok: Number(throughput.failureIsolationOk),
      frame_contract_ok: Number(frameContractOk),
      max_in_flight: throughput.extractor.maxInFlight,
      elapsed_ms: round(throughput.elapsedMs),
      variants_processed: throughput.result.variantsAttempted,
      repository_writes: repositoryWrites,
      checkpoint_writes: throughput.repository.checkpointCalls,
      p95_task_ms: round(sortedDurations[p95Index] ?? 0),
    })}\n`,
  )
}

function benchmarkVariants(count: number): InMemoryCatalogVariant[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(3, "0")
    return {
      id: `variant-${suffix}`,
      coreId: `core-${suffix}`,
      videoVariantId: `video-variant-${suffix}`,
      mediaSourceType: "DOWNLOAD",
      mediaSourceUrl: `https://media.example.com/video-${suffix}.mp4`,
      indexable: true,
      durationSeconds: 120,
      lengthInMilliseconds: null,
      downloadQuality: "1080p",
      downloadWidth: 1920,
      downloadHeight: 1080,
      languageSlug: "english",
      locale: "en",
      editionName: "Feature",
    }
  })
}

function frameDrafts(
  coreId: string,
  videoVariantId: string,
  algorithmVersion: string,
): MediaSignatureDraft[] {
  return Array.from({ length: 12 }, (_, index) => ({
    coreId,
    videoVariantId,
    signatureType: "VISUAL_FRAME" as const,
    algorithmVersion,
    offsetMilliseconds: index * 10_000,
    durationMilliseconds: null,
    signature: {
      kind: VISUAL_FRAME_FINGERPRINT_KIND,
      phash: index.toString(16).padStart(16, "0"),
      frameWidth: 8,
      frameHeight: 8,
    },
    sourceMediaHash: null,
  }))
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

await main()
