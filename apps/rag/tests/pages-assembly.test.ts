import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { rm } from "node:fs/promises"
import { assemblePages } from "../scripts/assemble-pages.js"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function fixture(manifest: string): Promise<{
  root: string
  manifestPath: string
  outputPath: string
}> {
  const root = await mkdtemp(path.join(tmpdir(), "forge-pages-"))
  temporaryRoots.push(root)
  await mkdir(path.join(root, "root-site"))
  await mkdir(path.join(root, "rag-site"))
  await writeFile(path.join(root, "root-site/index.html"), "root\n")
  await writeFile(path.join(root, "rag-site/index.html"), "rag\n")
  const manifestPath = path.join(root, "manifest.yaml")
  await writeFile(manifestPath, manifest)
  return { root, manifestPath, outputPath: path.join(root, "assembled") }
}

const validManifest = `version: 1
producers:
  - name: forge-root
    source: root-site
    target: /
    files: [index.html]
  - name: rag-status
    source: rag-site
    target: /rag-status
    files: [index.html]
`

describe("Pages assembly", () => {
  it("assembles the exact declared root and RAG artifacts deterministically", async () => {
    const first = await fixture(validManifest)
    const firstResult = await assemblePages({
      repoRoot: first.root,
      manifestPath: first.manifestPath,
      outputPath: first.outputPath,
    })
    expect(firstResult.files).toEqual(["index.html", "rag-status/index.html"])
    expect(
      await readFile(path.join(first.outputPath, "index.html"), "utf8"),
    ).toBe("root\n")
    expect(
      await readFile(
        path.join(first.outputPath, "rag-status/index.html"),
        "utf8",
      ),
    ).toBe("rag\n")

    const second = await fixture(validManifest)
    const secondResult = await assemblePages({
      repoRoot: second.root,
      manifestPath: second.manifestPath,
      outputPath: second.outputPath,
    })
    expect(secondResult.digest).toBe(firstResult.digest)
  })

  it("rejects undeclared files and missing declared artifacts", async () => {
    const extra = await fixture(validManifest)
    await writeFile(path.join(extra.root, "rag-site/private.json"), "secret")
    await expect(
      assemblePages({
        repoRoot: extra.root,
        manifestPath: extra.manifestPath,
        outputPath: extra.outputPath,
      }),
    ).rejects.toThrow("file set differs")

    const missing = await fixture(
      validManifest.replace("[index.html]", "[missing.html]"),
    )
    await expect(
      assemblePages({
        repoRoot: missing.root,
        manifestPath: missing.manifestPath,
        outputPath: missing.outputPath,
      }),
    ).rejects.toThrow("file set differs")
  })

  it("rejects traversal and symlink entries", async () => {
    const traversal = await fixture(
      validManifest.replace("source: rag-site", "source: ../rag-site"),
    )
    await expect(
      assemblePages({
        repoRoot: traversal.root,
        manifestPath: traversal.manifestPath,
        outputPath: traversal.outputPath,
      }),
    ).rejects.toThrow("not a safe repository-relative path")

    const linked = await fixture(
      validManifest.replace(
        "files: [index.html]",
        "files: [index.html, linked.html]",
      ),
    )
    await symlink(
      path.join(linked.root, "root-site/index.html"),
      path.join(linked.root, "root-site/linked.html"),
    )
    await expect(
      assemblePages({
        repoRoot: linked.root,
        manifestPath: linked.manifestPath,
        outputPath: linked.outputPath,
      }),
    ).rejects.toThrow("symbolic links are not publishable")
  })

  it("rejects producer collisions", async () => {
    const collision = await fixture(
      validManifest.replace("target: /rag-status", "target: /"),
    )
    await expect(
      assemblePages({
        repoRoot: collision.root,
        manifestPath: collision.manifestPath,
        outputPath: collision.outputPath,
      }),
    ).rejects.toThrow("Pages path collision")
  })

  it("assembles only the exact artifacts declared by the repository manifest", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../..")
    const outputParent = await mkdtemp(path.join(tmpdir(), "forge-pages-real-"))
    temporaryRoots.push(outputParent)
    const outputPath = path.join(outputParent, "site")
    const result = await assemblePages({
      repoRoot,
      manifestPath: path.join(repoRoot, "docs/pages/manifest.yaml"),
      outputPath,
    })
    expect(result.files).toEqual([
      "index.html",
      "rag-status/.dashboard-commit.json",
      "rag-status/index.html",
    ])
    expect(await readFile(path.join(outputPath, "index.html"))).toEqual(
      await readFile(path.join(repoRoot, "docs/pages/site/index.html")),
    )
    expect(
      await readFile(path.join(outputPath, "rag-status/index.html")),
    ).toEqual(
      await readFile(
        path.join(repoRoot, "apps/rag/dashboard/site/rag-status/index.html"),
      ),
    )
  })

  it("keeps the workflow path-scoped, pinned, and least privileged", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../..")
    const workflow = await readFile(
      path.join(repoRoot, ".github/workflows/rag-pages.yml"),
      "utf8",
    )
    expect(workflow).toContain("group: forge-pages")
    expect(workflow).toContain("github.ref == 'refs/heads/main'")
    expect(workflow).toContain("pages: write")
    expect(workflow).toContain("id-token: write")
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d/)
    expect(workflow).not.toContain("secrets.")
    for (const requiredPath of [
      "apps/rag/dashboard/compiled-data.json",
      "apps/rag/dashboard/template.html",
      "apps/rag/scripts/dashboard-verify.ts",
      "apps/rag/scripts/lib/dashboard/**",
    ]) {
      expect(workflow.split(requiredPath)).toHaveLength(3)
    }
    const deployJob = workflow.slice(workflow.indexOf("  deploy:"))
    expect(deployJob).not.toContain("pnpm install")
    expect(deployJob).not.toContain("dashboard:data")
    expect(deployJob).not.toContain("DATABASE_URL")
  })
})
