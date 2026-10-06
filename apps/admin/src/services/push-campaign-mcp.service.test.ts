// Who may call the push tools, each failure envelope, and the write result
// (KTD11, KTD13). The writes and reads are mocked, so this proves the mapping;
// `src/app/mcp/route.push.db.test.ts` proves the flows against Postgres.
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import type { PrismaClient } from "@prisma/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  sendingEnabled: "true" as string | undefined,
  createPushCampaignContent: vi.fn(),
  writePushCampaignContent: vi.fn(),
  searchPushAgentLanguages: vi.fn(),
  searchPushAgentDestinations: vi.fn(),
  countPushAgentAudience: vi.fn(),
  listPushAgentCampaigns: vi.fn(),
  readPushAgentCampaign: vi.fn(),
  readPushTestRunState: vi.fn(),
  readPushDestinationStates: vi.fn(),
}))

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>()
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get(target, key, receiver) {
        if (key === "PUSH_CAMPAIGNS_ENABLED") return mocks.sendingEnabled
        if (key === "ADMIN_BASE_URL") return "https://admin.example.test"
        return Reflect.get(target, key, receiver)
      },
    }),
  }
})
vi.mock("@/services/push/campaign-content.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/push/campaign-content.service")
  >()),
  createPushCampaignContent: mocks.createPushCampaignContent,
  writePushCampaignContent: mocks.writePushCampaignContent,
}))
vi.mock("@/services/push/agent-reads.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/push/agent-reads.service")
  >()),
  searchPushAgentLanguages: mocks.searchPushAgentLanguages,
  searchPushAgentDestinations: mocks.searchPushAgentDestinations,
  countPushAgentAudience: mocks.countPushAgentAudience,
  listPushAgentCampaigns: mocks.listPushAgentCampaigns,
  readPushAgentCampaign: mocks.readPushAgentCampaign,
}))
vi.mock("@/services/push/test-run-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/push/test-run-state")>()),
  readPushTestRunState: mocks.readPushTestRunState,
}))
vi.mock("@/services/push/destinations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/push/destinations")>()),
  readPushDestinationStates: mocks.readPushDestinationStates,
}))

import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError } from "@/services/errors"
import type {
  PushCampaignContentState,
  PushCampaignContentWriteResult,
} from "@/services/push/campaign-content.service"
import { PUSH_MAX_COPY_ROWS_PER_CALL } from "@/services/push/contracts"
import {
  PushFrozenError,
  PushInputError,
  PushNotFoundError,
  PushStaleContentVersionError,
  PushTooManyCopyRowsError,
  PushUnknownDestinationError,
  PushUnknownLanguageError,
} from "@/services/push/errors"

import { PushCampaignMcpService } from "./push-campaign-mcp.service"

const EDITOR: Principal = { id: "editor_1", role: "EDITOR" }
const ADMIN: Principal = { id: "admin_1", role: "ADMIN" }

/** Any read of the client counts, so a refusal can prove it read nothing. */
const touched: PropertyKey[] = []
const prismaStub = new Proxy(
  {},
  {
    get(_target, key) {
      touched.push(key)
      return undefined
    },
  },
) as unknown as PrismaClient

function service() {
  return new PushCampaignMcpService(prismaStub)
}

const ENGLISH = { languageSlug: "english", title: "Hello", body: "Watch now" }
const SPANISH = { languageSlug: "spanish", title: "Hola", body: "Mira ahora" }

type ToolMethod =
  | "searchLanguages"
  | "searchDestinations"
  | "countAudience"
  | "listCampaigns"
  | "readCampaign"
  | "createCampaign"
  | "updateCampaign"

/** One valid call per tool, so a refusal can only come from the caller. */
const VALID_CALLS: ReadonlyArray<[ToolMethod, unknown]> = [
  ["searchLanguages", { q: "span" }],
  ["searchDestinations", { q: "easter" }],
  ["countAudience", { scope: "EVERYWHERE" }],
  ["listCampaigns", {}],
  ["readCampaign", { campaignId: "c1" }],
  ["createCampaign", { copies: [ENGLISH] }],
  [
    "updateCampaign",
    { campaignId: "c1", expectedRevision: 3, copies: [SPANISH] },
  ],
]

