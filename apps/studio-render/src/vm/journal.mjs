import { VmInvariantError } from "./errors.mjs"
import { constants } from "node:fs"
import { open, link, unlink, readdir, readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { randomUUID } from "node:crypto"

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const image = /^(?:[a-z0-9][a-z0-9./_-]*@)?sha256:[a-f0-9]{64}$/
const id = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/
const matches = (value, pattern) =>
  typeof value === "string" && pattern.test(value)
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0
function keys(value, names) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name))
  )
}
function validRequest(value) {
  return (
    keys(value, ["poolId", "workerId", "dispatchId"]) &&
    matches(value.poolId, id) &&
    matches(value.workerId, id) &&
    matches(value.dispatchId, uuid)
  )
}
function validAssignment(value) {
  if (
    !keys(value, ["binding", "deadlineMs"]) ||
    !positiveInteger(value.deadlineMs)
  )
    return false
  const b = value.binding
  return (
    keys(b, [
      "poolId",
      "workerId",
      "dispatchId",
      "attemptId",
      "leaseId",
      "expiresAt",
      "bootId",
      "renderImage",
      "verifyImage",
    ]) &&
    validRequest({
      poolId: b.poolId,
      workerId: b.workerId,
      dispatchId: b.dispatchId,
    }) &&
    matches(b.attemptId, id) &&
    matches(b.leaseId, uuid) &&
    positiveInteger(b.expiresAt) &&
    matches(b.bootId, uuid) &&
    matches(b.renderImage, image) &&
    matches(b.verifyImage, image)
  )
}
async function assertClock(assignment) {
  const bootId = (
    await readFile("/proc/sys/kernel/random/boot_id", "utf8")
  ).trim()
  if (
    assignment.binding.bootId !== bootId ||
    Number(process.hrtime.bigint() / 1000000n) >= assignment.deadlineMs
  )
    throw new VmInvariantError("Execution clock expired or changed boot")
}
function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** A host-owned journal for one polling cycle. Its directory is supplied only
 * by trusted installation/launcher code, never by a job response. Files are
 * write-once; uncertain operations are reconciled, never repeated. Directory
 * retirement/selection of another cycle belongs to the supervisor. */
export class VmJournal {
  constructor(directory) {
    this.directory = directory
  }

  async read(name) {
    let file
    try {
      file = await open(
        join(this.directory, name),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      )
      const stat = await file.stat()
      if (
        !stat.isFile() ||
        stat.uid !== process.getuid() ||
        stat.mode & 0o077 ||
        stat.size > 65536
      )
        throw new VmInvariantError("Unsafe journal record")
      return JSON.parse(await file.readFile("utf8"))
    } catch (error) {
      if (error.code === "ENOENT") return null
      throw error
    } finally {
      await file?.close()
    }
  }

