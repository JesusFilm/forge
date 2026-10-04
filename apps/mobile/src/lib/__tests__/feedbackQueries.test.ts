import { print } from "graphql"
import type { DocumentNode, OperationDefinitionNode } from "graphql"

import {
  FEEDBACK_KINDS,
  SUBMIT_FEEDBACK,
  SUBMIT_FEEDBACK_OPERATION_NAME,
} from "../feedbackQueries"

function sdlOf(doc: unknown): string {
  return print(doc as DocumentNode)
}

function operationNameOf(doc: unknown): string | undefined {
  const definition = (doc as DocumentNode).definitions.find(
    (d): d is OperationDefinitionNode => d.kind === "OperationDefinition",
  )
  return definition?.name?.value
}

describe("SUBMIT_FEEDBACK document", () => {
  it("sends the public submitFeedback mutation with the typed input", () => {
    const sdl = sdlOf(SUBMIT_FEEDBACK)
    expect(sdl).toContain(
      "mutation SubmitFeedback($input: FeedbackSubmissionInput!)",
    )
    expect(sdl).toContain("submitFeedback(input: $input)")
  })

  // The refusal never selects different text on the phone (KD10), but admin
  // answers it and dropping the field leaves the outcome unable to carry it.
  it("selects both result fields", () => {
    const sdl = sdlOf(SUBMIT_FEEDBACK)
    expect(sdl).toContain("accepted")
    expect(sdl).toContain("refusal")
  })

  // The fleet-bearer gate in authHeaders.ts matches on the operation NAME, so a
  // rename that misses the constant drops feedback into the shared public:<ip>
  // bucket. Same class of bug as #1622.
  it("matches the name the fleet-bearer allowlist admits", () => {
    expect(operationNameOf(SUBMIT_FEEDBACK)).toBe(
      SUBMIT_FEEDBACK_OPERATION_NAME,
    )
  })
})

// KTD10. The wire enum is UPPERCASE on BOTH sides. feat-335 ported web's
// lowercase `experience` into mobile, whose wire enum is uppercase, and every
// click would have posted the wrong value with the suite green. Pin the
// production-reachable spelling; the tuple's type derives from the generated
// schema, so a lowercase literal cannot compile in the first place.
describe("FEEDBACK_KINDS", () => {
  it("carries admin's uppercase spellings in tile order", () => {
    expect(FEEDBACK_KINDS).toEqual(["BROKEN", "IDEA", "OTHER"])
  })
})
