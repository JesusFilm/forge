#!/usr/bin/env node

// Opt-in, synthetic PostgreSQL 18 benchmark. Only creates and removes its own
// uniquely named schema; it never reads or copies production request payloads.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { performance } from "node:perf_hooks"
import pg from "pg"
import configModule from "../src/config/env.ts"

const { env } = configModule

if (env.RECOMMENDATION_STORAGE_BENCHMARK !== "1") {
  throw new Error(
    "Set RECOMMENDATION_STORAGE_BENCHMARK=1 for an isolated database",
  )
}
if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required")
const databaseUrl = new URL(env.DATABASE_URL)
if (!["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname)) {
  throw new Error("Benchmark DATABASE_URL must use a local PostgreSQL host")
}
if (!env.RECOMMENDATION_STORAGE_BENCHMARK_DATABASE) {
  throw new Error(
    "Set RECOMMENDATION_STORAGE_BENCHMARK_DATABASE to the disposable database name",
  )
}
const runsPerCohort = Number(env.RECOMMENDATION_STORAGE_BENCHMARK_RUNS ?? 100)
if (
  !Number.isInteger(runsPerCohort) ||
  runsPerCohort < 4 ||
  runsPerCohort % 4 !== 0
) {
  throw new Error(
    "RECOMMENDATION_STORAGE_BENCHMARK_RUNS must be a multiple of four",
  )
}

const client = new pg.Client({ connectionString: env.DATABASE_URL })
const schema = `recommendation_storage_bench_${process.pid}_${Date.now()}`
const stages = [
  "nominated",
  "canonicalized",
  "deduplicated",
  "rejected",
  "scored",
  "ordered",
  "composed",
]
const cohorts = [82, 113, 195, 323]
const expiresAt = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000)
const allIds = { legacy: [], compact: [] }
const latencyMs = { legacy: [], compact: [] }
const latencyByCohortMs = Object.fromEntries(
  cohorts.map((cohort) => [cohort, { legacy: [], compact: [] }]),
)

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.ceil(ordered.length * fraction) - 1] ?? 0
}

function distribution(values) {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  }
}

function stageRows(runId, count) {
  const composed = Math.min(6, Math.ceil(count / 20))
  const perStage = Array(6).fill(Math.floor((count - composed) / 6))
  for (let i = 0; i < (count - composed) % 6; i++) perStage[i]++
  perStage.push(composed)
  assert.equal(
    perStage.reduce((sum, value) => sum + value, 0),
    count,
  )
  const rows = []
  const createdAt = new Date().toISOString()
  for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
    for (let ordinal = 0; ordinal < perStage[stageIndex]; ordinal++) {
      const sourceCount = [1, 3, 16][ordinal % 3]
      const sourceEvidence = Array.from(
        { length: sourceCount },
        (_, index) => ({
          generator: index % 2 ? "multi-interest-profile" : "semantic",
          generatorVersion:
            index % 2
              ? "multi-interest-profile-candidate-v1"
              : "semantic-transcript-candidate-v1",
          rank: ((ordinal + index) % 64) + 1,
          score: Number((0.5 + ((ordinal + index) % 37) / 100).toFixed(4)),
          evidence: {
            transcriptChunkId: `${runId}-chunk-${ordinal}-${index}`,
            similarity: Number((0.5 + (ordinal % 31) / 100).toFixed(4)),
            provenance: `source-${index}-${"abcdefghij".repeat(5)}`,
          },
          rejectionReason: null,
        }),
      )
      const score = Number((0.5 + (ordinal % 37) / 100).toFixed(4))
      rows.push({
        id: `${runId}-stage-${stageIndex}-${ordinal}`,
        stage: stages[stageIndex],
        ordinal,
        candidateKey: `candidate-${ordinal}`,
        targetMediaId: `video-${ordinal}`,
        sourceGenerator: "semantic",
        sourceRank: ordinal + 1,
        sourceScore: score,
        normalizedScore: score,
        rrfScore: Number((1 / (60 + ordinal + 1)).toFixed(6)),
        deterministicScore: score,
        finalPosition: stageIndex === 6 ? ordinal : null,
        reasonCodes:
          ordinal % 4 === 0
            ? ["playable_localized_deduplicated", "source_rank_considered"]
            : ["playable_localized_deduplicated"],
        sourceEvidence,
        createdAt,
      })
    }
  }
  return rows
}

