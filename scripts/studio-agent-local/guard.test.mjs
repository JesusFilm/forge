import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mkdtemp,
  writeFile,
  rm,
  readFile,
  symlink,
  stat,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
test("full launcher rejects existing output and outside symlinks to checkout without changing modes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-output-guard-"))
  const root = new URL("../../", import.meta.url).pathname
  const before = (await stat(root)).mode
  try {
    await symlink(root, join(directory, "checkout"))
    for (const output of [
      directory,
      join(directory, "checkout"),
      join(directory, "checkout", "forbidden-output"),
    ]) {
      const result = spawnSync(
        process.execPath,
        [new URL("./full.mjs", import.meta.url).pathname, output],
        { env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 10000 },
      )
      assert.notEqual(result.status, 0)
    }
    assert.equal((await stat(root)).mode, before)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
test("preload blocks fetch and raw sockets before child code, allowing only exact fixture responses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-guard-"))
  try {
    await writeFile(join(dir, "audio"), "fixture-bytes")
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify({
        audit: join(dir, "audit"),
        responses: [
          {
            name: "fake",
            url: "https://api.elevenlabs.io/exact",
            method: "POST",
            file: join(dir, "audio"),
            headers: {},
          },
        ],
      }),
    )
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict'; import net from 'node:net';
      await assert.rejects(fetch('https://api.elevenlabs.io/unregistered'));
      assert.throws(() => net.connect({host:'203.0.113.1',port:443}), /forbids/);
      assert.throws(() => net.connect('/tmp/unapproved.sock'), /forbids/);
      assert.equal(await (await fetch('https://api.elevenlabs.io/exact',{method:'POST',body:'fixture-request'})).text(),'fixture-bytes');
    `,
      ],
      {
        env: {
          PATH: process.env.PATH,
          NODE_OPTIONS: `--import=${new URL("./guard.mjs", import.meta.url).pathname}`,
          STUDIO_QUALIFICATION_MANIFEST: join(dir, "manifest.json"),
        },
        encoding: "utf8",
        timeout: 10000,
      },
    )
    assert.equal(child.status, 0, child.stderr)
    assert.equal(
      JSON.parse((await readFile(join(dir, "audit"), "utf8")).trim()).fixture,
      "fake",
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
