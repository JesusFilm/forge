import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import YAML from "yaml"
import { describe, expect, it } from "vitest"

const REPO = path.resolve(import.meta.dirname, "../../..")
const PLUGIN = path.join(REPO, "plugins/jfp-rag")
const SKILLS = ["golden", "slice", "status-dashboard"] as const

function read(relative: string): string {
  return readFileSync(path.join(REPO, relative), "utf8")
}

describe("jfp-rag plugin packaging", () => {
  it("has matching valid provider manifests and exactly three skills", () => {
    const codex = JSON.parse(read("plugins/jfp-rag/.codex-plugin/plugin.json"))
    const claude = JSON.parse(
      read("plugins/jfp-rag/.claude-plugin/plugin.json"),
    )
    expect(codex.name).toBe("jfp-rag")
    expect(claude.name).toBe(codex.name)
    expect(claude.version).toBe(codex.version)
    expect(codex.skills).toBe("./skills/")
    expect(readdirSync(path.join(PLUGIN, "skills")).sort()).toEqual([...SKILLS])
  })

  for (const skill of SKILLS) {
    it(`${skill} is explicit, provider-neutral, and Forge-local`, () => {
      const body = read(`plugins/jfp-rag/skills/${skill}/SKILL.md`)
      const frontmatter = body.match(/^---\n([\s\S]*?)\n---/)?.[1]
      const metadata = YAML.parse(frontmatter ?? "")
      const openai = YAML.parse(
        read(`plugins/jfp-rag/skills/${skill}/agents/openai.yaml`),
      )
      expect(metadata.name).toBe(skill)
      expect(openai.policy.allow_implicit_invocation).toBe(false)
      expect(body).toContain("pnpm --filter @forge/rag")
      expect(body).toContain("fresh")
      expect(body).toMatch(
        /exactly one\s+named\s+operation against one named target/,
      )
      expect(body).toMatch(/does not|never/i)
      expect(body).not.toContain("jesusfilm-rag/")
      expect(body).not.toMatch(/git (checkout|switch|commit|push)/)
      expect(body).not.toMatch(/gh (issue|pr)/)
      expect(body).not.toMatch(/railway up/)
    })
  }

  it("pins slice state and sanctioned lifecycle commands", () => {
    const body = read("plugins/jfp-rag/skills/slice/SKILL.md")
    expect(body).toContain("apps/rag/docs/slices/<key>.md")
    expect(body).toContain("status:set")
    expect(body).toContain("status:remove-source -- --key <key>")
    expect(body).toMatch(
      /fresh approval naming operation `status:remove-source` and exact\s+target `<key>`/,
    )
    expect(body).toContain("Never edit")
  })

  it("pins golden modes, fan-out ceiling, and write approval", () => {
    const body = read("plugins/jfp-rag/skills/golden/SKILL.md")
    expect(body).toContain("bootstrap mode")
    expect(body).toContain("re-review mode")
    expect(body).toContain("candidate documents × 3")
    expect(body).toContain("above 1,000")
    expect(body).toContain("apps/rag/eval/qa-golden.yaml")
  })

  it("pins the fail-closed dashboard sequence and external acceptance", () => {
    const body = read("plugins/jfp-rag/skills/status-dashboard/SKILL.md")
    const sequence = [
      "dashboard:data",
      "dashboard:snapshot:validate",
      "dashboard:build",
      "dashboard:verify",
      "pages:assemble",
    ]
    let position = -1
    for (const command of sequence) {
      const next = body.indexOf(command)
      expect(next).toBeGreaterThan(position)
      position = next
    }
    expect(body).toContain("doppler run --project forge-rag --config prd --")
    expect(body).toContain("separate external authorities")
  })
})
