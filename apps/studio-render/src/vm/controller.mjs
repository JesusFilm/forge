import { VmInvariantError } from "./errors.mjs"
import { readFile, open } from "node:fs/promises"
import { constants } from "node:fs"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { loadHostConfig } from "./config.mjs"
import { VmJobApi } from "./job-api.mjs"
import { VmJournal } from "./journal.mjs"
import { DockerJobRuntime } from "./docker-runtime.mjs"
import { jobIdentity } from "./profile.mjs"
import { renderFiles, verificationFiles, stageFiles } from "./staging.mjs"
const now = () => Number(process.hrtime.bigint() / 1000000n)
async function durableFile(path, bytes) {
  const file = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await file.writeFile(bytes)
    await file.sync()
  } finally {
    await file.close()
  }
}

/** Host-only controller runs under the same bounded aggregate ancestor as both
 * sequential containers. Its installation config is never mounted into either. */
export async function executeVmController(directory, config) {
  if (
    process.getuid() !== 0 ||
    !/^\/var\/lib\/forge-studio\/poll\/[a-f0-9]{32}$/.test(directory)
  )
    throw new VmInvariantError("Owned controller state required")
  const journal = new VmJournal(directory),
    record = await journal.read("assignment.json"),
    claim = await journal.read("transport.json"),
    gate = await journal.read("scope.json")
  const a = claim?.assignment
  if (
    !record ||
    !a ||
    !gate ||
    !claim.capability ||
    ![
      "poolId",
      "workerId",
      "dispatchId",
      "attemptId",
      "leaseId",
      "expiresAt",
    ].every((key) => record.binding[key] === a[key])
  )
    throw new VmInvariantError("Controller assignment binding refused")
  const id = a.dispatchId.replaceAll("-", ""),
    identity = jobIdentity(id)
  const remaining = gate.deadlineMs - now()
  if (remaining <= 0 || gate.deadlineMs !== record.deadlineMs)
    throw new VmInvariantError("Original controller deadline expired")
  const stop = new AbortController(),
    cancel = () => stop.abort()
  process.once("SIGTERM", cancel)
  process.once("SIGINT", cancel)
  const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(remaining)])
  try {
    const api = new VmJobApi(config)
    if (!(await api.json("owns", {}, signal, claim.capability)))
      throw new VmInvariantError("Canonical lease no longer current")
    const response = await api.json("input", {}, signal, claim.capability)
    if (
      !response ||
      !Object.keys(a).every((key) => a[key] === response.assignment?.[key]) ||
      !/^[a-f0-9]{64}$/.test(response.inputHash)
    )
      throw new VmInvariantError("Prepared input binding refused")
    await journal.writeOnce("prepared-input.json", {
      inputHash: response.inputHash,
    })
    const runtime = new DockerJobRuntime({ identity, journal, gate })
    await stageFiles(id, "render", renderFiles(response.prepared))
    const output = await runtime.phase(
      "render",
      record.binding.renderImage,
      signal,
    )
    if (
      /oom_kill [1-9]/.test(
        await readFile(identity.cgroup + "/memory.events", "utf8"),
      )
    )
      throw new VmInvariantError("Execution memory failure")
    await durableFile(identity.directory + "/output.mp4", output)
    await stageFiles(
      id,
      "verify",
      verificationFiles(output, response.prepared.input.document),
    )
    const verification = await runtime.phase(
      "verify",
      record.binding.verifyImage,
      signal,
    )
    if (
      /oom_kill [1-9]/.test(
        await readFile(identity.cgroup + "/memory.events", "utf8"),
      )
    )
      throw new VmInvariantError("Verification memory failure")
    const proof = JSON.parse(verification),
      digest = createHash("sha256").update(output).digest("hex")
    if (proof.decoded !== true || proof.outputDigest !== digest)
      throw new VmInvariantError("Independent verification failed")
    signal.throwIfAborted()
    await durableFile(identity.directory + "/proof.json", verification)
    const parent = await open(
      identity.directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    try {
      await parent.sync()
    } finally {
      await parent.close()
    }
    await journal.writeOnce("verified-output.json", {
      digest,
      bytes: output.length,
      inputHash: response.inputHash,
    })
    return {
      digest,
      bytes: output.length,
      remainingMs: gate.deadlineMs - now(),
    }
  } finally {
    process.removeListener("SIGTERM", cancel)
    process.removeListener("SIGINT", cancel)
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const config = await loadHostConfig()
    const result = await executeVmController(process.argv[2], config)
    process.stdout.write(JSON.stringify(result) + "\n")
  } catch {
    process.stderr.write(
      "Studio controller unsuccessful; exact runtime reconciliation required\n",
    )
    process.exitCode = 1
  }
}
