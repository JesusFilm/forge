import { VmInvariantError } from "./errors.mjs"
import { readFile } from "node:fs/promises"
import { containerArguments, jobIdentity } from "./profile.mjs"
import { assertLaunchable } from "./launch-gate.mjs"
import { assertRetirementBarrier } from "./job-scope.mjs"
import { runHostCommand } from "./host-command.mjs"
const imagePattern = /^(?:[a-z0-9][a-z0-9./_-]*@)?sha256:[a-f0-9]{64}$/
const cidPattern = /^[a-f0-9]{64}$/
const now = () => Number(process.hrtime.bigint() / 1000000n)

/** One issued execution's Docker operations. The external watchdog and caller's
 * reconciliation retain ownership if any CLI operation is unconfirmed. */
export class DockerJobRuntime {
  constructor({
    identity,
    journal,
    gate,
    run = runHostCommand,
    admit = assertLaunchable,
    barrier = assertRetirementBarrier,
  }) {
    const expected = jobIdentity(identity.id)
    if (JSON.stringify(identity) !== JSON.stringify(expected))
      throw new VmInvariantError("Invalid runtime identity")
    this.identity = expected
    this.journal = journal
    this.gate = gate
    this.run = run
    this.admit = admit
    this.barrier = barrier
  }
  async docker(args, options = {}) {
    return this.run("/usr/bin/docker", args, { timeoutMs: 10000, ...options })
  }
  async imagesReady(images) {
    for (const image of images) {
      if (!imagePattern.test(image))
        throw new VmInvariantError("Approved immutable image required")
      const records = JSON.parse(
        (await this.docker(["image", "inspect", image])).stdout,
      )
      if (
        !Array.isArray(records) ||
        records.length !== 1 ||
        !imagePattern.test(records[0].Id) ||
        (records[0].Id !== image && !records[0].RepoDigests?.includes(image))
      )
        throw new VmInvariantError("Approved image is not present")
    }
  }
  async inspect(cid, phase, image) {
    if (!cidPattern.test(cid))
      throw new VmInvariantError("Invalid container identity")
    const values = JSON.parse((await this.docker(["inspect", cid])).stdout)
    const value = values?.[0]
    if (
      values.length !== 1 ||
      value.Id !== cid ||
      value.Config?.Labels?.["io.forge.studio.job"] !== this.identity.id ||
      value.Config?.Labels?.["io.forge.studio.phase"] !== phase ||
      (image.startsWith("sha256:") && value.Image !== image)
    )
      throw new VmInvariantError("Container identity binding changed")
    return value
  }
  async reconcile(binding, absoluteDeadlineMs = now() + 2000) {
    const docker = (args) => {
      if (now() >= absoluteDeadlineMs)
        throw new VmInvariantError("Runtime retirement deadline exhausted")
      return this.docker(args, { absoluteDeadlineMs })
    }
    const previousBoot =
      typeof binding.bootId === "string" &&
      binding.bootId !==
        (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim()
    if (!previousBoot)
      await this.barrier(this.identity.id, this.gate, absoluteDeadlineMs)
    const scan = async () => {
      const found = (
        await docker([
          "ps",
          "--all",
          "--no-trunc",
          "--filter",
          `label=io.forge.studio.job=${this.identity.id}`,
          "--format",
          "{{.ID}}",
        ])
      ).stdout.trim()
      const ids = found ? found.split("\n") : []
      if (
        ids.length > 2 ||
        ids.some((id) => !cidPattern.test(id)) ||
        new Set(ids).size !== ids.length
      )
        throw new VmInvariantError("Unexpected runtime identities")
      return ids
    }
    const ids = await scan(),
      observed = new Map()
    for (const cid of ids) {
      const values = JSON.parse((await docker(["inspect", cid])).stdout),
        value = values?.[0]
      const phase = value?.Config?.Labels?.["io.forge.studio.phase"]
      if (
        values.length !== 1 ||
        value.Id !== cid ||
        !["render", "verify"].includes(phase) ||
        value.Name !== `/forge-studio-${this.identity.id}-${phase}` ||
        value.Config.Labels["io.forge.studio.job"] !== this.identity.id ||
        observed.has(phase)
      )
        throw new VmInvariantError("Container identity binding changed")
      if (
        previousBoot &&
        (value.State?.Running !== false ||
          value.HostConfig?.RestartPolicy?.Name !== "no")
      )
        throw new VmInvariantError(
          "Previous boot runtime requires operator quarantine",
        )
      const image = binding[phase + "Image"]
      if (!imagePattern.test(image))
        throw new VmInvariantError("Missing issued image binding")
      const expected = image.startsWith("sha256:")
        ? image
        : JSON.parse((await docker(["image", "inspect", image])).stdout)[0]?.Id
      if (value.Image !== expected)
        throw new VmInvariantError("Container image binding changed")
      observed.set(phase, cid)
    }
    let unresolved = false
    for (const phase of ["render", "verify"]) {
      const intent = await this.journal.read(`${phase}-create-intent.json`),
        created = await this.journal.read(`${phase}-created.json`)
      const actual = observed.get(phase)
      if (actual && !intent)
        throw new VmInvariantError("Unissued container identity")
      if (
        created &&
        (!cidPattern.test(created.containerId) ||
          (actual && actual !== created.containerId))
      )
        throw new VmInvariantError("Changed issued container")
      if (created && !actual) {
        const present = (
          await docker([
            "ps",
            "--all",
            "--no-trunc",
            "--filter",
            `id=${created.containerId}`,
            "--format",
            "{{.ID}}",
          ])
        ).stdout.trim()
        if (present)
          throw new VmInvariantError(
            "Known container is outside the expected identity projection",
          )
        await this.journal.writeOnce(`${phase}-removed.json`, {
          containerId: created.containerId,
        })
      }
      if (intent && !created && !actual && !previousBoot) unresolved = true
      if (actual) {
        // Frozen native tombstone remains in place through this exact-ID removal.
        await docker(["rm", "--force", actual])
        if (!created) await this.journal.created(phase, actual)
        await this.journal.writeOnce(`${phase}-removed.json`, {
          containerId: actual,
        })
      }
    }
    if ((await scan()).length)
      throw new VmInvariantError("Runtime containers remain")
    if (unresolved)
      throw new VmInvariantError("Unresolved create remains quarantined")
    await this.journal.writeOnce("runtime-reconciled.json", {
      id: this.identity.id,
      complete: true,
      bootId: (
        await readFile("/proc/sys/kernel/random/boot_id", "utf8")
      ).trim(),
    })
  }
  async phase(phase, image, signal) {
    if (!["render", "verify"].includes(phase) || !imagePattern.test(image))
      throw new VmInvariantError("Invalid execution phase")
    if (!(await this.journal.beginOperation(phase, "create")))
      throw new VmInvariantError("Consumed create requires reconciliation")
    await this.admit(this.identity.id, this.gate)
    const created = await this.docker(
      containerArguments({
        identity: this.identity,
        image,
        deadlineMs: this.gate.deadlineMs,
        phase,
      }),
      { signal },
    )
    const cid = created.stdout.trim()
    if (!cidPattern.test(cid))
      throw new VmInvariantError("Docker create unconfirmed")
    await this.journal.created(phase, cid)
    if (!(await this.journal.beginOperation(phase, "start")))
      throw new VmInvariantError("Consumed start requires reconciliation")
    await this.admit(this.identity.id, this.gate)
    const remaining = this.gate.deadlineMs - now()
    if (remaining <= 0)
      throw new VmInvariantError("Original execution deadline expired")
    const output = await this.docker(["start", "--attach", cid], {
      signal,
      timeoutMs: remaining + 1000,
      outputBytes: phase === "render" ? 134217728 : 8192,
      text: false,
    })
    const observed = await this.inspect(cid, phase, image)
    await this.journal.writeOnce(`${phase}-exit.json`, observed.State)
    if (
      observed.State.Running ||
      observed.State.ExitCode !== 0 ||
      observed.State.OOMKilled
    )
      throw new VmInvariantError("Container execution unsuccessful")
    await this.docker(["rm", cid])
    await this.journal.writeOnce(`${phase}-removed.json`, { containerId: cid })
    return output.output
  }
}
