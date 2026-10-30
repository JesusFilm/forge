import { executionProfile } from "./execution-profile.mjs"
import { VmInvariantError, isRetryableVmFailure } from "./errors.mjs"
import {
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
  rename,
  realpath,
} from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readCycleState } from "./cycle-state.mjs"
import { pruneCycleArtifacts } from "./cycle-artifacts.mjs"
import { loadHostConfig } from "./config.mjs"
import { uploadVmOutput, MuxUploadUnresolvedError } from "./mux-upload.mjs"
import { VmJournal } from "./journal.mjs"
import { settleVmOutput } from "./retention.mjs"
import { VmJobApi } from "./job-api.mjs"
import { DockerJobRuntime } from "./docker-runtime.mjs"
import { jobIdentity } from "./profile.mjs"
import { createJobScope, cancelJobScope, retireJobScope } from "./job-scope.mjs"
import { runHostCommand } from "./host-command.mjs"
const { AbortController, setTimeout } = globalThis
const root = "/var/lib/forge-studio/poll",
  now = () => Number(process.hrtime.bigint() / 1000000n)
const boot = async () =>
  (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim()
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error.code === "ENOENT") return false
    throw error
  }
}
async function status(value) {
  const temporary = "/var/lib/forge-studio/status.pending"
  await writeFile(temporary, JSON.stringify(value) + "\n", { mode: 0o600 })
  await rename(temporary, "/var/lib/forge-studio/status.json")
}
async function cycle() {
  await mkdir(root, { recursive: true, mode: 0o700 })
  let active
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name))
      throw new VmInvariantError("Unexpected poll journal entry")
    const path = join(root, entry.name),
      journal = new VmJournal(path)
    if (!(await readCycleState(journal)).complete) {
      if (active)
        throw new VmInvariantError("Multiple unfinished polling cycles")
      active = path
    } else await pruneCycleArtifacts(journal)
  }
  if (active) return active
  const path = join(root, randomUUID().replaceAll("-", ""))
  await mkdir(path, { mode: 0o700 })
  return path
}

