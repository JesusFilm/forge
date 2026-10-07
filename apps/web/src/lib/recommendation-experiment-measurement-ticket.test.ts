import { describe, expect, it } from "vitest"
import {
  issueWatchExperimentMeasurementTicket,
  readWatchExperimentMeasurementTicket,
} from "./recommendation-experiment-measurement-ticket"

const secret = "watch-experiment-measurement-secret-0123456789"
const issuedAt = new Date("2026-10-07T00:00:00.000Z")

describe("Watch experiment measurement ticket", () => {
  it("binds an experiment to one issued request without storing viewer identity", () => {
    const ticket = issueWatchExperimentMeasurementTicket(
      secret,
      { experimentId: "trial-7", requestId: "request-1" },
      issuedAt,
    )
    expect(ticket).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(
      readWatchExperimentMeasurementTicket(
        secret,
        ticket,
        "request-1",
        new Date("2026-10-08T00:00:00.000Z"),
      ),
    ).toEqual({ experimentId: "trial-7" })
    expect(
      readWatchExperimentMeasurementTicket(
        secret,
        ticket,
        "other-request",
        issuedAt,
      ),
    ).toBeNull()
    expect(
      readWatchExperimentMeasurementTicket(
        secret,
        `${ticket}x`,
        "request-1",
        issuedAt,
      ),
    ).toBeNull()
    expect(
      readWatchExperimentMeasurementTicket(
        secret,
        ticket,
        "request-1",
        new Date("2026-11-06T00:00:00.000Z"),
      ),
    ).toBeNull()
  })
})
