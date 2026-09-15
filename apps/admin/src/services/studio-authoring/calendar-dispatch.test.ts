import { describe, expect, it } from "vitest"
import { calendarDispatchFailure } from "./calendar-dispatch"
import { StudioCommandError, StudioPublicationRejected } from "./errors"
import { StudioPublicationPreparationError } from "./scheduled-publication-adapter"

describe("calendar delivery retry classification", () => {
  it("keeps ambiguous submission distinct from confirmed rejection and preparation", () => {
    expect(calendarDispatchFailure(new Error("lost commit response"))).toEqual({
      retry: true,
      code: "SUBMISSION_UNKNOWN",
    })
    expect(
      calendarDispatchFailure(new StudioPublicationPreparationError("UNREADY")),
    ).toEqual({ retry: true, code: "UNREADY" })
    expect(
      calendarDispatchFailure(
        new StudioPublicationRejected(new StudioCommandError("UNREADY")),
      ),
    ).toEqual({ retry: false, code: "UNREADY" })
    expect(
      calendarDispatchFailure(new StudioCommandError("CANCELLED")),
    ).toEqual({ retry: false, code: "CANCELLED" })
  })
})
