import { VmInvariantError } from "./errors.mjs"
import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { VmJobApi } from "./job-api.mjs"
const image = /^(?:[a-z0-9][a-z0-9./_-]*@)?sha256:[a-f0-9]{64}$/
export function validateHostConfig(value) {
  const keys = [
    "version",
    "enabled",
    "endpoint",
    "token",
    "poolId",
    "workerId",
    "fixtureHttp",
    "renderImage",
    "verifyImage",
  ]
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key)) ||
    value.version !== 1 ||
    typeof value.enabled !== "boolean" ||
    typeof value.fixtureHttp !== "boolean" ||
    !image.test(value.renderImage) ||
    !image.test(value.verifyImage)
  )
    throw new VmInvariantError("Invalid installed worker configuration")
  new VmJobApi(value)
  return Object.freeze(value)
}
export async function loadHostConfig() {
  if (process.getuid() !== 0)
    throw new VmInvariantError("Trusted root supervisor required")
  const file = await open(
    "/etc/forge-studio/worker.json",
    constants.O_RDONLY | constants.O_NOFOLLOW,
  )
  try {
    const stat = await file.stat()
    if (
      !stat.isFile() ||
      stat.uid !== 0 ||
      stat.mode & 0o077 ||
      stat.nlink !== 1 ||
      stat.size > 16384
    )
      throw new VmInvariantError("Unsafe installed worker configuration")
    return validateHostConfig(JSON.parse(await file.readFile("utf8")))
  } finally {
    await file.close()
  }
}
