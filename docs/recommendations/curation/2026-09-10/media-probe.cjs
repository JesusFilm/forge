// Read-only metadata extraction and bounded public media-link probes.
// Run from apps/admin with node --env-file=.env and pass an output JSON path.
const fs = require("node:fs/promises")
const path = require("node:path")
const crypto = require("node:crypto")
const { createRequire } = require("node:module")
const { Client } = createRequire(path.join(process.cwd(), "package.json"))("pg")

async function probe(url, kind) {
  const started = Date.now()
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: kind === "image" ? "HEAD" : "GET",
        signal: AbortSignal.timeout(12000),
        headers: { "User-Agent": "ForgeCurationValidation/1.0" },
      })
      const contentType = response.headers.get("content-type") ?? ""
      let validBody = kind === "image" && contentType.startsWith("image/")
      if (kind === "hls" && response.ok) {
        const reader = response.body.getReader()
        let prefix = ""
        try {
          while (prefix.length < 65536) {
            const { done, value } = await reader.read()
            if (done) break
            prefix += Buffer.from(value).toString("utf8")
            if (
              prefix.includes("#EXT-X-STREAM-INF") ||
              prefix.includes("#EXTINF")
            )
              break
          }
        } finally {
          await reader.cancel()
        }
        validBody =
          prefix.trimStart().startsWith("#EXTM3U") &&
          (prefix.includes("#EXT-X-STREAM-INF") || prefix.includes("#EXTINF"))
      } else if (response.body) {
        await response.body.cancel()
      }
      if ((response.status === 429 || response.status >= 500) && attempt === 1)
        continue
      return {
        ok: response.ok && validBody,
        status: response.status,
        contentType,
        validBody,
        attempts: attempt,
        elapsedMs: Date.now() - started,
      }
    } catch (error) {
      if (attempt === 2)
        return {
          ok: false,
          status: null,
          error: error.name,
          attempts: attempt,
          elapsedMs: Date.now() - started,
        }
    }
  }
}

async function main() {
  const output = process.argv[2]
  if (!output) throw new Error("Pass output JSON path")
  const startedAt = new Date().toISOString()
  const sourceText = await fs.readFile(
    path.join(__dirname, "admin-preview-source.json"),
    "utf8",
  )
  const source = JSON.parse(sourceText)
  const coreIds = [
    ...new Set(
      source.candidates.flatMap((item) => [
        item.coreVideoId,
        ...(item.alternateCoreVideoIds ?? []),
      ]),
    ),
  ]
  const dbUrl = new URL(process.env.DATABASE_URL)
  // This one-time probe intentionally targets the isolated preview only.
  if (
    !["localhost", "127.0.0.1"].includes(dbUrl.hostname) ||
    dbUrl.pathname !== "/forge_feat477_20260910"
  )
    throw new Error("Expected isolated preview database")
  for (const key of ["schema", "connection_limit", "pool_timeout", "options"])
    dbUrl.searchParams.delete(key)
  const client = new Client({
    connectionString: dbUrl.toString(),
    connectionTimeoutMillis: 10000,
    options:
      "-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000",
  })
  let rows
  try {
    await client.connect()
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
    const guard = (
      await client.query(
        "SELECT current_setting('transaction_read_only') AS read_only",
      )
    ).rows[0]
    if (guard.read_only !== "on") throw new Error("Read-only guard failed")
    rows = (
      await client.query(
        `
      SELECT v.core_id AS "coreVideoId", v.slug, dub."audioLanguageSlug",
        dub.playback_id AS "playbackId", image.url AS "imageUrl"
      FROM video v
      LEFT JOIN LATERAL (
        SELECT m.playback_id, l.slug AS "audioLanguageSlug"
        FROM video_dub d JOIN language l ON l.id = d.language_id AND l.deleted_at IS NULL
          AND l.slug IS NOT NULL
        JOIN mux_video m ON m.id = d.mux_video_id AND m.deleted_at IS NULL
          AND NULLIF(BTRIM(m.playback_id), '') IS NOT NULL AND LENGTH(m.playback_id) <= 512
        LEFT JOIN video_edition e ON e.id = d.video_edition_id
        WHERE d.video_id = v.id AND d.deleted_at IS NULL AND d.published
          AND (d.video_edition_id IS NULL OR e.deleted_at IS NULL)
        ORDER BY (l.slug = 'english') DESC NULLS LAST, l.slug, d.updated_at DESC, d.id LIMIT 1
      ) dub ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(BTRIM(i.mobile_cinematic_high), ''), NULLIF(BTRIM(i.video_still), ''),
          NULLIF(BTRIM(i.thumbnail), ''), NULLIF(BTRIM(i.url), '')) AS url
        FROM video_image i WHERE i.video_id = v.id AND i.deleted_at IS NULL
          AND COALESCE(NULLIF(BTRIM(i.mobile_cinematic_high), ''), NULLIF(BTRIM(i.video_still), ''),
            NULLIF(BTRIM(i.thumbnail), ''), NULLIF(BTRIM(i.url), '')) ~ '^https://'
        ORDER BY i.created_at, i.id LIMIT 1
      ) image ON true
      WHERE v.core_id = ANY($1::text[]) ORDER BY v.core_id`,
        [coreIds],
      )
    ).rows
    await client.query("ROLLBACK")
  } finally {
    await client.end()
  }
  const resources = new Map()
  for (const row of rows) {
    if (row.playbackId)
      resources.set(
        `https://stream.mux.com/${encodeURIComponent(row.playbackId)}.m3u8`,
        "hls",
      )
    if (row.imageUrl) resources.set(row.imageUrl, "image")
  }
  const results = new Map()
  const queue = [...resources]
  let index = 0
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (index < queue.length) {
        const [url, kind] = queue[index++]
        results.set(url, await probe(url, kind))
        if (results.size % 50 === 0)
          console.log(`Probed ${results.size}/${queue.length} resources`)
      }
    }),
  )
  const videos = rows.map(({ playbackId, imageUrl, ...row }) => ({
    ...row,
    hls: playbackId
      ? results.get(
          `https://stream.mux.com/${encodeURIComponent(playbackId)}.m3u8`,
        )
      : null,
    image: imageUrl ? results.get(imageUrl) : null,
  }))
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    source: "isolated restored local Admin catalog; live public CDN requests",
    sourceSha256: crypto.createHash("sha256").update(sourceText).digest("hex"),
    scope:
      "All editorial Core references including alternate cuts and excluded choices. One available dub per reference, English preferred. HLS manifest GET and image HEAD only; no segment decoding or all-dub playback claim.",
    requestedReferences: coreIds.length,
    resolvedReferences: videos.length,
    uniqueResourcesProbed: resources.size,
    hlsPassed: videos.filter((v) => v.hls?.ok).length,
    hlsFailed: videos.filter((v) => v.hls && !v.hls.ok).length,
    hlsMissing: videos.filter((v) => !v.hls).length,
    imagesPassed: videos.filter((v) => v.image?.ok).length,
    imagesFailed: videos.filter((v) => v.image && !v.image.ok).length,
    imagesMissing: videos.filter((v) => !v.image).length,
    videos,
  }
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify({ ...report, videos: undefined }, null, 2))
}

main().catch((error) => {
  console.error(error.name)
  process.exitCode = 1
})
