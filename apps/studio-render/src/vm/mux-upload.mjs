import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { VmInvariantError, VmUnconfirmedError } from "./errors.mjs"
export class MuxUploadUnresolvedError extends VmInvariantError {}
const monotonic = () => Number(process.hrtime.bigint() / 1000000n)

/** Runs only in the trusted host after verification and canonical settlement.
 * The authored container has already retired and never receives this URL. */
export async function uploadVmOutput({
  journal,
  api,
  claim,
  path,
  signal,
  fetcher = fetch,
}) {
  const prior = await journal.read("mux-outcome.json")
  if (prior !== null) {
    if (
      !prior ||
      !["uploaded", "processing", "disabled", "skipped"].includes(
        prior.state,
      ) ||
      Object.keys(prior).length !== 1
    )
      throw new VmInvariantError("Malformed Mux outcome")
    return prior
  }
  const bootId = (
    await readFile("/proc/sys/kernel/random/boot_id", "utf8")
  ).trim()
  const window = (
    await journal.writeOnce("mux-window.json", {
      bootId,
      deadlineMs:
        monotonic() +
        Math.max(1, Math.min(60000, claim.assignment.expiresAt - Date.now())),
    })
  ).value
  if (
    !window ||
    Object.keys(window).sort().join() !== "bootId,deadlineMs" ||
    typeof window.bootId !== "string" ||
    !Number.isSafeInteger(window.deadlineMs)
  )
    throw new VmInvariantError("Malformed Mux upload window")
  const remaining =
    window.bootId === bootId ? window.deadlineMs - monotonic() : 0
  const done = async (state) =>
    (await journal.writeOnce("mux-outcome.json", { state })).value
  if (remaining <= 0)
    throw new MuxUploadUnresolvedError(
      "Mux upload window exhausted; local output retained",
    )
  const bounded = AbortSignal.any([
    AbortSignal.timeout(Math.floor(remaining)),
    ...(signal ? [signal] : []),
  ])
  const envelope = await journal.read("settlement.json")
  const target = await api.json("mux", envelope, bounded, claim.capability)
  if (["disabled", "skipped", "processing"].includes(target?.state))
    return done(target.state)
  if (
    target?.state !== "upload" ||
    typeof target.uploadId !== "string" ||
    !target.uploadId ||
    !/^[a-f0-9]{64}$/.test(target.digest)
  )
    throw new VmInvariantError("Invalid Mux upload binding")
  const url = new URL(target.url)
  if (
    url.protocol !== "https:" ||
    !(
      url.hostname === "storage.googleapis.com" ||
      url.hostname === "mux.com" ||
      url.hostname.endsWith(".mux.com")
    ) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new VmInvariantError("Invalid Mux upload destination")
  const verified = await journal.read("verified-output.json")
  const info = await stat(path)
  if (
    !verified ||
    verified.digest !== target.digest ||
    !Number.isSafeInteger(verified.bytes) ||
    verified.bytes < 1 ||
    verified.bytes > 134217728 ||
    !info.isFile() ||
    info.size !== verified.bytes
  )
    throw new VmInvariantError("Mux output binding changed")
  const bytes = await readFile(path)
  if (
    bytes.length !== verified.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== target.digest
  )
    throw new VmInvariantError("Mux output bytes changed")
  const saved = (
    await journal.writeOnce("mux-upload.json", {
      uploadId: target.uploadId,
      digest: target.digest,
    })
  ).value
  if (
    saved.uploadId !== target.uploadId ||
    saved.digest !== target.digest ||
    Object.keys(saved).length !== 2
  )
    throw new VmInvariantError("Mux upload identity changed")
  bounded.throwIfAborted()
  try {
    // Query the resumable endpoint before sending bytes. A restarted host resumes
    // the same upload rather than allocating another asset after response loss.
    const probe = await fetcher(url, {
      method: "PUT",
      redirect: "error",
      signal: bounded,
      headers: {
        "content-range": `bytes */${bytes.length}`,
        "content-length": "0",
      },
    })
    void probe.body?.cancel().catch(() => undefined)
    if (probe.ok) return done("uploaded")
    if (probe.status !== 308)
      throw new VmUnconfirmedError("Mux upload status unconfirmed")
    const range = probe.headers.get("range")
    if (range && !/^bytes=0-[0-9]+$/.test(range))
      throw new VmInvariantError("Invalid Mux upload range")
    const offset = range ? Number(range.slice(8)) + 1 : 0
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length)
      throw new VmInvariantError("Invalid Mux upload offset")
    const result = await fetcher(url, {
      method: "PUT",
      redirect: "error",
      signal: bounded,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(bytes.length - offset),
        "content-range": `bytes ${offset}-${bytes.length - 1}/${bytes.length}`,
      },
      body: bytes.subarray(offset),
    })
    void result.body?.cancel().catch(() => undefined)
    if (!result.ok)
      throw new VmUnconfirmedError("Mux direct upload unconfirmed")
    return done("uploaded")
  } catch {
    throw new VmUnconfirmedError("Mux direct upload unconfirmed")
  }
}
