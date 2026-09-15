import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

test("native browser launch preserves Remotion arguments and bounds image parking", () => {
  const directory = mkdtempSync(join(tmpdir(), "studio-chrome-launcher-"))
  try {
    // Observe the actual exec boundary without requiring Chromium in unit CI.
    const probe = join(directory, "exec-probe.c")
    writeFileSync(
      probe,
      `#include <stdio.h>
#include <stdlib.h>
int __wrap_execv(const char *file, char *const args[]) {
  puts(file);
  for (int i = 0; args[i]; i++) puts(args[i]);
  exit(0);
}
`,
    )
    const executable = join(directory, "launcher")
    const build = spawnSync(
      "cc",
      [
        "-Wall",
        "-Wextra",
        "-Werror",
        resolve("apps/studio-render/native/chrome-launcher.c"),
        probe,
        "-Wl,--wrap=execv",
        "-o",
        executable,
      ],
      { encoding: "utf8" },
    )
    assert.equal(build.status, 0, build.stderr)
    const browser = "/browser/chrome-headless-shell"
    const feature = "CompressParkableStrings:max_disk_capacity_mb/64"
    for (const existing of [
      undefined,
      "",
      "NetworkService,CanvasDrawElement",
    ]) {
      const args = ["about:blank", "--disable-features=Translate"]
      if (existing !== undefined) args.push(`--enable-features=${existing}`)
      const result = spawnSync(executable, args, { encoding: "utf8" })
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(result.stdout.trim().split("\n"), [
        browser,
        browser,
        "about:blank",
        "--disable-features=Translate",
        `--enable-features=${existing ? `${existing},` : ""}${feature}`,
      ])
    }
    for (const args of [
      ["--enable-features=A", "--enable-features=B"],
      ["--enable-features=CompressParkableStrings:max_disk_capacity_mb/256"],
    ]) {
      const result = spawnSync(executable, args, { encoding: "utf8" })
      assert.equal(result.status, 126)
      assert.equal(result.stdout, "")
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