  async writeOnce(name, value) {
    // A leftover temporary record may be an interrupted write. Never delete or
    // reinterpret it to make a cycle executable. A concurrent writer may also
    // cause this refusal; the caller must not start work on a refused result.
    if (
      (await readdir(this.directory)).some((entry) =>
        entry.startsWith(".pending-"),
      )
    )
      throw new VmInvariantError("Journal persistence unconfirmed")
    const directory = await open(
      this.directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    const stat = await directory.stat()
    if (stat.uid !== process.getuid() || stat.mode & 0o077) {
      await directory.close()
      throw new VmInvariantError("Unsafe journal directory")
    }
    const temporary = join(this.directory, `.pending-${randomUUID()}`)
    let file,
      created = false,
      confirmed = false
    try {
      file = await open(temporary, "wx", 0o600)
      await file.writeFile(JSON.stringify(value) + "\n")
      await file.sync()
      await file.close()
      file = undefined
      try {
        await link(temporary, join(this.directory, name))
        created = true
      } catch (error) {
        if (error.code !== "EEXIST") throw error
      }
      // Also sync after losing a race: observing another writer's link alone
      // does not establish that its parent-directory entry is durable yet.
      await directory.sync()
      const persisted = await this.read(name)
      confirmed = true
      return { created, value: persisted }
    } finally {
      await file?.close()
      if (confirmed) await unlink(temporary)
      await directory.close()
    }
  }

  async claimRequest({ poolId, workerId }) {
    if (!matches(poolId, id) || !matches(workerId, id))
      throw new VmInvariantError("Invalid claim binding")
    // The journal directory itself must survive power loss before its durable
    // dispatch UUID can be transmitted. Sync existing cycles too, so a previous
    // interrupted mkdir/sync cannot bypass this admission step on restart.
    const parent = await open(
      dirname(this.directory),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    try {
      await parent.sync()
    } finally {
      await parent.close()
    }
    const { value } = await this.writeOnce("claim-request.json", {
      poolId,
      workerId,
      dispatchId: randomUUID(),
    })
    if (
      !validRequest(value) ||
      value.poolId !== poolId ||
      value.workerId !== workerId ||
      !uuid.test(value.dispatchId)
    )
      throw new VmInvariantError("Changed claim binding")
    return value
  }

  async assignment(raw, runtime) {
    const request = await this.read("claim-request.json")
    if (
      !validRequest(request) ||
      !matches(raw.attemptId, id) ||
      !uuid.test(raw.leaseId) ||
      !Number.isSafeInteger(raw.expiresAt) ||
      raw.expiresAt < 1 ||
      !equal(request, {
        poolId: raw.poolId,
        workerId: raw.workerId,
        dispatchId: raw.dispatchId,
      }) ||
      !uuid.test(runtime.bootId) ||
      !image.test(runtime.renderImage) ||
      !image.test(runtime.verifyImage) ||
      !Number.isSafeInteger(runtime.deadlineMs) ||
      runtime.deadlineMs < 1
    )
      throw new VmInvariantError("Invalid assignment binding")
    const binding = {
      ...request,
      attemptId: raw.attemptId,
      leaseId: raw.leaseId,
      expiresAt: raw.expiresAt,
      bootId: runtime.bootId,
      renderImage: runtime.renderImage,
      verifyImage: runtime.verifyImage,
    }
    const { value } = await this.writeOnce("assignment.json", {
      binding,
      deadlineMs: runtime.deadlineMs,
    })
    if (!validAssignment(value) || !equal(value.binding, binding))
      throw new VmInvariantError("Changed assignment binding")
    // A duplicate response never resets the original execution deadline.
    return value
  }

  async issued() {
    if (
      (await readdir(this.directory)).some((name) =>
        name.startsWith(".pending-"),
      )
    )
      throw new VmInvariantError("Journal persistence unconfirmed")
    const assignment = await this.read("assignment.json")
    if (assignment === null) return null
    const request = await this.read("claim-request.json")
    if (
      !validAssignment(assignment) ||
      !validRequest(request) ||
      !equal(request, {
        poolId: assignment.binding.poolId,
        workerId: assignment.binding.workerId,
        dispatchId: assignment.binding.dispatchId,
      })
    )
      throw new VmInvariantError("Malformed assignment binding")
    return assignment
  }

  async beginOperation(phase, operation) {
    if (
      !["render", "verify"].includes(phase) ||
      !["create", "start"].includes(operation)
    )
      throw new VmInvariantError("Invalid Docker operation")
    const assignment = await this.read("assignment.json")
    const request = await this.read("claim-request.json")
    if (
      !validAssignment(assignment) ||
      !validRequest(request) ||
      !equal(request, {
        poolId: assignment.binding.poolId,
        workerId: assignment.binding.workerId,
        dispatchId: assignment.binding.dispatchId,
      })
    )
      throw new VmInvariantError("Malformed assignment binding")
    await assertClock(assignment)
    if (operation === "start") {
      const created = await this.read(`${phase}-created.json`)
      const intent = await this.read(`${phase}-create-intent.json`)
      if (
        !keys(created, ["containerId"]) ||
        !matches(created.containerId, /^[a-f0-9]{64}$/) ||
        !equal(intent, { phase, operation: "create" })
      )
        throw new VmInvariantError("Docker create unconfirmed")
    }
    const result = await this.writeOnce(`${phase}-${operation}-intent.json`, {
      phase,
      operation,
    })
    if (!equal(result.value, { phase, operation }))
      throw new VmInvariantError("Malformed Docker operation intent")
    await assertClock(assignment)
    return result.created
  }

  async created(phase, containerId) {
    if (
      !["render", "verify"].includes(phase) ||
      !/^[a-f0-9]{64}$/.test(containerId) ||
      !equal(await this.read(`${phase}-create-intent.json`), {
        phase,
        operation: "create",
      })
    )
      throw new VmInvariantError("Invalid created container")
    const { value } = await this.writeOnce(`${phase}-created.json`, {
      containerId,
    })
    if (!keys(value, ["containerId"]) || value.containerId !== containerId)
      throw new VmInvariantError("Changed container binding")
    return value
  }
}
