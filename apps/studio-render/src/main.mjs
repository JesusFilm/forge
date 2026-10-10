import { STUDIO_RENDER_PROFILE } from "@forge/studio-contracts/render"
import { createPublicKey } from "node:crypto"
import { mkdir, rm, statfs } from "node:fs/promises"
import { createExecutionService } from "./service.mjs"
import { installExecutionLifecycle } from "./lifecycle.mjs"
import { StudioContainmentError } from "./budget.mjs"
import { verifyNativeStartup } from "./startup.mjs"

// These are image paths, never configurable job mounts. The only configured
// authority is the broker's public verification key; no provider/storage/DB key
// belongs in this service. /work must be a separately bounded volatile mount.
if (process.pid !== 1)
  throw new StudioContainmentError("Execution service must be container PID1")
await verifyNativeStartup()
const work = await statfs("/work", { bigint: true })
if (
  work.type !== 0x01021994n ||
  work.blocks <= 0n ||
  work.blocks * work.bsize > 268435456n
)
  throw new StudioContainmentError(
    "Execution staging requires tmpfs at most256MiB",
  )
const publicKey = createPublicKey(
  process.env.STUDIO_RENDER_BROKER_PUBLIC_KEY ?? "",
)
if (publicKey.asymmetricKeyType !== "ed25519")
  throw new StudioContainmentError("Ed25519 broker public key required")
const port = Number(process.env.PORT ?? 3330)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new StudioContainmentError("Invalid execution port")
const root = "/work/studio-render"
await rm(root, { recursive: true, force: true })
await mkdir(root, { mode: 0o700 })
const service = await createExecutionService({
  publicKey,
  root,
  paths: {
    nativeDir: "/opt/studio-render/native",
    node: process.execPath,
    child: "/opt/studio-render/child.mjs",
    verifyChild: "/opt/studio-render/verify.mjs",
    dependencies: "/opt/studio-render/deps",
    renderer: "/deps/@remotion/renderer/dist/index.js",
    bundle: "/opt/studio-render/bundle",
    browser: "/opt/studio-render/browser",
    codec: "/opt/studio-render/codec",
  },
  timeoutMs: STUDIO_RENDER_PROFILE.jobMs,
})
installExecutionLifecycle(service)
service.server.listen(port, "::")
