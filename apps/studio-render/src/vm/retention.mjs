import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { VmInvariantError, VmUnconfirmedError } from "./errors.mjs"

// VM bundles cannot import TS contracts. Worker parity tests pin these bounds.
export const outputPartBytes = 16 * 1024 * 1024
export const outputMaxParts = 8
const { AbortSignal } = globalThis
const outputMaxBytes = 134217728
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
const signed = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/
const id = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/
const monotonicNow = () => Number(process.hrtime.bigint() / 1000000n)
const currentBoot = async () =>
  (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim()
function keys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  )
}
function settlement(value) {
  return (
    keys(value, ["settlement"]) &&
    typeof value.settlement === "string" &&
    value.settlement.length <= 60000 &&
    signed.test(value.settlement)
  )
}
function receipt(value) {
  return keys(value, ["admitted"]) && typeof value.admitted === "boolean"
}
function reference(value, expectedDigest) {
  return (
    keys(value, ["assetId", "versionId", "digest"]) &&
    typeof value.assetId === "string" &&
    id.test(value.assetId) &&
    typeof value.versionId === "string" &&
    id.test(value.versionId) &&
    value.digest === expectedDigest
  )
}

/** Only retired executions reach this path. Recovery reads committed canonical
 * state; all mutations share one persisted boot-bound window, including retries. */
