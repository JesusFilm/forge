#!/usr/bin/env tsx
/** Synthesize the same short line with several candidate voices, for auditioning. */
import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname)
const MASTRA_DIR = path.resolve(SCRIPT_DIR, "../..")
const REPO_ROOT = path.resolve(MASTRA_DIR, "../..")

function loadEnvFile(filePath: string): void {
  let raw: string
  try {
    raw = readFileSync(filePath, "utf8")
  } catch {
    return
  }
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1)
    if (k && process.env[k] === undefined) process.env[k] = v
  }
}
loadEnvFile(path.join(MASTRA_DIR, ".env.local"))
loadEnvFile(path.join(REPO_ROOT, ".env.local"))

const TEXT =
  "When everything shakes, where do you run? [[break:500]] God is our refuge and strength, a very present help in trouble. [[break:400]] Take refuge in Him."

// Natural male candidates — warm, calm, human. The "plastic" feel came mostly
// from heavy pitch-shifting, so these lean on the newer *multilingual* voices
// (much less synthetic) with only a light pitch drop + a slower, settled pace.
const CANDIDATES: Array<[string, string, string, string, string?]> = [
  ["nat-01-andrew", "en-US-AndrewMultilingualNeural", "-3%", "-6%"],
  ["nat-02-adam", "en-US-AdamMultilingualNeural", "-3%", "-6%"],
  ["nat-03-brian", "en-US-BrianMultilingualNeural", "-4%", "-6%"],
  ["nat-04-christopher-natural", "en-US-ChristopherNeural", "0%", "-6%"],
  ["nat-05-steffan", "en-US-SteffanNeural", "-3%", "-7%"],
  ["nat-06-ryan-uk", "en-GB-RyanNeural", "-2%", "-7%"],
]

async function main() {
  const { generateVoiceover } = await import("../services/devotional/voiceover")
  const outDir = path.join(REPO_ROOT, "devo/artifacts/voice-samples")
  await mkdir(outDir, { recursive: true })
  for (const [name, voice, pitch, rate, style] of CANDIDATES) {
    const res = await generateVoiceover({
      text: TEXT,
      voice,
      pitch,
      rate,
      style,
    })
    if (!res.ok) {
      console.warn(`  ! ${name} (${voice}) failed: ${res.reason}`)
      continue
    }
    await writeFile(path.join(outDir, `${name}.mp3`), res.audio.bytes)
    console.log(
      `  ✓ ${name}  (${voice} pitch ${pitch} rate ${rate}${style ? " style " + style : ""})`,
    )
  }
  console.log(`\n${outDir}`)
}

main().catch((e) => {
  console.error("samples failed:", e)
  process.exitCode = 1
})