async function writeRun(variant, cohort, sequence, measure = true) {
  const runId = `${variant}-${cohort}-${sequence}`
  const requestId = `${runId}-request`
  const rows = stageRows(runId, cohort)
  const started = performance.now()
  await client.query("BEGIN")
  try {
    await client.query(
      `INSERT INTO "${schema}"."${variant}_request" (id) VALUES ($1)`,
      [requestId],
    )
    await client.query(
      `INSERT INTO "${schema}"."${variant}_run" (
        id, request_id, purpose, context_version, generator_version,
        union_version, eligibility_version, ranker_version, composer_version,
        candidate_eligibility_parity, ranker_parity, nominated_count,
        canonicalized_count, deduplicated_count, rejected_count, scored_count,
        ordered_count, composed_count, evidence_complete, expires_at,
        trace_format_version, trace_payload
      ) VALUES (
        $1, $2, 'watch', 'recommendation-context-v1',
        'semantic-transcript-candidate-v1', 'canonical-video-union-v1',
        'watch-playable-locale-v1', 'semantic-deterministic-ranker-v1',
        'minimal-playable-slate-v1', 'passed', 'passed', 0, 0, 0, 0,
        0, 0, 0, true, $3, $4, $5::jsonb
      )`,
      [
        runId,
        requestId,
        expiresAt,
        variant === "compact" ? 1 : null,
        variant === "compact" ? JSON.stringify({ stages: rows }) : null,
      ],
    )
    if (variant === "legacy") {
      await client.query(
        `INSERT INTO "${schema}"."legacy_stage" (
          id, run_id, stage, ordinal, candidate_key, target_media_id,
          source_generator, source_rank, source_score, normalized_score,
          rrf_score, deterministic_score, final_position, reason_codes,
          source_evidence, created_at, expires_at
        ) SELECT
          row.id, $1, row.stage, row.ordinal, row."candidateKey",
          row."targetMediaId", row."sourceGenerator", row."sourceRank",
          row."sourceScore", row."normalizedScore", row."rrfScore",
          row."deterministicScore", row."finalPosition", row."reasonCodes",
          row."sourceEvidence", row."createdAt", $2
        FROM jsonb_to_recordset($3::jsonb) AS row (
          id text, stage text, ordinal integer, "candidateKey" text,
          "targetMediaId" text, "sourceGenerator" text, "sourceRank" integer,
          "sourceScore" double precision, "normalizedScore" double precision,
          "rrfScore" double precision, "deterministicScore" double precision,
          "finalPosition" integer, "reasonCodes" text[],
          "sourceEvidence" jsonb, "createdAt" timestamptz
        )`,
        [runId, expiresAt, JSON.stringify(rows)],
      )
    }
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
  allIds[variant].push(requestId)
  if (measure) {
    const elapsed = performance.now() - started
    latencyMs[variant].push(elapsed)
    latencyByCohortMs[cohort][variant].push(elapsed)
  }
  return { runId, rows }
}

async function relationBytes() {
  const rows = await client.query(
    `SELECT c.relname,
      pg_total_relation_size(c.oid)::bigint AS total_bytes,
      pg_table_size(c.oid)::bigint AS table_and_toast_bytes,
      pg_indexes_size(c.oid)::bigint AS index_bytes
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind = 'r'
       AND c.relname IN ('legacy_request', 'legacy_run', 'legacy_stage',
                         'compact_request', 'compact_run')
     ORDER BY c.relname`,
    [schema],
  )
  return Object.fromEntries(
    rows.rows.map((row) => [
      row.relname,
      {
        totalBytes: Number(row.total_bytes),
        tableAndToastBytes: Number(row.table_and_toast_bytes),
        indexBytes: Number(row.index_bytes),
      },
    ]),
  )
}

async function rowCounts() {
  const result = await client.query(
    `SELECT
      (SELECT count(*)::int FROM "${schema}"."legacy_request") AS legacy_requests,
      (SELECT count(*)::int FROM "${schema}"."legacy_run") AS legacy_runs,
      (SELECT count(*)::int FROM "${schema}"."legacy_stage") AS legacy_stages,
      (SELECT count(*)::int FROM "${schema}"."compact_request") AS compact_requests,
      (SELECT count(*)::int FROM "${schema}"."compact_run") AS compact_runs`,
  )
  return result.rows[0]
}

async function vacuum() {
  for (const name of [
    "legacy_request",
    "legacy_run",
    "legacy_stage",
    "compact_request",
    "compact_run",
  ]) {
    await client.query(`VACUUM (ANALYZE) "${schema}"."${name}"`)
  }
}

function detailQuery(variant) {
  const source =
    variant === "legacy"
      ? `"${schema}"."legacy_stage" stage`
      : `(SELECT trace_run.id AS run_id, trace_run.expires_at,
        encoded.id, encoded.stage, encoded.ordinal,
        encoded."candidateKey" AS candidate_key,
        encoded."targetMediaId" AS target_media_id,
        encoded."sourceGenerator" AS source_generator,
        encoded."sourceRank" AS source_rank,
        encoded."sourceScore" AS source_score,
        encoded."normalizedScore" AS normalized_score,
        encoded."rrfScore" AS rrf_score,
        encoded."deterministicScore" AS deterministic_score,
        encoded."finalPosition" AS final_position,
        ARRAY(SELECT jsonb_array_elements_text(encoded."reasonCodes")) AS reason_codes,
        encoded."sourceEvidence" AS source_evidence
      FROM "${schema}"."compact_run" trace_run,
        LATERAL jsonb_to_recordset(trace_run.trace_payload -> 'stages')
        AS encoded(id text, stage text, ordinal integer,
          "candidateKey" text, "targetMediaId" text,
          "sourceGenerator" text, "sourceRank" integer,
          "sourceScore" double precision, "normalizedScore" double precision,
          "rrfScore" double precision, "deterministicScore" double precision,
          "finalPosition" integer, "reasonCodes" jsonb, "sourceEvidence" jsonb)
      WHERE trace_run.id = $1 AND trace_run.trace_format_version = 1
        AND trace_run.expires_at > $2) stage`
  // Mirrors Admin's bounded candidate-stage projection, including source
  // summaries/contributors and canonical seven-stage ordering.
  return `SELECT stage.stage, stage.ordinal,
      left(stage.candidate_key, 191) AS "candidateKey",
      left(stage.target_media_id, 191) AS "targetMediaId",
      left(stage.source_generator, 64) AS "sourceGenerator",
      stage.source_rank AS "sourceRank", stage.source_score AS "sourceScore",
      jsonb_array_length(stage.source_evidence) AS "sourceCount",
      ARRAY(SELECT left(CASE
          WHEN jsonb_typeof(source.value -> 'generator') = 'string'
          THEN source.value ->> 'generator' ELSE 'unknown' END, 64)
          || ' · rank ' || left(COALESCE(source.value ->> 'rank', 'n/a'), 16)
          || ' · score ' || left(COALESCE(source.value ->> 'score', 'n/a'), 32)
        FROM jsonb_array_elements(stage.source_evidence)
          WITH ORDINALITY source(value, position)
        ORDER BY source.position LIMIT 16) AS "sourceSummaries",
      COALESCE((SELECT jsonb_agg(contributor.value ORDER BY contributor.position)
        FROM (SELECT source.position,
          jsonb_build_object('generator', left(source.value ->> 'generator', 64),
            'generatorVersion', left(source.value ->> 'generatorVersion', 64),
            'rank', (source.value ->> 'rank')::integer) AS value
          FROM jsonb_array_elements(stage.source_evidence)
            WITH ORDINALITY source(value, position)
          WHERE jsonb_typeof(source.value -> 'generator') = 'string'
            AND length(source.value ->> 'generator') BETWEEN 1 AND 64
            AND jsonb_typeof(source.value -> 'generatorVersion') = 'string'
            AND length(source.value ->> 'generatorVersion') BETWEEN 1 AND 64
            AND (source.value ->> 'rank') ~ '^[0-9]{1,2}$'
            AND (source.value ->> 'rank')::integer BETWEEN 1 AND 64
          ORDER BY source.position LIMIT 16) contributor), '[]'::jsonb)
        AS contributors,
      stage.normalized_score AS "normalizedScore",
      stage.rrf_score AS "rrfScore",
      stage.deterministic_score AS "deterministicScore",
      stage.final_position AS "finalPosition",
      ARRAY(SELECT left(reason, 64) FROM unnest(stage.reason_codes) reason
        LIMIT 16) AS "reasonCodes"
    FROM ${source}
    WHERE stage.run_id = $1 AND stage.expires_at > $2
    ORDER BY array_position(ARRAY['nominated', 'canonicalized',
      'deduplicated', 'rejected', 'scored', 'ordered', 'composed']::text[],
      stage.stage), stage.ordinal ASC, stage.id ASC
    LIMIT 448`
}

async function explain(variant, runId) {
  const result = await client.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${detailQuery(variant)}`,
    [runId, new Date()],
  )
  return result.rows[0]["QUERY PLAN"][0]
}

await client.connect()
try {
  const database = await client.query("SELECT current_database() AS name")
  assert.equal(
    database.rows[0].name,
    env.RECOMMENDATION_STORAGE_BENCHMARK_DATABASE,
  )
  const server = await client.query("SHOW server_version")
  assert.match(server.rows[0].server_version, /^18\./)
  const migration = await client.query(
    `SELECT count(*)::int AS count FROM _prisma_migrations
     WHERE migration_name IN (
       '0100_recommendation_candidate_compact_trace',
       '0101_recommendation_candidate_compact_trace_validate',
       '0102_recommendation_candidate_stage_duplicate_index_drop'
     ) AND finished_at IS NOT NULL`,
  )
  assert.equal(
    migration.rows[0].count,
    3,
    "Apply all three migrations to this isolated database first",
  )
  await client.query(`CREATE SCHEMA "${schema}"`)
  for (const variant of ["legacy", "compact"]) {
    await client.query(
      `CREATE TABLE "${schema}"."${variant}_request" (id text PRIMARY KEY)`,
    )
    await client.query(
      `CREATE TABLE "${schema}"."${variant}_run"
       (LIKE public.recommendation_candidate_run INCLUDING ALL)`,
    )
    await client.query(
      `ALTER TABLE "${schema}"."${variant}_run"
       ADD FOREIGN KEY (request_id) REFERENCES "${schema}"."${variant}_request"(id)
       ON DELETE CASCADE`,
    )
  }
  await client.query(
    `CREATE TABLE "${schema}"."legacy_stage"
     (LIKE public.recommendation_candidate_stage_evidence INCLUDING ALL)`,
  )
  await client.query(
    `ALTER TABLE "${schema}"."legacy_stage"
     ADD FOREIGN KEY (run_id) REFERENCES "${schema}"."legacy_run"(id)
     ON DELETE CASCADE`,
  )
  const firstByCohort = {}
  const cumulativeBytesByCohort = []
  for (const cohort of cohorts) {
    firstByCohort[cohort] = {}
    const half = runsPerCohort / 2
    for (const [pass, variant] of [
      "legacy",
      "compact",
      "compact",
      "legacy",
    ].entries()) {
      for (let i = 0; i < half; i++) {
        const result = await writeRun(variant, cohort, pass * half + i)
        firstByCohort[cohort][variant] ??= result
      }
    }
    cumulativeBytesByCohort.push({ cohort, bytes: await relationBytes() })
  }
  await vacuum()
  const full = await relationBytes()
  const fullCounts = await rowCounts()
  const expectedRuns = runsPerCohort * cohorts.length
  const expectedStages =
    runsPerCohort * cohorts.reduce((sum, count) => sum + count, 0)
  assert.deepEqual(fullCounts, {
    legacy_requests: expectedRuns,
    legacy_runs: expectedRuns,
    legacy_stages: expectedStages,
    compact_requests: expectedRuns,
    compact_runs: expectedRuns,
  })
  const plansByCohort = {}
  const detailParityByCohort = {}
  for (const cohort of cohorts) {
    const first = firstByCohort[cohort]
    const [legacy, compact] = await Promise.all([
      client.query(detailQuery("legacy"), [first.legacy.runId, new Date()]),
      client.query(detailQuery("compact"), [first.compact.runId, new Date()]),
    ])
    assert.equal(legacy.rows.length, cohort)
    assert.deepEqual(compact.rows, legacy.rows)
    detailParityByCohort[cohort] = { projectedStages: cohort, equal: true }
    plansByCohort[cohort] = {
      legacy: await explain("legacy", first.legacy.runId),
      compact: await explain("compact", first.compact.runId),
    }
  }
  const first = firstByCohort[cohorts[0]]
  const legacyRows = await client.query(
    `SELECT id, stage, ordinal, candidate_key AS "candidateKey",
       target_media_id AS "targetMediaId", source_generator AS "sourceGenerator",
       source_rank AS "sourceRank", source_score AS "sourceScore",
       normalized_score AS "normalizedScore", rrf_score AS "rrfScore",
       deterministic_score AS "deterministicScore", final_position AS "finalPosition",
       reason_codes AS "reasonCodes", source_evidence AS "sourceEvidence",
       created_at AS "createdAt"
     FROM "${schema}"."legacy_stage"
     WHERE run_id = $1 ORDER BY array_position($2::text[], stage), ordinal`,
    [first.legacy.runId, stages],
  )
  assert.deepEqual(
    legacyRows.rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    first.legacy.rows,
  )
  const compactPayload = await client.query(
    `SELECT trace_payload FROM "${schema}"."compact_run" WHERE id = $1`,
    [first.compact.runId],
  )
  assert.deepEqual(compactPayload.rows[0].trace_payload, {
    stages: first.compact.rows,
  })

  const cascade = {}
  for (const variant of ["legacy", "compact"]) {
    const started = performance.now()
    const deleted = await client.query(
      `DELETE FROM "${schema}"."${variant}_request" WHERE id = ANY($1::text[])`,
      [allIds[variant].filter((_id, index) => index % 2 === 0)],
    )
    cascade[variant] = {
      deletedRoots: deleted.rowCount,
      elapsedMs: performance.now() - started,
    }
  }
  await vacuum()
  const afterDelete = await relationBytes()
  const afterDeleteCounts = await rowCounts()
  assert.equal(afterDeleteCounts.legacy_runs, expectedRuns / 2)
  assert.equal(afterDeleteCounts.compact_runs, expectedRuns / 2)
  assert.equal(afterDeleteCounts.legacy_stages, expectedStages / 2)
  for (const cohort of cohorts) {
    for (const variant of ["legacy", "compact"]) {
      for (let i = 0; i < runsPerCohort / 2; i++) {
        await writeRun(variant, cohort, 1_000_000 + i, false)
      }
    }
  }
  await vacuum()
  const afterReuse = await relationBytes()
  const afterReuseCounts = await rowCounts()
  assert.deepEqual(afterReuseCounts, fullCounts)
  const result = {
    capturedAt: new Date().toISOString(),
    serverVersion: server.rows[0].server_version,
    syntheticFixture: {
      cohorts,
      runsPerCohortPerVariant: runsPerCohort,
      sourceEvidenceObjects: [1, 3, 16],
      schedule: "ABBA",
      duplicateIndexAlreadyRemoved: true,
    },
    writeLatencyMs: {
      legacy: distribution(latencyMs.legacy),
      compact: distribution(latencyMs.compact),
    },
    writeLatencyByCohortMs: Object.fromEntries(
      cohorts.map((cohort) => [
        cohort,
        {
          legacy: distribution(latencyByCohortMs[cohort].legacy),
          compact: distribution(latencyByCohortMs[cohort].compact),
        },
      ]),
    ),
    cumulativeBytesByCohort,
    full,
    fullCounts,
    cascade,
    afterDelete,
    afterDeleteCounts,
    afterReuse,
    afterReuseCounts,
    detailParityByCohort,
    plansByCohort,
  }
  if (env.RECOMMENDATION_STORAGE_BENCHMARK_OUTPUT) {
    await writeFile(
      env.RECOMMENDATION_STORAGE_BENCHMARK_OUTPUT,
      `${JSON.stringify(result, null, 2)}\n`,
    )
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await client.end()
}
