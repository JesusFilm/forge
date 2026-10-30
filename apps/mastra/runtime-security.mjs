import { Buffer } from "node:buffer"
import { setTimeout, clearTimeout } from "node:timers"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { connect } from "node:tls"
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib"

const execute = promisify(execFile)
const rejectedHosts = [
  "dv-g3b-emudhra.we-have-a-problem.com",
  "dv-g3b-aaa-emudhra.we-have-a-problem.com",
]
const stores = {
  bundle: [
    "-CAfile",
    "/etc/ssl/certs/ca-certificates.crt",
    "-no-CApath",
    "-no-CAstore",
  ],
  directory: ["-CApath", "/etc/ssl/certs", "-no-CAfile", "-no-CAstore"],
  managed: [
    "-CApath",
    "/usr/local/share/security-ca/certs",
    "-no-CAfile",
    "-no-CAstore",
  ],
}

export class RuntimeSecurityError extends Error {
  constructor(code) {
    super(code)
    this.name = "RuntimeSecurityError"
    this.code = code
  }
}
function requireCheck(condition, code) {
  if (!condition) throw new RuntimeSecurityError(code)
}
export function verifyRuntime(
  version,
  blockSwitch = constants.BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH,
) {
  const match = /^v24\.(\d+)\.(\d+)$/.exec(version)
  // Node backports the fix without changing its bundled Brotli 1.2.0 label.
  requireCheck(
    match &&
      (Number(match[1]) > 22 ||
        (Number(match[1]) === 22 && Number(match[2]) >= 1)),
    "node_security_release_required",
  )
  requireCheck(blockSwitch === -17, "brotli_fix_marker_missing")
  const input = Buffer.from("Forge Mastra benign Brotli startup control")
  requireCheck(
    brotliDecompressSync(brotliCompressSync(input)).equals(input),
    "brotli_roundtrip_failed",
  )
}
export function deploymentIdentity(env) {
  return Object.fromEntries(
    [
      "RAILWAY_DEPLOYMENT_ID",
      "RAILWAY_REPLICA_ID",
      "RAILWAY_GIT_COMMIT_SHA",
    ].map((key) => [key, env[key] ?? null]),
  )
}
export function verifyTrustResult(store, host, expectedAccept, result) {
  const passed = expectedAccept
    ? result.accepted
    : !result.accepted && result.certificateRejected
  requireCheck(passed, `tls_control_failed:${store}:${host}`)
  return { store, host, expectedAccept, passed: true }
}
function nodeTransport(host) {
  return new Promise((resolve) => {
    const socket = connect({
      host,
      port: 443,
      servername: host,
      rejectUnauthorized: true,
    })
    const deadline = setTimeout(
      () => finish({ accepted: false, certificateRejected: false }),
      12000,
    )
    const finish = (result) => {
      clearTimeout(deadline)
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(12000, () =>
      finish({ accepted: false, certificateRejected: false }),
    )
    socket.once("secureConnect", () =>
      finish({ accepted: socket.authorized, certificateRejected: false }),
    )
    socket.once("error", (error) =>
      finish({
        accepted: false,
        certificateRejected: error.code === "CERT_REVOKED",
      }),
    )
  })
}
async function opensslTransport(host, options) {
  try {
    const result = await new Promise((resolve, reject) => {
      const child = execFile(
        "openssl",
        [
          "s_client",
          "-connect",
          `${host}:443`,
          "-servername",
          host,
          "-verify_hostname",
          host,
          "-verify_return_error",
          ...options,
        ],
        { timeout: 12000, maxBuffer: 128 * 1024 },
        (error, stdout, stderr) => {
          if (error) reject(Object.assign(error, { stdout, stderr }))
          else resolve({ stdout, stderr })
        },
      )
      child.stdin.end()
    })
    return {
      accepted: /Verification: OK|Verify return code: 0 \(ok\)/.test(
        result.stdout + result.stderr,
      ),
      certificateRejected: false,
    }
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`
    return {
      accepted: false,
      certificateRejected:
        !error.killed &&
        typeof error.code === "number" &&
        /verify error:num=(?:18|19|20|21|23):/.test(output),
    }
  }
}
export async function attestRuntime(env = process.env) {
  verifyRuntime(process.version)
  requireCheck(
    env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
    "tls_verification_disabled",
  )
  requireCheck(
    !/--(?:security-revert|openssl-config|tls-cipher-list)(?:=|\s)/.test(
      env.NODE_OPTIONS ?? "",
    ),
    "unsupported_security_override",
  )
  const targets = [
    ...rejectedHosts.map((host) => [host, false]),
    ["www.google.com", true],
  ]
  const controls = await Promise.all(
    ["node", ...Object.keys(stores)].flatMap((store) =>
      targets.map(async ([host, accept]) => {
        const result =
          store === "node"
            ? await nodeTransport(host)
            : await opensslTransport(host, stores[store])
        return verifyTrustResult(store, host, accept, result)
      }),
    ),
  )
  const packageQuery = await execute(
    "dpkg-query",
    ["-W", "-f=${binary:Package} ${Version}\n", "libbrotli*"],
    { timeout: 5000, maxBuffer: 16384 },
  ).catch((error) => {
    requireCheck(
      error.code === 1 && !error.stdout,
      "system_brotli_inventory_failed",
    )
    return { stdout: "" }
  })
  // This image has no independent system decoder. New copies need their own reviewed package check.
  requireCheck(
    !packageQuery.stdout.trim(),
    "unexpected_system_brotli_requires_review",
  )
  return {
    event: "mastra_runtime_security",
    schema: 1,
    status: "pass",
    at: new Date().toISOString(),
    ...deploymentIdentity(env),
    pid: process.pid,
    node: process.version,
    brotli: process.versions.brotli,
    brotliFixMarker: constants.BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH,
    executableSha256: createHash("sha256")
      .update(readFileSync("/proc/self/exe"))
      .digest("hex"),
    systemBrotli: "not_installed",
    controls,
  }
}
