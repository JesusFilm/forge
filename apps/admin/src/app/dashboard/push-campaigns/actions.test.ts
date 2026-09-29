import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  PushCampaignsDisabledError,
  PushDuplicateTestDeviceError,
  PushFrozenError,
  PushInputError,
  PushNotTestedError,
  PushTokenShapedIdError,
} from "@/services/push/errors"

const requireSession = vi.fn()
const revalidatePath = vi.fn()
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`)
})

const createPushCampaignDraft = vi.fn()
const updatePushCampaign = vi.fn()
const countPushAudience = vi.fn()
const readPushCampaignDetail = vi.fn()
const searchPushDestinations = vi.fn()

const schedulePushCampaignRun = vi.fn()
const sendPushCampaignNowRun = vi.fn()
const sendPushCampaignTestRun = vi.fn()
const cancelPushCampaignRun = vi.fn()

const addPushTestDevice = vi.fn()
const removePushTestDevice = vi.fn()

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}))

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}))

vi.mock("@/auth/session", () => ({
  requireSession: (...args: unknown[]) => requireSession(...args),
}))

vi.mock("@/db/client", () => ({ prisma: {} }))

vi.mock("@/services/push/campaign.service", () => ({
  createPushCampaignDraft: (...args: unknown[]) =>
    createPushCampaignDraft(...args),
  updatePushCampaign: (...args: unknown[]) => updatePushCampaign(...args),
  readPushTestSendOutcome: vi.fn(async () => []),
}))

vi.mock("@/services/push/audience.service", () => ({
  countPushAudience: (...args: unknown[]) => countPushAudience(...args),
}))

vi.mock("@/services/push/dashboard.service", () => ({
  readPushCampaignDetail: (...args: unknown[]) =>
    readPushCampaignDetail(...args),
  searchPushDestinations: (...args: unknown[]) =>
    searchPushDestinations(...args),
}))

vi.mock("@/services/push/dispatch", () => ({
  schedulePushCampaignRun: (...args: unknown[]) =>
    schedulePushCampaignRun(...args),
  sendPushCampaignNowRun: (...args: unknown[]) =>
    sendPushCampaignNowRun(...args),
  sendPushCampaignTestRun: (...args: unknown[]) =>
    sendPushCampaignTestRun(...args),
  cancelPushCampaignRun: (...args: unknown[]) => cancelPushCampaignRun(...args),
}))

vi.mock("@/services/push/test-devices.service", () => ({
  addPushTestDevice: (...args: unknown[]) => addPushTestDevice(...args),
  removePushTestDevice: (...args: unknown[]) => removePushTestDevice(...args),
}))

import { PUSH_ACTION_IDLE } from "./components/action-state"
import {
  addTestDeviceAction,
  cancelCampaignAction,
  createCampaignAction,
  removeTestDeviceAction,
  saveCampaignAction,
  scheduleCampaignAction,
  searchDestinationsAction,
  sendNowAction,
  sendTestAction,
} from "./actions"

const ACTOR = { id: "user_1", role: "VIEWER" as const }
const CAMPAIGN = "campaign_1"

function form(values: Record<string, string | readonly string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const entry of value) data.append(key, entry)
    } else {
      data.set(key, value as string)
    }
  }
  return data
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN,
    status: "TESTED",
    audienceScope: "COUNTRIES",
    countries: ["SA", "FR"],
    languageFilter: [],
    ...overrides,
  }
}

describe("push campaign server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireSession.mockResolvedValue(ACTOR)
    countPushAudience.mockResolvedValue({ audience: 1234, unreachable: 7 })
    readPushCampaignDetail.mockResolvedValue(detail())
    updatePushCampaign.mockResolvedValue({ id: CAMPAIGN, status: "DRAFT" })
    schedulePushCampaignRun.mockResolvedValue({ campaignId: CAMPAIGN })
    sendPushCampaignNowRun.mockResolvedValue({ campaignId: CAMPAIGN })
    sendPushCampaignTestRun.mockResolvedValue({ campaignId: CAMPAIGN })
    cancelPushCampaignRun.mockResolvedValue({ zonesCancelled: 3 })
  })

  describe("access", () => {
    it("sends a principal without the campaign permission back to the dashboard", async () => {
      requireSession.mockResolvedValue({ id: "user_2", role: "PUBLIC" })
      await expect(
        saveCampaignAction(PUSH_ACTION_IDLE, form({ campaignId: CAMPAIGN })),
      ).rejects.toThrow("NEXT_REDIRECT:/dashboard")
      expect(updatePushCampaign).not.toHaveBeenCalled()
    })

    it("admits a viewer, the tier R28 puts every campaign action at", async () => {
      await saveCampaignAction(
        PUSH_ACTION_IDLE,
        form({
          campaignId: CAMPAIGN,
          copyLanguage: ["english"],
          copyTitle: ["Hello"],
          copyBody: ["Watch tonight"],
        }),
      )
      expect(updatePushCampaign).toHaveBeenCalledTimes(1)
    })
  })

  describe("createCampaignAction", () => {
    it("creates a draft and redirects to its editor", async () => {
      createPushCampaignDraft.mockResolvedValue({
        id: "campaign_new",
        status: "DRAFT",
      })
      await expect(createCampaignAction()).rejects.toThrow(
        "NEXT_REDIRECT:/dashboard/push-campaigns/campaign_new",
      )
      expect(createPushCampaignDraft).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actorId: "user_1" }),
      )
    })
  })

  describe("saveCampaignAction", () => {
    it("pairs the copy rows by index and records the actor", async () => {
      await saveCampaignAction(
        PUSH_ACTION_IDLE,
        form({
          campaignId: CAMPAIGN,
          copyLanguage: ["english", "arabic"],
          copyTitle: ["An announcement", "إعلان"],
          copyBody: ["Watch tonight", "شاهد الليلة"],
          destinationKind: "SERIES",
          destinationSlug: "jesus",
          audienceScope: "COUNTRIES",
          country: ["SA", "fr"],
          languageFilter: ["arabic"],
        }),
      )

      expect(updatePushCampaign).toHaveBeenCalledWith(expect.anything(), {
        campaignId: CAMPAIGN,
        actorId: "user_1",
        update: {
          copies: [
            {
              languageSlug: "english",
              title: "An announcement",
              body: "Watch tonight",
            },
            { languageSlug: "arabic", title: "إعلان", body: "شاهد الليلة" },
          ],
          destination: { kind: "SERIES", slug: "jesus" },
          audience: {
            scope: "COUNTRIES",
            countries: ["SA", "fr"],
            languageFilter: ["arabic"],
          },
        },
      })
    })

    it("saves without a removed row, which is how a non-English copy is deleted", async () => {
      await saveCampaignAction(
        PUSH_ACTION_IDLE,
        form({
          campaignId: CAMPAIGN,
          copyLanguage: ["english"],
          copyTitle: ["An announcement"],
          copyBody: ["Watch tonight"],
        }),
      )

      const update = updatePushCampaign.mock.calls[0]?.[1] as {
        update: { copies: unknown[] }
      }
      expect(update.update.copies).toEqual([
        {
          languageSlug: "english",
          title: "An announcement",
          body: "Watch tonight",
        },
      ])
    })

    it("refuses a save on a sending campaign with the freeze reason (AE12)", async () => {
      updatePushCampaign.mockRejectedValue(new PushFrozenError("SENDING"))

      const result = await saveCampaignAction(
        PUSH_ACTION_IDLE,
        form({
          campaignId: CAMPAIGN,
          copyLanguage: ["english"],
          copyTitle: ["An announcement"],
          copyBody: ["Watch tonight"],
        }),
      )

      expect(result).toEqual({
        status: "error",
        reason:
          "A campaign in status SENDING is frozen; cancel it instead of editing it",
      })
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it("surfaces the copy-length refusal the service raises", async () => {
      updatePushCampaign.mockRejectedValue(
        new PushInputError("Too long: String must contain at most 120"),
      )
      const result = await saveCampaignAction(
        PUSH_ACTION_IDLE,
        form({
          campaignId: CAMPAIGN,
          copyLanguage: ["english"],
          copyTitle: ["An announcement"],
          copyBody: ["x".repeat(121)],
        }),
      )
      expect(result.status).toBe("error")
    })

    it("refuses a form with no campaign id before it reaches the service", async () => {
      const result = await saveCampaignAction(PUSH_ACTION_IDLE, form({}))
      expect(result.status).toBe("error")
      expect(updatePushCampaign).not.toHaveBeenCalled()
    })
  })

  describe("sendTestAction", () => {
    it("starts the test run and records the actor (R10)", async () => {
      const result = await sendTestAction(
        PUSH_ACTION_IDLE,
        form({ campaignId: CAMPAIGN }),
      )
      expect(sendPushCampaignTestRun).toHaveBeenCalledWith({
        campaignId: CAMPAIGN,
        actorId: "user_1",
      })
      expect(result.status).toBe("ok")
    })

    it("surfaces the kill-switch reason when the push flag is off (KTD12)", async () => {
      sendPushCampaignTestRun.mockRejectedValue(
        new PushCampaignsDisabledError(),
      )
      const result = await sendTestAction(
        PUSH_ACTION_IDLE,
        form({ campaignId: CAMPAIGN }),
      )
      expect(result).toEqual({
        status: "error",
        reason:
          "Push campaigns are turned off; set PUSH_CAMPAIGNS_ENABLED=true to send",
      })
    })
  })

  describe("scheduleCampaignAction", () => {
    it("schedules with the resolved audience count for the log event", async () => {
      const result = await scheduleCampaignAction(
        PUSH_ACTION_IDLE,
        form({ campaignId: CAMPAIGN, sendDate: "2026-10-01", localHour: "9" }),
      )
      expect(schedulePushCampaignRun).toHaveBeenCalledWith({
        campaignId: CAMPAIGN,
        actorId: "user_1",
        sendDate: "2026-10-01",
        localHour: 9,
        audienceCount: 1234,
      })
      expect(result.status).toBe("ok")
    })

    it("returns the not-tested reason for an untested campaign (AE11)", async () => {
      schedulePushCampaignRun.mockRejectedValue(new PushNotTestedError("DRAFT"))
      const result = await scheduleCampaignAction(
        PUSH_ACTION_IDLE,
        form({ campaignId: CAMPAIGN, sendDate: "2026-10-01", localHour: "9" }),
      )
      expect(result).toEqual({
        status: "error",
        reason:
          "Send this campaign to a test device before you schedule or send it",
      })
    })

    it("refuses an hour outside the day before it reaches the service", async () => {
      const result = await scheduleCampaignAction(
        PUSH_ACTION_IDLE,
        form({ campaignId: CAMPAIGN, sendDate: "2026-10-01", localHour: "24" }),
      )
      expect(result.status).toBe("error")
      expect(schedulePushCampaignRun).not.toHaveBeenCalled()
    })
  })

  describe("sendNowAction", () => {
    it("sends the whole audience at once when the typed count is exact (AE10)", async () => {
      const result = await sendNowAction(
        PUSH_ACTION_IDLE,
        form({ campaignId: CAMPAIGN, confirmCount: "1234" }),
      )

      expect(sendPushCampaignNowRun).toHaveBeenCalledTimes(1)
      expect(sendPushCampaignNowRun).toHaveBeenCalledWith({
        campaignId: CAMPAIGN,
        actorId: "user_1",
        audienceCount: 1234,
      })
      expect(result.status).toBe("ok")
    })

    // Falsification of the count check: the only thing standing between a
    // mistyped confirmation and the whole world is this comparison.
    it("sends nothing when the typed count differs from the audience (AE10)", async () => {
      const result = await sendNowAction(
        PUSH_ACTION_IDLE,
        form({ campaignId: CAMPAIGN, confirmCount: "1233" }),
      )

      expect(sendPushCampaignNowRun).not.toHaveBeenCalled()
      expect(result.status).toBe("error")
      expect(result.status === "error" && result.reason).toContain("1234")
    })

    it("sends nothing when the confirmation is blank", async () => {
      const result = await sendNowAction(
        PUSH_ACTION_IDLE,
        form({ campaignId: CAMPAIGN, confirmCount: "" }),
      )
      expect(sendPushCampaignNowRun).not.toHaveBeenCalled()
      expect(result.status).toBe("error")
    })

    it("re-resolves the audience server side, so a stale typed count is refused", async () => {
      // The page rendered 1234; the audience grew before the editor confirmed.
      countPushAudience.mockResolvedValue({ audience: 1300, unreachable: 7 })
      const result = await sendNowAction(
        PUSH_ACTION_IDLE,
        form({ campaignId: CAMPAIGN, confirmCount: "1234" }),
      )
      expect(sendPushCampaignNowRun).not.toHaveBeenCalled()
      expect(result.status === "error" && result.reason).toContain("1300")
    })

    it("refuses when the campaign is gone", async () => {
      readPushCampaignDetail.mockResolvedValue(null)
      const result = await sendNowAction(
        PUSH_ACTION_IDLE,
        form({ campaignId: CAMPAIGN, confirmCount: "1234" }),
      )
      expect(sendPushCampaignNowRun).not.toHaveBeenCalled()
      expect(result.status).toBe("error")
    })
  })

  describe("cancelCampaignAction", () => {
    it("cancels the zones that have not started and names how many (AE12)", async () => {
      const result = await cancelCampaignAction(
        PUSH_ACTION_IDLE,
        form({ campaignId: CAMPAIGN }),
      )
      expect(cancelPushCampaignRun).toHaveBeenCalledWith({
        campaignId: CAMPAIGN,
        actorId: "user_1",
      })
      expect(result.status === "ok" && result.message).toContain("3")
    })
  })

  describe("test devices", () => {
    it("adds a labelled test ID and records the actor (R31)", async () => {
      addPushTestDevice.mockResolvedValue({
        id: "device_1",
        label: "Urim iPhone",
      })
      const result = await addTestDeviceAction(
        PUSH_ACTION_IDLE,
        form({ testDeviceId: "ab12cd34ef", label: "Urim iPhone" }),
      )
      expect(addPushTestDevice).toHaveBeenCalledWith(expect.anything(), {
        testDeviceId: "ab12cd34ef",
        label: "Urim iPhone",
        actorId: "user_1",
      })
      expect(result.status).toBe("ok")
    })

    it("names the existing label when the ID is already listed", async () => {
      addPushTestDevice.mockRejectedValue(
        new PushDuplicateTestDeviceError("Urim iPhone"),
      )
      const result = await addTestDeviceAction(
        PUSH_ACTION_IDLE,
        form({ testDeviceId: "ab12cd34ef", label: "Second try" }),
      )
      expect(result).toEqual({
        status: "error",
        reason: 'That test ID is already on the list as "Urim iPhone"',
      })
    })

    it("refuses a token-shaped string with the reason (R31)", async () => {
      addPushTestDevice.mockRejectedValue(new PushTokenShapedIdError())
      const result = await addTestDeviceAction(
        PUSH_ACTION_IDLE,
        form({ testDeviceId: "ExponentPushToken[abc]", label: "Pasted token" }),
      )
      expect(result.status === "error" && result.reason).toContain(
        "notification test ID",
      )
    })

    it("removes a device and revalidates the test-device page", async () => {
      removePushTestDevice.mockResolvedValue(true)
      const result = await removeTestDeviceAction(
        PUSH_ACTION_IDLE,
        form({ id: "device_1" }),
      )
      expect(removePushTestDevice).toHaveBeenCalledWith(
        expect.anything(),
        "device_1",
      )
      expect(revalidatePath).toHaveBeenCalledWith(
        "/dashboard/push-campaigns/test-devices",
      )
      expect(result.status).toBe("ok")
    })
  })

  describe("searchDestinationsAction", () => {
    it("passes the kind and query through to the catalog read", async () => {
      searchPushDestinations.mockResolvedValue([
        {
          kind: "SERIES",
          slug: "jesus",
          title: "JESUS",
          meta: "jesus • SERIES",
        },
      ])
      const rows = await searchDestinationsAction({
        kind: "SERIES",
        query: "jes",
      })
      expect(searchPushDestinations).toHaveBeenCalledWith(expect.anything(), {
        kind: "SERIES",
        query: "jes",
      })
      expect(rows).toHaveLength(1)
    })

    it("returns nothing for a kind the campaign model does not carry", async () => {
      const rows = await searchDestinationsAction({
        kind: "PODCAST" as never,
        query: "",
      })
      expect(rows).toEqual([])
      expect(searchPushDestinations).not.toHaveBeenCalled()
    })
  })
})
