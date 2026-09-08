import { spawnSync } from "node:child_process"
import { readlinkSync, accessSync, constants, statSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"

export class NativeTestPrerequisiteError extends Error {}

/** Test-host admission only; never substitutes for runtime containment checks. */
function denied(message) {
  throw new NativeTestPrerequisiteError(message)
}

function childProfile(label) {
  return (
    typeof label === "string" &&
    label.endsWith(" (enforce)") &&
    JSON.stringify(label.slice(0, -10).split("//&").sort()) ===
      JSON.stringify(["forge_studio_ci_bwrap", "forge_studio_ci_child"])
  )
}

export function validateNativeProbe(
  report,
  parentNet,
  requireCiProfile,
  capabilityProbe = false,
) {
  const samples = capabilityProbe
    ? [report]
    : [report, ...(report.alternates ?? [])]
  if (requireCiProfile && samples.some((sample) => !childProfile(sample.label)))
    denied("Expected enforced CI denying child profile on every payload exec")
  if (
    report.pid !== 1 ||
    report.net === parentNet ||
    !/^net:\[\d+\]$/.test(report.net) ||
    samples.some(
      (sample) =>
        sample.net !== report.net ||
        JSON.stringify(sample.interfaces) !== '["lo"]',
    )
  )
    denied("Expected private PID1 and loopback-only network namespace")
  if (capabilityProbe) {
    if (
      (BigInt(`0x${report.effective}`) & (1n << 21n)) === 0n ||
      report.mountErrno !== 1
    )
      denied(
        "Expected child profile to deny a private mount despite requested setup capability",
      )
  } else if (
    samples.length !== 3 ||
    report.escape !== 1 ||
    samples.some(
      (sample) =>
        ![sample.effective, sample.permitted, sample.ambient].every((value) =>
          /^0+$/.test(value),
        ),
    )
  )
    denied(
      "Expected zero payload capabilities, two alternate execs and denied namespace escape",
    )
}

function verifyInstalledBinary() {
  if (process.getuid() === 0)
    denied("CI security tests must run as the ordinary runner user")
  for (const path of ["/", "/usr", "/usr/bin", "/usr/bin/bwrap"]) {
    const stat = statSync(path)
    if (stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o6022) !== 0)
      denied(`CI prerequisite must be root-owned and not writable: ${path}`)
    let writable = true
    try {
      accessSync(path, constants.W_OK)
    } catch (error) {
      if (error.code !== "EACCES") throw error
      writable = false
    }
    if (writable) denied(`Runner can replace CI prerequisite: ${path}`)
  }
}

export function checkNativeTestPrerequisites(
  run = spawnSync,
  requireCiProfile = process.env.GITHUB_ACTIONS === "true",
) {
  const options = { encoding: "utf8", timeout: 5000, maxBuffer: 16384 }
  const version = run("/usr/bin/bwrap", ["--version"], options)
  if (
    version.error ||
    version.status !== 0 ||
    version.stdout.trim() !== "bubblewrap 0.11.1"
  )
    throw new NativeTestPrerequisiteError(
      `/usr/bin/bwrap 0.11.1 required: ${version.error?.code || version.stderr || version.stdout}. Run apps/studio-render/scripts/install-native-test-prerequisites.sh on the disposable CI host.`,
    )
  if (requireCiProfile) verifyInstalledBinary()
  const parentNet = readlinkSync("/proc/self/ns/net")
  for (const mode of requireCiProfile
    ? ["normal", "capability-denial"]
    : ["normal"]) {
    const probe = run(
      "/usr/bin/bwrap",
      [
        "--unshare-all",
        "--unshare-user",
        "--disable-userns",
        "--assert-userns-disabled",
        "--as-pid-1",
        "--die-with-parent",
        "--clearenv",
        "--uid",
        mode === "normal" ? "1000" : "0",
        "--gid",
        mode === "normal" ? "1000" : "0",
        "--cap-drop",
        "ALL",
        ...(mode === "capability-denial" ? ["--cap-add", "CAP_SYS_ADMIN"] : []),
        "--ro-bind",
        "/usr",
        "/usr",
        "--ro-bind",
        "/lib",
        "/lib",
        "--ro-bind",
        "/lib64",
        "/lib64",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--dir",
        "/probe",
        "--ro-bind",
        fileURLToPath(new URL("./native-test-probe.py", import.meta.url)),
        "/runtime/probe.py",
        "--",
        "/usr/bin/python3",
        "/runtime/probe.py",
        mode,
      ],
      options,
    )
    if (probe.error || probe.status !== 0)
      denied(
        `Studio native test namespace preflight failed: ${probe.error?.code ?? probe.stderr}. User/PID/mount/network namespaces and Python3 are required; do not skip tests or disable host security policy.`,
      )
    console.log(`Studio native ${mode} qualification: ${probe.stdout.trim()}`)
    validateNativeProbe(
      JSON.parse(probe.stdout),
      parentNet,
      requireCiProfile,
      mode === "capability-denial",
    )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  checkNativeTestPrerequisites()
