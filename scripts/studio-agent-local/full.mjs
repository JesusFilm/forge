/** Full local protocol qualification. No browser session route and no external provider requests. */
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto"
import { mkdir, writeFile, realpath, chmod, readdir } from "node:fs/promises"
import { spawn, execFileSync } from "node:child_process"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { serve } from "./http.mjs"
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const output = process.argv[2]
if (
  !output?.startsWith("/") ||
  resolve(output) === root ||
  resolve(output).startsWith(root + "/")
)
  throw new Error("Private output outside checkout required")
const realRoot = await realpath(root)
const realParent = await realpath(dirname(output))
if (realParent === realRoot || realParent.startsWith(realRoot + "/"))
  throw new Error("Output parent cannot resolve inside checkout")
// Fresh directories reject pre-existing symlinks/files and preserve private file modes.
await mkdir(output, { mode: 0o700 })
const realOutput = await realpath(output)
if (realOutput === realRoot || realOutput.startsWith(realRoot + "/"))
  throw new Error("Output cannot resolve inside checkout")
await chmod(output, 0o700)
const database = process.env.STUDIO_TEST_DATABASE_URL
if (
  database !==
  "postgresql://tataihono@127.0.0.1:55460/forge_studio_548_qualification"
)
  throw new Error("Task-owned guarded database required")
const codec = process.env.STUDIO_QUALIFICATION_CODEC
const browser = process.env.STUDIO_QUALIFICATION_BROWSER
if (!codec?.startsWith("/") || !browser?.startsWith("/"))
  throw new Error("Explicit cached codec and browser directories required")
const fixtureId = randomUUID(),
  userId = `qualification-${fixtureId}`,
  voiceId = `fixture-${fixtureId}`
const sourceUrl = `https://api-media-core.jesusfilm.org/qualification/${fixtureId}.mp4`,
  subtitleUrl = sourceUrl.replace(".mp4", ".vtt")
const ffmpeg = (args) =>
  execFileSync(
    join(codec, "ffmpeg"),
    ["-y", "-v", "error", "-nostdin", "-threads", "1", ...args],
    { timeout: 60000 },
  )
ffmpeg([
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=1080x1920:rate=30:duration=15",
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-threads",
  "1",
  "-pix_fmt",
  "yuv420p",
  join(output, "source.mp4"),
])
// Canonical render preparation resolves both preview and exact export HLS renditions.
for (const [name, scale] of [
  ["low", "152:270"],
  ["high", "1080:1920"],
]) {
  ffmpeg([
    "-i",
    join(output, "source.mp4"),
    "-vf",
    `scale=${scale}`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-threads",
    "1",
    "-g",
    "60",
    "-an",
    "-hls_time",
    "2",
    "-hls_list_size",
    "0",
    "-hls_segment_filename",
    join(output, `${name}-%03d.ts`),
    join(output, `${name}.m3u8`),
  ])
}
await writeFile(
  join(output, "master.m3u8"),
  "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=152x270\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1080x1920\nhigh.m3u8\n",
)
for (const [name, frequency, seconds] of [
  ["narration", 440, 3],
  ["music", 220, 15],
])
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${frequency}:duration=${seconds}`,
    "-c:a",
    "libmp3lame",
    join(output, `${name}.mp3`),
  ])
await writeFile(
  join(output, "source.vtt"),
  "WEBVTT\n\n00:00.000 --> 00:07.000\nA little kindness can bring hope.\n\n00:07.000 --> 00:15.000\nShare a moment of hope today.\n",
)
await writeFile(
  join(output, "fixtures.json"),
  JSON.stringify({ fixtureId, userId, voiceId, sourceUrl, subtitleUrl }),
  { mode: 0o600 },
)
const manifest = {
  audit: join(output, "fixture-dispatch.jsonl"),
  responses: [
    {
      name: "canonical-video",
      method: "GET",
      url: sourceUrl,
      file: join(output, "source.mp4"),
      headers: { "content-type": "video/mp4" },
    },
    {
      name: "canonical-subtitles",
      method: "GET",
      url: subtitleUrl,
      file: join(output, "source.vtt"),
      headers: { "content-type": "text/vtt" },
    },
    {
      name: "fake-narration",
      method: "POST",
      url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      file: join(output, "narration.mp3"),
      headers: {
        "content-type": "audio/mpeg",
        "request-id": `fixture-${fixtureId}`,
        "character-cost": "0",
      },
    },
  ],
}
manifest.responses.push({
  name: "canonical-hls-master",
  method: "GET",
  url: `https://stream.mux.com/${fixtureId}.m3u8`,
  file: join(output, "master.m3u8"),
  headers: { "content-type": "application/vnd.apple.mpegurl" },
})
for (const file of await readdir(output)) {
  if (/^(low|high)(\.m3u8|-\d+\.ts)$/.test(file))
    manifest.responses.push({
      name: `canonical-hls-${file}`,
      method: "GET",
      url: `https://stream.mux.com/${file}`,
      file: join(output, file),
      headers: {
        "content-type": file.endsWith(".ts")
          ? "video/mp2t"
          : "application/vnd.apple.mpegurl",
      },
    })
}
const manifestPath = join(output, "manifest.json")
await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 })
const service = generateKeyPairSync("ed25519"),
  renderer = generateKeyPairSync("ed25519"),
  issuer = generateKeyPairSync("rsa", { modulusLength: 2048 })
