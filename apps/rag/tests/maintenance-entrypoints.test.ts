import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

describe.each(["acquire", "index"])("%s entrypoint", (command) => {
  it.each([
    ["not-a-source", "/islenska/", "unknown source"],
    ["gotquestions", "/unregistered/", "unregistered path scope"],
  ])(
    "rejects invalid production scope before requiring credentials: %s %s",
    (source, prefix, message) => {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(new URL(`../scripts/${command}.ts`, import.meta.url)),
          "--production",
          "--source",
          source,
          "--path-prefix",
          prefix,
        ],
        {
          cwd: fileURLToPath(new URL("..", import.meta.url)),
          env: { PATH: process.env.PATH, NODE_ENV: "test" },
          encoding: "utf8",
          timeout: 10_000,
        },
      )
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(message)
    },
  )
  it.each([false, true])("parses arguments with separator=%s", (separator) => {
    const script = fileURLToPath(
      new URL(`../scripts/${command}.ts`, import.meta.url),
    )
    // Unknown sources fail before wiring, so this exercises real CLI parsing
    // without loading credentials or contacting the database or providers.
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        script,
        ...(separator ? ["--"] : []),
        "--source",
        "not-a-source",
        "--path-prefix",
        "/islenska/",
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: { PATH: process.env.PATH, NODE_ENV: "test" },
        encoding: "utf8",
        timeout: 10_000,
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `${command} failed: unknown source 'not-a-source'`,
    )
  })
})