function state(
  overrides: Partial<PushCampaignContentState> = {},
): PushCampaignContentState {
  return {
    campaignId: "c1",
    status: "DRAFT",
    contentVersion: 4,
    copies: [ENGLISH, SPANISH],
    destination: { kind: "VIDEO", slug: "film" },
    audience: { scope: "EVERYWHERE", countries: [], languageFilter: [] },
    lastActorId: "editor_1",
    aiMarker: {
      actorId: "editor_1",
      writtenAt: new Date("2026-10-06T08:00:00.000Z"),
    },
    updatedAt: new Date("2026-10-06T08:00:00.000Z"),
    ...overrides,
  }
}

function writeResult(
  overrides: Partial<PushCampaignContentWriteResult> = {},
): PushCampaignContentWriteResult {
  return {
    campaignId: "c1",
    written: true,
    before: state({ status: "TESTED", contentVersion: 3 }),
    after: state(),
    changed: {
      languages: {
        added: [],
        updated: ["spanish"],
        removed: [],
        unchangedCount: 1,
      },
      destination: null,
      audience: null,
    },
    statusChange: { from: "TESTED", to: "DRAFT" },
    destinationPublished: null,
    ...overrides,
  }
}

function codes(result: unknown): string[] {
  return (result as { warnings: Array<{ code: string }> }).warnings.map(
    (warning) => warning.code,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  touched.length = 0
  mocks.sendingEnabled = "true"
  mocks.readPushTestRunState.mockResolvedValue({
    running: false,
    receiptsUntil: null,
  })
  mocks.readPushDestinationStates.mockImplementation(
    async (_prisma: unknown, _kind: string, slugs: readonly string[]) =>
      new Map(slugs.map((slug) => [slug, { published: true, reason: null }])),
  )
  mocks.listPushAgentCampaigns.mockResolvedValue({
    campaigns: [],
    truncated: false,
  })
  vi.spyOn(console, "info").mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("who may call the push tools (R2, R3)", () => {
  const refused: ReadonlyArray<[string, Principal | null]> = [
    ["VIEWER", { id: "viewer_1", role: "VIEWER" }],
    ["PUBLIC", null],
    ["PUBLIC principal", { id: "public_1", role: "PUBLIC" }],
    ["WORKFLOW_TRIGGER", { id: null, role: "WORKFLOW_TRIGGER" }],
  ]

  it.each(refused)(
    "refuses a %s principal on every tool before any database read",
    async (_label, user) => {
      for (const [method, input] of VALID_CALLS) {
        await expect(
          service()[method]({ input, user }),
          method,
        ).rejects.toBeInstanceOf(ForbiddenError)
      }
      expect(touched).toEqual([])
      for (const fn of [
        mocks.createPushCampaignContent,
        mocks.writePushCampaignContent,
        mocks.searchPushAgentLanguages,
        mocks.searchPushAgentDestinations,
        mocks.countPushAgentAudience,
        mocks.listPushAgentCampaigns,
        mocks.readPushAgentCampaign,
      ]) {
        expect(fn).not.toHaveBeenCalled()
      }
    },
  )

  it("refuses a VIEWER through the role check, because the dashboard permission admits a VIEWER", async () => {
    const viewer: Principal = { id: "viewer_1", role: "VIEWER" }
    expect(hasPermission(viewer, "write:push-campaigns")).toBe(true)

    await expect(
      service().listCampaigns({ input: {}, user: viewer }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(mocks.listPushAgentCampaigns).not.toHaveBeenCalled()
  })

  it.each([EDITOR, ADMIN])(
    "lets a $role principal list campaigns",
    async (user) => {
      await expect(
        service().listCampaigns({ input: {}, user }),
      ).resolves.toMatchObject({ ok: true, campaigns: [] })
    },
  )

  it("records the signed-in person as the actor of a write", async () => {
    mocks.createPushCampaignContent.mockResolvedValue(
      writeResult({ before: null, statusChange: null }),
    )

    await service().createCampaign({
      input: { copies: [ENGLISH] },
      user: EDITOR,
    })

    expect(mocks.createPushCampaignContent).toHaveBeenCalledWith(
      prismaStub,
      expect.objectContaining({ actorId: "editor_1" }),
    )
  })
})

describe("input refusals name the field and never the value (R14, R15)", () => {
  it("refuses a title one character over the cap at copies.0.title", async () => {
    const title = "T".repeat(51)

    const result = await service().createCampaign({
      input: { copies: [{ languageSlug: "english", title, body: "Hi" }] },
      user: EDITOR,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_input",
      retryable: false,
      issues: [expect.objectContaining({ path: "copies.0.title" })],
    })
    expect(JSON.stringify(result)).not.toContain(title)
    expect(mocks.createPushCampaignContent).not.toHaveBeenCalled()
  })

  it.each(["sendDate", "localHour"])(
    "refuses %s on a create at its own path",
    async (field) => {
      const result = await service().createCampaign({
        input: { copies: [ENGLISH], [field]: 9 },
        user: EDITOR,
      })

      expect(result).toMatchObject({
        ok: false,
        reason: "invalid_input",
        issues: [expect.objectContaining({ path: field })],
      })
      expect(mocks.createPushCampaignContent).not.toHaveBeenCalled()
    },
  )

  it("refuses a call with one copy row over the per-call cap on copies", async () => {
    const copies = Array.from(
      { length: PUSH_MAX_COPY_ROWS_PER_CALL + 1 },
      (_, index) =>
        index === 0 ? ENGLISH : { ...SPANISH, languageSlug: `lang-${index}` },
    )

    const result = await service().updateCampaign({
      input: { campaignId: "c1", expectedRevision: 1, copies },
      user: EDITOR,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_input",
      issues: [expect.objectContaining({ path: "copies" })],
    })
    expect(mocks.writePushCampaignContent).not.toHaveBeenCalled()
  })

  it("names both a missing revision and a bad patch field in one refusal", async () => {
    const result = await service().updateCampaign({
      input: { campaignId: "c1", removeLanguages: ["english"] },
      user: EDITOR,
    })

    expect(result).toMatchObject({ ok: false, reason: "invalid_input" })
    const { issues } = result as unknown as { issues: Array<{ path: string }> }
    expect(issues.map((issue) => issue.path)).toEqual([
      "expectedRevision",
      "removeLanguages.0",
    ])
    expect(mocks.writePushCampaignContent).not.toHaveBeenCalled()
  })

  it("refuses a language search that names neither a query nor slugs", async () => {
    const result = await service().searchLanguages({ input: {}, user: EDITOR })

    expect(result).toMatchObject({ ok: false, reason: "invalid_input" })
    expect(mocks.searchPushAgentLanguages).not.toHaveBeenCalled()
  })
})

describe("expected failures become envelopes (KTD11)", () => {
  const update = {
    campaignId: "c1",
    expectedRevision: 3,
    copies: [SPANISH],
  }

  it.each(["SCHEDULED", "SENDING", "SENT", "PAUSED", "CANCELLED"] as const)(
    "refuses a %s campaign as not_editable, names the status, and never says cancel (AE5)",
    async (status) => {
      mocks.writePushCampaignContent.mockRejectedValue(
        new PushFrozenError(status),
      )

      const result = await service().updateCampaign({
        input: update,
        user: EDITOR,
      })

      expect(result).toMatchObject({
        ok: false,
        reason: "not_editable",
        retryable: false,
        status,
      })
      const message = (result as { message: string }).message
      expect(message).toContain(status)
      expect(message).toContain("dashboard")
      // The status CANCELLED is named; no other word may say cancel.
      expect(message.replaceAll(status, "")).not.toMatch(/cancel/i)
    },
  )

  it.each([
    [
      new PushStaleContentVersionError({
        currentContentVersion: 7,
        lastActorId: "editor_2",
        updatedAt: new Date("2026-10-06T08:00:00.000Z"),
      }),
      { reason: "stale_revision", currentRevision: 7 },
    ],
    [
      new PushNotFoundError("That campaign does not exist"),
      { reason: "not_found" },
    ],
    [new PushTooManyCopyRowsError(301, 300), { reason: "too_many_rows" }],
    [
      new PushUnknownLanguageError(["klingon"]),
      { reason: "unknown_language", slugs: ["klingon"] },
    ],
    [
      new PushUnknownDestinationError({
        kind: "SERIES",
        slug: "film",
        actualKind: "VIDEO",
      }),
      { reason: "unknown_destination", slug: "film", actualKind: "VIDEO" },
    ],
    [
      new PushInputError("Name at least one country, or choose everywhere", [
        { path: "audience.countries", message: "Name at least one country" },
      ]),
      {
        reason: "invalid_input",
        issues: [
          { path: "audience.countries", message: "Name at least one country" },
        ],
      },
    ],
  ])("maps %s", async (error, expected) => {
    mocks.writePushCampaignContent.mockRejectedValue(error)

    const result = await service().updateCampaign({
      input: update,
      user: EDITOR,
    })

    expect(result).toMatchObject({ ok: false, retryable: false, ...expected })
    expect(typeof (result as { message: string }).message).toBe("string")
  })

  it("maps a campaign that a read cannot find to not_found", async () => {
    mocks.readPushAgentCampaign.mockResolvedValue(null)

    await expect(
      service().readCampaign({ input: { campaignId: "gone" }, user: EDITOR }),
    ).resolves.toMatchObject({ ok: false, reason: "not_found" })
  })

  it("throws an unexpected fault so the route reports a tool failure", async () => {
    mocks.writePushCampaignContent.mockRejectedValue(new Error("db down"))

    await expect(
      service().updateCampaign({ input: update, user: EDITOR }),
    ).rejects.toThrow("db down")
  })
})

describe("the write result (KTD13, KTD20)", () => {
  it("reports what changed, every warning, the steps left, and the marker", async () => {
    mocks.sendingEnabled = "false"
    mocks.writePushCampaignContent.mockResolvedValue(
      writeResult({
        after: state({
          audience: {
            scope: "COUNTRIES",
            countries: ["MX"],
            languageFilter: ["spanish", "french"],
          },
          contentVersion: 4,
          aiMarker: {
            actorId: "editor_1",
            writtenAt: new Date("2026-10-06T09:05:00.000Z"),
          },
        }),
      }),
    )
    mocks.readPushDestinationStates.mockResolvedValue(
      new Map([["film", { published: false, reason: "watch_restricted" }]]),
    )
    mocks.readPushTestRunState.mockResolvedValue({
      running: true,
      receiptsUntil: new Date("2026-10-06T09:15:30.000Z"),
    })

    const result = await service().updateCampaign({
      input: { campaignId: "c1", expectedRevision: 3, copies: [SPANISH] },
      user: EDITOR,
    })

    expect(result).toMatchObject({
      ok: true,
      campaign: { id: "c1", status: "DRAFT", revision: 4 },
      statusChange: { from: "TESTED", to: "DRAFT" },
      editorUrl: "https://admin.example.test/dashboard/push-campaigns/c1",
      changed: {
        languages: {
          added: [],
          updated: ["spanish"],
          removed: [],
          unchangedCount: 1,
        },
        destination: null,
        audience: null,
      },
      languages: ["english", "spanish"],
      aiMarker: { by: "editor_1", at: "2026-10-06T09:05:00.000Z" },
    })
    expect(codes(result).sort()).toEqual(
      [
        "destination_not_published",
        "language_filter_mismatch",
        "language_filter_set",
        "sending_disabled",
        "test_invalidated",
        "test_run_superseded",
      ].sort(),
    )
    const steps = (result as { nextSteps: string[] }).nextSteps.join("\n")
    expect(steps).toContain("about 09:16 UTC")
    expect(steps).toContain(
      "https://admin.example.test/dashboard/push-campaigns/c1",
    )
    expect(steps).toMatch(/schedule/i)
    expect(mocks.writePushCampaignContent).toHaveBeenCalledWith(prismaStub, {
      source: "mcp",
      campaignId: "c1",
      actorId: "editor_1",
      expectedContentVersion: 3,
      patch: { copies: [SPANISH] },
    })
  })

  it("logs one plain-string line per write, with counts and no copy text", async () => {
    mocks.writePushCampaignContent.mockResolvedValue(writeResult())

    await service().updateCampaign({
      input: { campaignId: "c1", expectedRevision: 3, copies: [SPANISH] },
      user: EDITOR,
    })

    expect(console.info).toHaveBeenCalledTimes(1)
    const line = vi.mocked(console.info).mock.calls[0]?.[0] as string
    expect(line).toBe(
      "[push-mcp] event=campaign_written campaign=c1 actor=editor_1 added=0 updated=1 removed=0 status_change=TESTED->DRAFT",
    )
    expect(line).not.toContain(SPANISH.title)
  })

  it("keeps a TESTED campaign TESTED on a no-op, with no test warnings and no log line", async () => {
    const tested = state({ status: "TESTED", contentVersion: 3 })
    mocks.writePushCampaignContent.mockResolvedValue(
      writeResult({
        written: false,
        before: tested,
        after: tested,
        changed: {
          languages: { added: [], updated: [], removed: [], unchangedCount: 2 },
          destination: null,
          audience: null,
        },
        statusChange: null,
      }),
    )
    mocks.readPushTestRunState.mockResolvedValue({
      running: true,
      receiptsUntil: new Date("2026-10-06T09:15:30.000Z"),
    })

    const result = await service().updateCampaign({
      input: { campaignId: "c1", expectedRevision: 1, copies: [SPANISH] },
      user: EDITOR,
    })

    expect(result).toMatchObject({
      ok: true,
      campaign: { status: "TESTED", revision: 3 },
      statusChange: null,
    })
    expect(codes(result)).not.toContain("test_invalidated")
    expect(codes(result)).not.toContain("test_run_superseded")
    const steps = (result as { nextSteps: string[] }).nextSteps.join("\n")
    expect(steps).not.toMatch(/send a test/i)
    expect(console.info).not.toHaveBeenCalled()
  })

  it("asks a person to choose a destination when the draft has none", async () => {
    mocks.createPushCampaignContent.mockResolvedValue(
      writeResult({
        before: null,
        after: state({ destination: null }),
        statusChange: null,
      }),
    )

    const result = await service().createCampaign({
      input: { copies: [ENGLISH] },
      user: EDITOR,
    })

    const steps = (result as { nextSteps: string[] }).nextSteps.join("\n")
    expect(steps).toMatch(/choose a destination/i)
    expect(steps).toMatch(/send a test/i)
    expect(mocks.readPushDestinationStates).not.toHaveBeenCalled()
  })

  it("warns when the stored destination row is gone", async () => {
    mocks.writePushCampaignContent.mockResolvedValue(writeResult())
    mocks.readPushDestinationStates.mockResolvedValue(new Map())

    const result = await service().updateCampaign({
      input: { campaignId: "c1", expectedRevision: 3, copies: [SPANISH] },
      user: EDITOR,
    })

    expect(codes(result)).toContain("destination_missing")
    expect(codes(result)).not.toContain("destination_not_published")
  })
})

describe("the read results", () => {
  it("returns the campaign with its link, its warnings, and the marker", async () => {
    mocks.readPushAgentCampaign.mockResolvedValue({
      campaignId: "c1",
      status: "DRAFT",
      revision: 4,
      editable: true,
      sendingEnabled: true,
      languages: ["english", "spanish"],
      copies: [ENGLISH],
      destination: {
        kind: "VIDEO",
        slug: "film",
        exists: false,
        published: false,
        reason: null,
      },
      audience: { scope: "EVERYWHERE", countries: [], languageFilter: [] },
      test: { running: false, receiptsUntil: null },
      aiMarker: {
        actorId: "editor_1",
        writtenAt: new Date("2026-10-06T08:00:00.000Z"),
      },
      schedule: null,
      createdAt: new Date("2026-10-06T07:00:00.000Z"),
      updatedAt: new Date("2026-10-06T08:00:00.000Z"),
    })

    const result = await service().readCampaign({
      input: { campaignId: "c1", languages: ["english"] },
      user: EDITOR,
    })

    expect(result).toMatchObject({
      ok: true,
      campaignId: "c1",
      revision: 4,
      languages: ["english", "spanish"],
      editorUrl: "https://admin.example.test/dashboard/push-campaigns/c1",
      aiMarker: { by: "editor_1", at: "2026-10-06T08:00:00.000Z" },
    })
    expect(codes(result)).toEqual(["destination_missing"])
    expect(mocks.readPushAgentCampaign).toHaveBeenCalledWith(prismaStub, {
      campaignId: "c1",
      languages: ["english"],
    })
  })
})

describe("the agent path imports nothing that sends (KTD14, R16)", () => {
  const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const AGENT_PATH = [
    "services/push-campaign-mcp.service.ts",
    "services/push/agent-reads.service.ts",
    "services/push/campaign-content.service.ts",
    "services/push/test-run-state.ts",
  ]
  const FORBIDDEN_FILES = [
    "services/push/dispatch.ts",
    "services/push/campaign.service.ts",
  ]
  const FORBIDDEN_NAMES =
    /\b(recordPushTestSend|schedulePushCampaign|confirmPushSendNow|cancelPushCampaign)\b/
  const SPECIFIER =
    /(?:\bfrom\s*|\bimport\s*\(?\s*|\bexport\s+\*\s+from\s*)["']([^"']+)["']/g

  function resolveLocal(fromFile: string, specifier: string): string | null {
    const base = specifier.startsWith("@/")
      ? resolve(srcRoot, specifier.slice(2))
      : specifier.startsWith(".")
        ? resolve(dirname(fromFile), specifier)
        : null
    if (base === null) return null
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}/index.ts`,
    ]) {
      try {
        readFileSync(candidate)
        return candidate
      } catch {
        // Try the next extension.
      }
    }
    throw new Error(`Cannot resolve ${specifier} from ${fromFile}`)
  }

  /** Every module the agent path loads, and every package it names. */
  function walk(roots: readonly string[]) {
    const files = new Set<string>()
    const packages = new Set<string>()
    const queue = roots.map((root) => resolve(srcRoot, root))
    while (queue.length > 0) {
      const file = queue.pop()!
      if (files.has(file)) continue
      files.add(file)
      const source = readFileSync(file, "utf8")
      for (const match of source.matchAll(SPECIFIER)) {
        const specifier = match[1]!
        const local = resolveLocal(file, specifier)
        if (local === null) packages.add(specifier)
        else queue.push(local)
      }
    }
    return { files, packages }
  }

  it("reaches no send module, workflow, workflow runtime, or send function", () => {
    const { files, packages } = walk(AGENT_PATH)
    const relative = [...files].map((file) => file.slice(srcRoot.length + 1))

    expect(relative).toEqual(expect.arrayContaining(AGENT_PATH))
    for (const forbidden of FORBIDDEN_FILES) {
      expect(relative).not.toContain(forbidden)
    }
    expect(relative.filter((file) => file.startsWith("workflows/"))).toEqual([])
    expect(
      [...packages].filter(
        (name) => name === "workflow" || /^(@workflow\/|workflow\/)/.test(name),
      ),
    ).toEqual([])
    const naming = [...files].filter((file) =>
      FORBIDDEN_NAMES.test(readFileSync(file, "utf8")),
    )
    expect(naming).toEqual([])
  })
})