export async function settleVmOutput({
  journal,
  api,
  claim,
  outputDirectory,
  signal,
  now = monotonicNow,
  boot = currentBoot,
  wallNow = Date.now,
}) {
  const startedAt = now()
  let envelope = await journal.read("settlement.json")
  if (envelope !== null && !settlement(envelope))
    throw new VmInvariantError("Malformed terminal record")
  if (!envelope) {
    const recovered = await api.json("receipt", {}, undefined, claim.capability)
    if (recovered !== null) {
      if (
        !keys(recovered, ["settlement", "receipt"]) ||
        !settlement({ settlement: recovered.settlement }) ||
        !receipt(recovered.receipt)
      )
        throw new VmInvariantError("Malformed canonical recovery")
      const saved = await journal.writeOnce("settlement.json", {
        settlement: recovered.settlement,
      })
      if (
        !settlement(saved.value) ||
        saved.value.settlement !== recovered.settlement
      )
        throw new VmInvariantError("Changed terminal record")
      return recovered.receipt
    }
  } else {
    const accepted = await api.json(
      "receipt",
      envelope,
      undefined,
      claim.capability,
    )
    if (accepted !== null) {
      if (!receipt(accepted))
        throw new VmInvariantError("Malformed canonical receipt")
      return accepted
    }
  }
  const bootId = await boot()
  const window =
    (await journal.read("retention-window.json")) ??
    (
      await journal.writeOnce("retention-window.json", {
        bootId,
        deadlineMs: startedAt + 60000,
        // The remote grant cannot outlive this original transfer allowance,
        // even if an edge disconnect fails to propagate cancellation.
        transferDeadlineAt: wallNow() + 45000 - (now() - startedAt),
      })
    ).value
  if (
    !keys(window, ["bootId", "deadlineMs", "transferDeadlineAt"]) ||
    typeof window.bootId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(window.bootId) ||
    !Number.isSafeInteger(window.deadlineMs) ||
    window.deadlineMs <= 0 ||
    !Number.isSafeInteger(window.transferDeadlineAt) ||
    window.transferDeadlineAt <= 0
  )
    throw new VmInvariantError("Malformed retention window")
  const remaining = () =>
    window.bootId === bootId ? window.deadlineMs - now() : 0
  if (remaining() <= 0)
    throw new VmInvariantError(
      "Recording window exhausted; retained receipt unresolved",
    )
  // Compute each operation's allowance from the SAME deadline, never from the
  // previous request's start. Recheck after serialization/network completion.
  const checkCancellation = () => {
    if (signal?.aborted) throw new VmUnconfirmedError("Retention interrupted")
  }
  const transfer = async (action, request) => {
    for (let attempt = 0; ; attempt++) {
      checkCancellation()
      const budget = Math.min(45000, remaining() - 15000)
      if (budget <= 0)
        throw new VmInvariantError("Retention allowance exhausted")
      const bounded = AbortSignal.any([
        AbortSignal.timeout(Math.floor(budget)),
        ...(signal ? [signal] : []),
      ])
      try {
        const result = await api.json(
          action,
          request,
          bounded,
          claim.capability,
        )
        if (bounded.aborted)
          throw new VmUnconfirmedError("Retention interrupted")
        if (remaining() <= 15000)
          throw new VmInvariantError("Retention allowance exhausted")
        return result
      } catch (error) {
        if (
          !(error instanceof VmUnconfirmedError) ||
          attempt >= 1 ||
          bounded.aborted
        )
          throw error
        // Same object, same bytes and provenance. Server registration is idempotent.
      }
    }
  }
  if (!envelope) {
    const verified = await journal.read("verified-output.json")
    let request = { status: "FAILED" }
    if (verified !== null) {
      if (
        !verified ||
        !Number.isSafeInteger(verified.bytes) ||
        verified.bytes < 1 ||
        verified.bytes > outputMaxBytes ||
        typeof verified.digest !== "string" ||
        !/^[a-f0-9]{64}$/.test(verified.digest)
      )
        throw new VmInvariantError("Malformed verified output record")
      const path = join(outputDirectory, "output.mp4")
      const info = await stat(path)
      if (!info.isFile() || info.size !== verified.bytes)
        throw new VmInvariantError("Retained output changed")
      const output = await readFile(path)
      const proof = JSON.parse(
        await readFile(join(outputDirectory, "proof.json"), "utf8"),
      )
      if (
        output.length !== verified.bytes ||
        digest(output) !== verified.digest ||
        proof.outputDigest !== verified.digest
      )
        throw new VmInvariantError("Retained output changed")
      const count = Math.ceil(output.length / outputPartBytes)
      if (count > outputMaxParts)
        throw new VmInvariantError("Output part budget exceeded")
      const parts = []
      for (let index = 0; index < count; index++) {
        checkCancellation()
        const bytes = output.subarray(
          index * outputPartBytes,
          (index + 1) * outputPartBytes,
        )
        const metadata = {
          index,
          count,
          byteSize: bytes.length,
          totalBytes: output.length,
          outputDigest: verified.digest,
          retentionDeadlineMs: window.transferDeadlineAt,
        }
        const name = `retention-part-${index}.json`
        let saved = await journal.read(name)
        if (!saved) {
          const result = await transfer("retain-part", {
            ...metadata,
            output: bytes.toString("base64"),
          })
          if (!keys(result, ["part"]) || !reference(result.part, digest(bytes)))
            throw new VmInvariantError("Malformed retained part")
          saved = (
            await journal.writeOnce(name, { ...metadata, part: result.part })
          ).value
        }
        if (
          !keys(saved, [...Object.keys(metadata), "part"]) ||
          !Object.entries(metadata).every(
            ([key, value]) => saved[key] === value,
          ) ||
          !reference(saved.part, digest(bytes))
        )
          throw new VmInvariantError("Changed retained part")
        parts.push(saved.part)
      }
      request = { status: "SUCCEEDED", parts, proof }
    }
    const requestDigest = digest(JSON.stringify(request))
    const intent = await journal.writeOnce("retention-request.json", {
      requestDigest,
    })
    if (
      !keys(intent.value, ["requestDigest"]) ||
      intent.value.requestDigest !== requestDigest
    )
      throw new VmInvariantError("Changed retention request")
    envelope = await transfer("retain", request)
    if (!settlement(envelope))
      throw new VmInvariantError("Malformed terminal record")
    const saved = await journal.writeOnce("settlement.json", envelope)
    if (
      !settlement(saved.value) ||
      saved.value.settlement !== envelope.settlement
    )
      throw new VmInvariantError("Changed terminal record")
  }
  checkCancellation()
  const recording = Math.min(15000, remaining())
  if (recording <= 0)
    throw new VmInvariantError("Terminal recording allowance exhausted")
  const bounded = AbortSignal.any([
    AbortSignal.timeout(Math.floor(recording)),
    ...(signal ? [signal] : []),
  ])
  try {
    return await api.finish(journal, claim.capability, envelope, bounded)
  } catch {
    const accepted = await api.json(
      "receipt",
      envelope,
      undefined,
      claim.capability,
    )
    if (accepted !== null) {
      if (!receipt(accepted))
        throw new VmInvariantError("Malformed canonical receipt")
      return accepted
    }
    throw new VmUnconfirmedError("Canonical terminal recording unconfirmed")
  }
}
