import { readFile, mkdir, open } from "node:fs/promises"
import { spawn } from "node:child_process"
import { resolve } from "node:path"

const [output, promptFile, label, sessionId] = process.argv.slice(2)
if (
  !output?.startsWith("/") ||
  !promptFile ||
  !/^[a-z0-9-]+$/.test(label ?? "")
)
  throw new Error(
    "Usage: run-codex.mjs <private-output-directory> <prompt-file> <run-label> [session-id]",
  )
const token = (await readFile(resolve(output, "token"), "utf8")).trim()
const config = JSON.parse(
  await readFile(resolve(output, "environment.json"), "utf8"),
)
const full =
  config.DATABASE_URL ===
    "postgresql://tataihono@127.0.0.1:55460/forge_studio_548_qualification" &&
  config.STUDIO_MCP_AUDIENCE === "http://127.0.0.1:55483/mcp"
if (!full && config.STUDIO_MCP_AUDIENCE !== "http://127.0.0.1:55471/mcp")
  throw new Error("Unknown local qualification endpoint")
const prompt = await readFile(promptFile, "utf8")
const workspace = resolve(output, "client-workspace")
await mkdir(workspace, { recursive: true })
const args = [
  "exec",
  "--ignore-user-config",
  "--ignore-rules",
  "--skip-git-repo-check",
  "--sandbox",
  "read-only",
  "--json",
  "-C",
  workspace,
  "-c",
  `mcp_servers.shorts.url=${JSON.stringify(config.STUDIO_MCP_AUDIENCE)}`,
  "-c",
  'mcp_servers.shorts.bearer_token_env_var="SHORTS_QUALIFICATION_TOKEN"',
  "-c",
  "mcp_servers.shorts.required=true",
  ...(full
    ? []
    : [
        "-c",
        'mcp_servers.shorts.enabled_tools=["shorts.projects","shorts.resolveProject","shorts.read","shorts.create","shorts.apply","shorts.history"]',
      ]),
  // The operator explicitly authorized these local-only editing proof operations.
  "-c",
  'mcp_servers.shorts.default_tools_approval_mode="approve"',
  ...(sessionId ? ["resume", sessionId] : []),
  prompt,
]
const stdout = await open(
  resolve(output, `${label}-transcript.jsonl`),
  "w",
  0o600,
)
const stderr = await open(resolve(output, `${label}-stderr.log`), "w", 0o600)
const child = spawn("codex", args, {
  env: { ...process.env, SHORTS_QUALIFICATION_TOKEN: token },
  stdio: ["ignore", stdout.fd, stderr.fd],
})
child.on("exit", async (code) => {
  await stdout.close()
  await stderr.close()
  console.log(
    `Codex exited ${code}; inspect ${label}-transcript.jsonl for tool outcomes (exit zero alone is not success).`,
  )
  process.exitCode = code ?? 1
})