const publicPem = (pair) =>
  pair.publicKey.export({ type: "spki", format: "pem" })
const privatePem = (pair) =>
  pair.privateKey.export({ type: "pkcs8", format: "pem" })
const issuerOrigin = "http://127.0.0.1:55480",
  managerOrigin = "http://127.0.0.1:55483"
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url")
const encoded = `${encode({ alg: "RS256", kid: "qualification-548" })}.${encode({ iss: issuerOrigin, aud: managerOrigin + "/mcp", sub: userId, client_id: "codex-local-qualification", scope: "shorts:read shorts:edit shorts:render shorts:narration shorts:instructions:read", "https://jesusfilm.org/claims/app": "shorts-mcp", "https://jesusfilm.org/claims/environment": "local", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 14400 })}`
await writeFile(
  join(output, "token"),
  `${encoded}.${sign("RSA-SHA256", Buffer.from(encoded), issuer.privateKey).toString("base64url")}`,
  { mode: 0o600 },
)
const bearer = randomBytes(32).toString("hex")
const config = {
  CI: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_ENV: "test",
  DATABASE_URL: database,
  ADMIN_SESSION_SECRET: randomBytes(32).toString("hex"),
  MANAGER_SESSION_SECRET: randomBytes(32).toString("hex"),
  MANAGER_ADMIN_API_KEY: bearer,
  ADMIN_MANAGER_API_KEY: bearer,
  AUTH_ISSUER_URL: issuerOrigin,
  AUTH_MANAGER_CLIENT_ID: "local-manager",
  MANAGER_BASE_URL: managerOrigin,
  ADMIN_GRAPHQL_URL: "http://127.0.0.1:55482/api/graphql",
  MANAGER_DATA_MODE: "admin",
  MANAGER_BACKEND_MODE: "admin",
  STUDIO_ENVIRONMENT: "local",
  STUDIO_MCP_AUDIENCE: managerOrigin + "/mcp",
  STUDIO_MCP_CLIENT_IDS: "codex-local-qualification",
  STUDIO_INTERACTIVE_KEY_ID: "qualification-548-service",
  STUDIO_INTERACTIVE_PRIVATE_KEY: privatePem(service),
  STUDIO_INTERACTIVE_PUBLIC_KEYS: JSON.stringify({
    "qualification-548-service": publicPem(service),
  }),
  STUDIO_RENDER_SERVICE_URL: "http://127.0.0.1:55484",
  STUDIO_RENDER_PRIVATE_KEY: privatePem(renderer),
  STUDIO_PREVIEW_API_KEY: randomBytes(32).toString("hex"),
  STUDIO_FFMPEG_PATH: join(codec, "ffmpeg"),
  STUDIO_FFPROBE_PATH: join(codec, "ffprobe"),
  ELEVENLABS_API_KEY: "qualification-fake-provider-only",
  STUDIO_PRODUCTION_ENABLED: "true",
  STUDIO_PUBLICATION_ENABLED: "false",
  STUDIO_AGENT_ENABLED: "false",
  STUDIO_RENDER_POOL_ENABLED: "false",
  STUDIO_MUX_INGEST_ENABLED: "false",
  STUDIO_QUALIFICATION_MANIFEST: manifestPath,
  NODE_OPTIONS: `--import=${join(root, "scripts/studio-agent-local/guard.mjs")}`,
}
await writeFile(join(output, "environment.json"), JSON.stringify(config), {
  mode: 0o600,
})
await writeFile(
  join(output, "renderer.json"),
  JSON.stringify({ publicKey: publicPem(renderer), codec, browser }),
  { mode: 0o600 },
)
const server = serve(55480, {
  "GET /api/auth/jwks": () =>
    Response.json({
      keys: [
        {
          ...issuer.publicKey.export({ format: "jwk" }),
          kid: "qualification-548",
          alg: "RS256",
          use: "sig",
        },
      ],
    }),
})
const children = []
function launch(command, args, cwd, env) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
    detached: true,
  })
  children.push(child)
  return child
}
const baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME, CI: "1" }
launch(
  "pnpm",
  [
    "exec",
    "tsx",
    "--tsconfig",
    "tsconfig.json",
    "scripts/studio-agent-full-local.ts",
    output,
  ],
  join(root, "apps/admin"),
  { ...baseEnv, ...config },
)
launch(
  "pnpm",
  ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", "55483"],
  join(root, "apps/manager"),
  { ...baseEnv, ...config, NODE_ENV: "development" },
)
// The renderer gets paths and public verification key only, never config/provider/DB credentials.
launch(
  "systemd-run",
  [
    "--user",
    "--scope",
    "-p",
    "MemoryMax=2G",
    "-p",
    "MemorySwapMax=0",
    "-p",
    "CPUQuota=200%",
    "-p",
    "TasksMax=128",
    "node",
    "--import",
    "tsx",
    "scripts/studio-agent-local/full-renderer.mjs",
    output,
  ],
  root,
  {
    ...baseEnv,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
  },
)
function stop() {
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch {}
  }
  server.close()
  process.exit(0)
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
console.log(
  `Local full-flow harness: ${managerOrigin}/mcp; private evidence: ${output}. Synthetic issuer/provider/source; no browser session.`,
)
