// Local qualification only: canonical services, no browser session or cookie endpoint.
import { readFile, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
async function main() {
  const output = process.argv[2]
  Object.assign(
    process.env,
    JSON.parse(await readFile(join(output, "environment.json"), "utf8")),
  )
  if (
    process.env.DATABASE_URL !==
    "postgresql://tataihono@127.0.0.1:55460/forge_studio_548_qualification"
  )
    throw new Error("Guarded task database required")
  const { prisma: db } = await import("../src/db/client")
  const operator = JSON.parse(
    await readFile(join(output, "fixtures.json"), "utf8"),
  )
  await db.user.create({
    data: {
      id: operator.userId,
      email: `${operator.userId}@example.test`,
      name: "Qualification fixture operator",
      role: "EDITOR",
      managerMembership: { create: { role: "OPERATOR" } },
    },
  })
  const human = {
    id: operator.userId,
    role: "EDITOR" as const,
    managerRole: "OPERATOR" as const,
    studioAuthority: "interactive" as const,
  }
  const language = await db.language.upsert({
    where: { slug: "en" },
    update: {},
    create: {
      coreId: randomUUID(),
      slug: "en",
      bcp47: "en",
      name: { en: "English" },
    },
  })
  const videoId = randomUUID(),
    editionId = randomUUID(),
    dubId = randomUUID(),
    trackId = randomUUID(),
    downloadId = randomUUID()
  await db.video.create({
    data: {
      id: videoId,
      coreId: videoId,
      slug: `qualification-${videoId}`,
      locales: {
        create: {
          status: "PUBLISHED",
          title: "Hope and kindness: deterministic qualification footage",
        },
      },
    },
  })
  await db.videoEdition.create({
    data: {
      id: editionId,
      coreId: editionId,
      name: "Qualification synthetic edition",
    },
  })
  await db.videoDub.create({
    data: {
      id: dubId,
      coreId: dubId,
      videoId,
      videoEditionId: editionId,
      languageId: language.id,
      published: true,
      downloadable: true,
      lengthInMilliseconds: 15000,
      hls: `https://stream.mux.com/${operator.fixtureId}.m3u8`,
      downloads: {
        create: { id: downloadId, url: operator.sourceUrl, height: 1920 },
      },
    },
  })
  await db.videoSubtitle.create({
    data: {
      id: trackId,
      videoId,
      videoEditionId: editionId,
      languageId: language.id,
      vttSrc: operator.subtitleUrl,
    },
  })
  const { StudioAssetService } =
    await import("../src/services/studio-authoring/assets")
  const assets = new StudioAssetService(db)
  const preset = {
    language: "en",
    provider: "elevenlabs",
    model: "eleven_multilingual_v2",
    voiceId: operator.voiceId,
    settings: {},
    pronunciation: null,
  }
  const voice = await assets.register(
    human,
    {
      idempotencyKey: randomUUID(),
      filename: "qualification-existing-voice.json",
      mimeType: "application/json",
      role: "voice",
      provenance: {
        status: "recorded",
        recorded: { registrationStatus: "existing", fixture: true },
      },
      voice: preset,
    },
    Buffer.from(JSON.stringify(preset)),
    "LOCAL",
  )
  const music = await assets.register(
    human,
    {
      idempotencyKey: randomUUID(),
      filename: "qualification-existing-music.mp3",
      mimeType: "audio/mpeg",
      role: "music",
      provenance: { status: "recorded", recorded: { fixture: true } },
    },
    await readFile(join(output, "music.mp3")),
    "LOCAL",
  )
  await writeFile(
    join(output, "seed-result.json"),
    JSON.stringify(
      {
        ...operator,
        videoId,
        editionId,
        dubId,
        trackId,
        downloadId,
        voice: voice.reference,
        music: music.reference,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
  const delegated = await import("../src/app/api/shorts/delegated/route")
  const interactive = await import("../src/app/api/shorts/interactive/route")
  const session = await import("../src/app/api/manager/session/route")
  const graphql = await import("../src/app/api/graphql/route")
  const transfer =
    await import("../src/app/api/shorts/assets/transfer/[token]/route")
  const { serve } = await import("../../../scripts/studio-agent-local/http.mjs")
  serve(
    55482,
    {
      "POST /api/shorts/delegated": delegated.POST,
      "POST /api/shorts/interactive": interactive.POST,
      "POST /api/manager/session": session.POST,
      "POST /api/graphql": graphql.POST,
    },
    undefined,
    (method: string, path: string) => {
      const token = /^\/api\/shorts\/assets\/transfer\/([a-f0-9]{64})$/.exec(
        path,
      )?.[1]
      if (!token || !["GET", "PUT"].includes(method)) return null
      return (request: Request) =>
        (method === "GET" ? transfer.GET : transfer.PUT)(request, {
          params: Promise.resolve({ token }),
        })
    },
  )
}
void main()
