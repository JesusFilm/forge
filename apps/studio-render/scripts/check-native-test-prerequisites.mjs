import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

export class NativeTestPrerequisiteError extends Error {}

/** Test-host admission only; never substitutes for runtime containment checks. */
export function checkNativeTestPrerequisites(run = spawnSync) {
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
      "--cap-drop",
      "ALL",
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
      "--",
      "/usr/bin/python3",
      "-c",
      "import os; assert os.getpid() == 1",
    ],
    options,
  )
  if (probe.error || probe.status !== 0)
    throw new NativeTestPrerequisiteError(
      `Studio native test namespace preflight failed: ${probe.error?.code ?? probe.stderr}. User/PID/mount/network namespaces and Python3 are required; do not skip tests or disable host security policy.`,
    )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  checkNativeTestPrerequisites()
