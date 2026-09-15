import { VmInvariantError } from "./errors.mjs"
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const cid = /^[a-f0-9]{64}$/
function keys(value, names) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name))
  )
}
export async function readCycleState(journal) {
  const assignment = await journal.issued(),
    retired = await journal.read("retired.json"),
    complete = await journal.read("complete.json"),
    scope = await journal.read("scope.json")
  if (!assignment) {
    if (retired !== null || complete !== null || scope !== null)
      throw new VmInvariantError("Malformed terminal assignment")
    return { assignment: null, retired: false, complete: false }
  }
  const id = assignment.binding.dispatchId.replaceAll("-", "")
  for (const phase of ["render", "verify"]) {
    for (const operation of ["create", "start"]) {
      const intent = await journal.read(`${phase}-${operation}-intent.json`)
      if (
        intent !== null &&
        (!keys(intent, ["phase", "operation"]) ||
          intent.phase !== phase ||
          intent.operation !== operation)
      )
        throw new VmInvariantError("Malformed operation intent")
    }
    const created = await journal.read(`${phase}-created.json`),
      removed = await journal.read(`${phase}-removed.json`)
    if (
      created !== null &&
      (!keys(created, ["containerId"]) || !cid.test(created.containerId))
    )
      throw new VmInvariantError("Malformed container record")
    if (
      removed !== null &&
      (!keys(removed, ["containerId"]) || !cid.test(removed.containerId))
    )
      throw new VmInvariantError("Malformed removed record")
  }
  if (
    scope !== null &&
    (!keys(scope, ["bootId", "deadlineMs", "cgroupInode"]) ||
      scope.bootId !== assignment.binding.bootId ||
      scope.deadlineMs !== assignment.deadlineMs ||
      typeof scope.cgroupInode !== "string" ||
      !/^[1-9][0-9]*$/.test(scope.cgroupInode))
  )
    throw new VmInvariantError("Malformed scope binding")
  if (retired !== null) {
    if (
      !keys(retired, ["id", "complete"]) ||
      retired.id !== id ||
      retired.complete !== true
    )
      throw new VmInvariantError("Malformed retirement marker")
    const reconciled = await journal.read("runtime-reconciled.json")
    if (
      scope !== null &&
      (!keys(reconciled, ["id", "complete", "bootId"]) ||
        reconciled.id !== id ||
        reconciled.complete !== true ||
        !uuid.test(reconciled.bootId))
    )
      throw new VmInvariantError("Missing runtime reconciliation")
    for (const phase of ["render", "verify"]) {
      const intent = await journal.read(`${phase}-create-intent.json`),
        created = await journal.read(`${phase}-created.json`),
        removed = await journal.read(`${phase}-removed.json`)
      if (
        intent &&
        (!scope ||
          !keys(intent, ["phase", "operation"]) ||
          intent.phase !== phase ||
          intent.operation !== "create")
      )
        throw new VmInvariantError("Malformed retired operation")
      if (
        created &&
        (!intent ||
          !keys(created, ["containerId"]) ||
          !cid.test(created.containerId))
      )
        throw new VmInvariantError("Malformed retired container")
      if (
        created &&
        (!keys(removed, ["containerId"]) ||
          removed.containerId !== created.containerId)
      )
        throw new VmInvariantError("Missing exact container retirement")
      if (!created && removed)
        throw new VmInvariantError("Unissued container retirement")
      if (intent && !created && reconciled.bootId === scope.bootId)
        throw new VmInvariantError("Unresolved create cannot be retired")
    }
  }
  if (complete !== null) {
    if (
      !keys(complete, ["id", "receipt"]) ||
      complete.id !== id ||
      !keys(complete.receipt, ["admitted"]) ||
      typeof complete.receipt.admitted !== "boolean" ||
      retired === null
    )
      throw new VmInvariantError("Malformed terminal receipt")
    const sealed = await journal.read("settlement.json")
    if (
      !keys(sealed, ["settlement"]) ||
      typeof sealed.settlement !== "string" ||
      sealed.settlement.length > 60000 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(sealed.settlement)
    )
      throw new VmInvariantError("Missing durable settlement")
  }
  return { assignment, retired: retired !== null, complete: complete !== null }
}