export async function runVmSupervisor() {
  if (process.getuid() !== 0)
    throw new VmInvariantError("Trusted root supervisor required")
  const release = dirname(dirname(fileURLToPath(import.meta.url)))
  if (!/^\/opt\/forge-studio\/releases\/[a-f0-9]{64}$/.test(release))
    throw new VmInvariantError("Installed release path required")
  let stopping = false,
    activeStop
  const stop = () => {
    stopping = true
    activeStop?.()
  }
  process.once("SIGTERM", stop)
  process.once("SIGINT", stop)
  try {
    for (;;) {
      const directory = await cycle(),
        journal = new VmJournal(directory)
      const cycleState = await readCycleState(journal),
        existing = cycleState.assignment
      // Recover physical execution using persisted identity before loading mutable
      // credentials or making any gateway request.
      if (existing && !cycleState.retired) {
        const oldId = existing.binding.dispatchId.replaceAll("-", ""),
          oldGate = await journal.read("scope.json")
        if (oldGate) {
          if (oldGate.bootId === (await boot())) await cancelJobScope(oldId)
          const retirementDeadline = now() + 2000
          await new DockerJobRuntime({
            identity: jobIdentity(oldId),
            journal,
            gate: oldGate,
          }).reconcile(existing.binding, retirementDeadline)
          await retireJobScope(oldId, journal, retirementDeadline)
        } else {
          if (
            (await journal.read("render-create-intent.json")) ||
            (await journal.read("verify-create-intent.json"))
          )
            throw new VmInvariantError("Unconfirmed scope history")
          await journal.writeOnce("retired.json", { id: oldId, complete: true })
        }
      }
      const config = await loadHostConfig()
      if (
        !existing &&
        (stopping ||
          !config.enabled ||
          (await exists("/var/lib/forge-studio/drain")))
      ) {
        await status({ state: "drained" })
        return
      }
      const api = new VmJobApi(config)
      // Image acquisition is a release operation, never part of a claimed job.
      const placeholder = jobIdentity("0".repeat(32))
      if (!existing)
        await new DockerJobRuntime({
          identity: placeholder,
          journal,
          gate: {},
        }).imagesReady([config.renderImage, config.verifyImage])
      const claim = await api.claim(journal)
      if (!claim.assignment) {
        await status({ state: "idle" })
        await wait(2000)
        continue
      }
      const id = claim.assignment.dispatchId.replaceAll("-", ""),
        identity = jobIdentity(id)
      const record =
        existing ??
        (await journal.assignment(claim.assignment, {
          bootId: await boot(),
          deadlineMs:
            now() +
            Math.max(
              1,
              Math.min(
                executionProfile.jobMs,
                claim.assignment.expiresAt - Date.now() - 60000,
              ),
            ),
          renderImage: config.renderImage,
          verifyImage: config.verifyImage,
        }))
      await status({
        state: "assigned",
        dispatchId: claim.assignment.dispatchId,
        attemptId: claim.assignment.attemptId,
      })
      let gate = await journal.read("scope.json")
      if (!existing && claim.execute && !stopping) {
        await journal.writeOnce("transport.json", claim)
        gate = await createJobScope(
          id,
          record,
          journal,
          release + "/vm-watchdog",
        )
        const controller = new AbortController(),
          monitorStop = new AbortController()
        activeStop = () => {
          void cancelJobScope(id).catch(() => {})
          controller.abort()
        }
        let monitoring = true
        const monitor = (async () => {
          while (monitoring) {
            if (stopping) {
              await cancelJobScope(id)
              controller.abort()
              return
            }
            try {
              const valid = await api.json(
                "owns",
                {},
                monitorStop.signal,
                claim.capability,
              )
              if (!valid) {
                await cancelJobScope(id)
                controller.abort()
                return
              }
            } catch {
              if (monitoring) {
                await cancelJobScope(id)
                controller.abort()
              }
              return
            }
            await wait(1000)
          }
        })()
        try {
          await runHostCommand(
            "/usr/bin/systemd-run",
            [
              `--unit=forge-studio-controller-${id}`,
              "--wait",
              "--pipe",
              "--quiet",
              "--service-type=exec",
              `--property=Slice=${identity.slice}`,
              "--property=KillMode=control-group",
              "--property=TimeoutStopSec=2s",
              "--property=LimitNOFILE=256",
              "--property=LimitFSIZE=134217728",
              release + "/node",
              release + "/vm/controller.mjs",
              directory,
            ],
            {
              signal: controller.signal,
              timeoutMs: Math.max(1, gate.deadlineMs - now() + 2000),
              outputBytes: 65536,
            },
          )
        } catch {
          /* Canonical failure is recorded only after physical retirement. */
        } finally {
          monitoring = false
          monitorStop.abort()
          await monitor
          activeStop = undefined
        }
      }
      if (!(await readCycleState(journal)).retired) {
        if (gate) {
          if (gate.bootId === (await boot())) await cancelJobScope(id)
          const runtime = new DockerJobRuntime({ identity, journal, gate })
          const retirementDeadline = now() + 2000
          await runtime.reconcile(record.binding, retirementDeadline)
          await retireJobScope(id, journal, retirementDeadline)
        } else {
          // No scope implies no Docker operation could pass launch admission.
          if (
            (await journal.read("render-create-intent.json")) ||
            (await journal.read("verify-create-intent.json"))
          )
            throw new VmInvariantError("Unconfirmed scope history")
          await journal.writeOnce("retired.json", { id, complete: true })
        }
      }
      const retentionStop = new AbortController()
      activeStop = () => retentionStop.abort()
      if (stopping) retentionStop.abort()
      let receipt
      try {
        receipt = await settleVmOutput({
          journal,
          api,
          claim,
          outputDirectory: identity.directory,
          signal: retentionStop.signal,
        })
      } finally {
        activeStop = undefined
      }
      if (!receipt || typeof receipt.admitted !== "boolean")
        throw new VmInvariantError("Canonical receipt required")
      if (receipt.admitted && (await journal.read("verified-output.json"))) {
        const uploadStop = new AbortController()
        activeStop = () => uploadStop.abort()
        if (stopping) uploadStop.abort()
        try {
          await uploadVmOutput({
            journal,
            api,
            claim,
            path: identity.directory + "/output.mp4",
            signal: uploadStop.signal,
          })
        } finally {
          activeStop = undefined
        }
      }
      await journal.writeOnce("complete.json", { id, receipt })
      await pruneCycleArtifacts(journal)
      await status({
        state: "settled",
        dispatchId: claim.assignment.dispatchId,
        receipt,
      })
    }
  } finally {
    process.removeListener("SIGTERM", stop)
    process.removeListener("SIGINT", stop)
  }
}
if (
  process.argv[1] &&
  (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)
) {
  try {
    await runVmSupervisor()
  } catch (error) {
    const retry = isRetryableVmFailure(error)
    await status({
      state: retry ? "retrying" : "quarantined",
      message:
        error instanceof MuxUploadUnresolvedError
          ? "Mux upload unresolved; local output retained"
          : "Exact journal/runtime reconciliation required",
    }).catch(() => {})
    process.stderr.write(
      "Studio worker incomplete; preserved journal requires reconciliation\n",
    )
    process.exitCode = retry ? 1 : 78
  }
}
