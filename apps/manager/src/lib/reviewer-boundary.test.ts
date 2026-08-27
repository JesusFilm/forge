import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const managerSourceRoot = resolve(import.meta.dirname, "..")

const representativeOperatorRoutes = [
  "app/api/jobs/route.ts",
  "app/api/coverage-snapshots/route.ts",
  "app/api/smart-crop/jobs/[id]/approve/route.ts",
  "app/api/shorts/jobs/route.ts",
  "app/api/automations/route.ts",
] as const

describe("reviewer authorization boundary", () => {
  it.each(representativeOperatorRoutes)(
    "keeps %s on an operator-only guard",
    async (relativePath) => {
      const source = await readFile(
        resolve(managerSourceRoot, relativePath),
        "utf8",
      )

      expect(source).toMatch(
        /authenticate(?:Request|InteractiveManagerRequest|ManagerOverrideRequest)/,
      )
      expect(source).not.toContain("authenticateInteractiveReviewerRequest")
    },
  )

  it("keeps the complete dashboard tree behind requireAuth", async () => {
    const source = await readFile(
      resolve(managerSourceRoot, "app/dashboard/layout.tsx"),
      "utf8",
    )

    expect(source).toContain('import { requireAuth } from "@/lib/require-auth"')
    expect(source).toContain("await requireAuth()")
    expect(source).not.toContain("requireReviewerAuth")
  })

  it("keeps SEO decisions behind their operator-only guard", async () => {
    const [decisionSource, guardSource] = await Promise.all([
      readFile(
        resolve(managerSourceRoot, "lib/seo-proposal-decision-route.ts"),
        "utf8",
      ),
      readFile(resolve(managerSourceRoot, "lib/seo-route-guard.ts"), "utf8"),
    ])

    expect(decisionSource).toContain("guardSeoInteractiveMutation(request)")
    expect(guardSource).toContain("authenticateInteractiveManagerRequest")
    expect(guardSource).not.toContain("authenticateInteractiveReviewerRequest")
  })
})
