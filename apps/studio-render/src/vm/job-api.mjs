import { VmInvariantError, VmUnconfirmedError } from "./errors.mjs"
const capabilityPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/
const operationMs = Object.freeze({
  receipt: 5000,
  input: 90000,
  owns: 5000,
  retain: 45000,
  finish: 15000,
})
const id = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const matches = (value, pattern) =>
  typeof value === "string" && pattern.test(value)
function exactKeys(value, fields) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  )
}

/** Host-only outbound transport. Installation supplies the endpoint and scoped
 * token; neither comes from authored input. Redirects are never followed. */
export class VmJobApi {
  #token
  constructor({
    endpoint,
    token,
    poolId,
    workerId,
    fixtureHttp = false,
    timeoutMs = 10000,
  }) {
    const url = new URL(endpoint)
    if (url.username || url.password || url.search || url.hash)
      throw new VmInvariantError("Invalid job API endpoint")
    if (url.protocol !== "https:") {
      if (!fixtureHttp) throw new VmInvariantError("Job API requires HTTPS")
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
        throw new VmInvariantError("Fixture endpoint requires loopback HTTP")
    }
    if (
      typeof token !== "string" ||
      token.length < 32 ||
      token.length > 4096 ||
      /\s/.test(token) ||
      !matches(poolId, id) ||
      !matches(workerId, id) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 10000
    )
      throw new VmInvariantError("Invalid job API configuration")
    url.pathname = url.pathname.replace(/\/$/, "") + "/"
    this.endpoint = url.href
    this.binding = Object.freeze({ poolId, workerId })
    this.timeoutMs = timeoutMs
    this.#token = token
  }

  async claim(journal, parentSignal) {
    // This awaited write is before fetch, including on a controller restart.
    const request = await journal.claimRequest(this.binding)
    const response = await this.json(
      "claim",
      { dispatchId: request.dispatchId },
      parentSignal,
    )
    if (
      !exactKeys(response, ["execute", "assignment", "capability"]) ||
      typeof response.execute !== "boolean"
    )
      throw new VmInvariantError("Job API binding refused")
    if (
      !response.execute &&
      response.assignment === null &&
      response.capability === null
    )
      return response
    if (
      !matches(response.capability, capabilityPattern) ||
      response.capability.length > 4096
    )
      throw new VmInvariantError("Job API capability refused")
    const a = response.assignment
    if (
      !exactKeys(a, [
        "poolId",
        "workerId",
        "dispatchId",
        "attemptId",
        "leaseId",
        "expiresAt",
      ]) ||
      a.poolId !== request.poolId ||
      a.workerId !== request.workerId ||
      a.dispatchId !== request.dispatchId ||
      !matches(a.attemptId, id) ||
      !matches(a.leaseId, uuid) ||
      !Number.isSafeInteger(a.expiresAt) ||
      a.expiresAt < 1
    )
      throw new VmInvariantError("Job API binding refused")
    // execute:true means eligibility to resume the original assignment only.
    // Journal operation consumption and runtime reconciliation govern execution.
    return response
  }

  async finish(journal, capability, raw, parentSignal) {
    if (
      !exactKeys(raw, ["settlement"]) ||
      !matches(raw.settlement, capabilityPattern) ||
      raw.settlement.length > 60000
    )
      throw new VmInvariantError("Invalid terminal record")
    // Opaque broker signature: the VM cannot mint or alter it. Gateway verifies
    // signature and exact lease/input binding. Durable bytes precede submission,
    // including retries after boot/deadline expiry; this never starts execution.
    const saved = await journal.writeOnce("settlement.json", raw)
    if (
      !exactKeys(saved.value, ["settlement"]) ||
      saved.value.settlement !== raw.settlement
    )
      throw new VmInvariantError("Changed terminal record")
    return this.json("finish", saved.value, parentSignal, capability)
  }

  async json(action, input, parentSignal, capability) {
    if (
      !["claim", "input", "owns", "retain", "finish", "receipt"].includes(
        action,
      )
    )
      throw new VmInvariantError("Unsupported job API operation")
    if (
      action !== "claim" &&
      (!matches(capability, capabilityPattern) || capability.length > 4096)
    )
      throw new VmInvariantError("Exact lease capability required")
    const timeout = AbortSignal.timeout(
      action === "claim" ? this.timeoutMs : operationMs[action],
    )
    const cleanup = new AbortController()
    const signal = AbortSignal.any([
      timeout,
      cleanup.signal,
      ...(parentSignal ? [parentSignal] : []),
    ])
    let reader
    try {
      const response = await fetch(new URL(action, this.endpoint), {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          authorization: `Bearer ${action === "claim" ? this.#token : capability}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      })
      if (!response.ok || !response.body) {
        void response.body?.cancel().catch(() => undefined)
        throw new VmInvariantError("Unconfirmed response")
      }
      reader = response.body.getReader()
      const chunks = []
      let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (
          size >
          (action === "input"
            ? 180 * 1024 * 1024
            : action === "retain"
              ? 1049600
              : 65536)
        )
          throw new VmInvariantError("Response budget exceeded")
        chunks.push(Buffer.from(value))
      }
      signal.throwIfAborted()
      return JSON.parse(Buffer.concat(chunks, size).toString("utf8"))
    } catch {
      // Never expose upstream response text, URL credentials or signed tokens.
      throw new VmUnconfirmedError("Job API request unconfirmed")
    } finally {
      cleanup.abort()
      // Cancellation is initiated, never awaited beyond the operation lifetime.
      void reader?.cancel().catch(() => undefined)
    }
  }
}
