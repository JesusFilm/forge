import { z } from "zod"
import { studioRegisterAssetSchema } from "./assets"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { validateStudioRoleCoverage } from "./production"
import { studioDocumentSchema } from "./index"
const document = studioDocumentSchema.parse({
  version: 1,
  title: "A user-authored visual project",
  language: "en",
  runtimeVersion: "studio-proof-1",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 90,
  tracks: [{ id: "main", kind: "visual" }],
  components: [],
  packRevisionIds: [],
  items: [
    {
      id: "card",
      kind: "text",
      trackId: "main",
      startFrame: 0,
      durationInFrames: 90,
      text: "A conclusion is not a spoken settle identity",
      properties: {},
    },
  ],
})
describe("Admitted role coverage", () => {
  it("does not mistake positive historic model QA for explicit timeline roles", () => {
    for (const index of [2, 4]) {
      const response = JSON.parse(
        readFileSync(
          new URL(
            `../../../docs/validation/studio-458/llm-provider-evidence/${index}-response.body`,
            import.meta.url,
          ),
          "utf8",
        ),
      )
      const qa = JSON.parse(response.choices[0].message.content)
      expect(
        qa.findings.bridge?.status ?? qa.findings.bridgeCoverage?.status,
      ).toBe("pass")
      expect(() =>
        validateStudioRoleCoverage(document, [
          { role: "bridge", status: "present", itemIds: [] },
          { role: "settle", status: "present", itemIds: [] },
        ]),
      ).toThrow()
    }
  })
  it("accepts content-agnostic arrangements with no devotional role requirements", () => {
    expect(validateStudioRoleCoverage(document, [])).toEqual([])
    expect(
      validateStudioRoleCoverage(document, [
        { role: "settle", status: "absent", itemIds: [] },
      ]),
    ).toEqual([{ role: "settle", status: "absent", itemIds: [] }])
  })
})

it("keeps all 87 recovered narration files outside exact provider cache identity", () => {
  const inventory = JSON.parse(
    readFileSync(
      new URL(
        "../../../docs/plans/fixtures/studio-lyuba-baseline/inventory.json",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  const files = z
    .array(
      z.object({
        path: z.string(),
        role: z.string(),
        sha256: z.string(),
        provenance: z.record(z.string(), z.unknown()),
      }),
    )
    .parse(inventory.files)
    .filter((file) => file.role === "narration")
  expect(files).toHaveLength(87)
  for (const file of files) {
    const metadata = studioRegisterAssetSchema.parse({
      idempotencyKey: file.sha256,
      filename: file.path.split("/").at(-1),
      mimeType: "audio/mpeg",
      role: "narration",
      provenance: {
        status: "unknown",
        recorded: { archivePath: file.path, sha256: file.sha256 },
      },
    })
    expect(metadata.narration).toBeUndefined()
    expect(
      studioRegisterAssetSchema.safeParse({
        ...metadata,
        provenance: { ...metadata.provenance, status: "recorded" },
      }).success,
    ).toBe(false)
  }
})

it("reports the actual role facts behind the preserved ch31 native rejection", () => {
  const proposal = JSON.parse(
    readFileSync(
      new URL(
        "../../../docs/validation/studio-458/native-hosted-live/paid-1-2-response-proposal-0.json",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  const admission = JSON.parse(
    readFileSync(
      new URL(
        "../../../docs/validation/studio-458/native-hosted-proposal/corrected-readonly-proposal.body",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  const admitted = studioDocumentSchema.parse(
    admission.cases[1].project.document,
  )
  // The rejected proposal only changes text/metadata, so its explicit speech roles are unchanged.
  let rejected: unknown
  try {
    validateStudioRoleCoverage(admitted, proposal.quality.coverage)
  } catch (error) {
    rejected = error
  }
  expect(rejected).toMatchObject({
    feedback: {
      code: "ROLE_COVERAGE_MISMATCH",
      role: "hook",
      expectedItemCount: 0,
      expectedItemIds: [],
      expectedItemIdsComplete: true,
      observedRoles: ["bridge", "reflection", "settle"],
      observedRolesComplete: true,
    },
  })
  expect(() =>
    validateStudioRoleCoverage(
      admitted,
      proposal.quality.coverage.filter((claim: { role: string }) =>
        ["reflection", "bridge", "settle"].includes(claim.role),
      ),
    ),
  ).not.toThrow()
})

it("bounds role feedback and reports omitted identities explicitly", () => {
  const admission = JSON.parse(
    readFileSync(
      new URL(
        "../../../docs/validation/studio-458/native-hosted-proposal/corrected-readonly-proposal.body",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  const original = studioDocumentSchema.parse(
    admission.cases[1].project.document,
  )
  const item = original.items[0]
  const many = studioDocumentSchema.parse({
    ...original,
    items: Array.from({ length: 20 }, (_, index) => ({
      ...item,
      id: `item-${index}`,
    })),
  })
  try {
    validateStudioRoleCoverage(many, [
      { role: "reflection", status: "absent", itemIds: [] },
    ])
    expect.unreachable("Expected false coverage to be rejected")
  } catch (error) {
    expect(error).toMatchObject({
      feedback: {
        expectedItemCount: 20,
        expectedItemIdsComplete: false,
        observedRolesComplete: true,
      },
    })
    const feedback = z
      .object({
        feedback: z
          .object({ expectedItemIds: z.array(z.string()) })
          .passthrough(),
      })
      .parse(error).feedback
    expect(feedback.expectedItemIds).toHaveLength(8)
    expect(Buffer.byteLength(JSON.stringify(feedback))).toBeLessThan(4096)
  }
})
