import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest"
import * as s3 from "@/storage/s3"
import {
  ManagerArtifactError,
  readTranscriptSourceArtifact,
} from "./manager-artifacts.service"

describe("readTranscriptSourceArtifact", () => {
  let readArtifactSpy: MockInstance<typeof s3.readManagerArtifact>

  beforeEach(() => {
    readArtifactSpy = vi.spyOn(s3, "readManagerArtifact")
  })

  afterEach(() => {
    readArtifactSpy.mockRestore()
  })

  it("returns transcript text and timed segments from transcript.json", async () => {
    readArtifactSpy.mockResolvedValueOnce(
      stubArtifactBytes({
        text: "hello transcript",
        segments: [{ start: 0, end: 2, text: "hello transcript" }],
        language: "en",
        resolvedProvider: "mux",
        routingReport: { attempts: [] },
      }),
    )

    const result = await readTranscriptSourceArtifact("42")

    expect(result).toMatchObject({
      text: "hello transcript",
      language: "en",
      resolvedProvider: "mux",
      segments: [{ start: 0, end: 2, text: "hello transcript" }],
    })
    expect(readArtifactSpy).toHaveBeenCalledWith("42", "transcript", "json")
  })

  it("throws artifact_missing when transcript.json is absent", async () => {
    readArtifactSpy.mockRejectedValueOnce(
      Object.assign(new Error("The specified key does not exist."), {
        name: "NoSuchKey",
      }),
    )

    await expect(readTranscriptSourceArtifact("42")).rejects.toMatchObject({
      name: "ManagerArtifactError",
      code: "artifact_missing",
    })
  })

  it("throws artifact_invalid when transcript.json is malformed JSON", async () => {
    readArtifactSpy.mockResolvedValueOnce(stubArtifactBytes("not-json"))

    await expect(readTranscriptSourceArtifact("42")).rejects.toMatchObject({
      name: "ManagerArtifactError",
      code: "artifact_invalid",
    })
  })

  it("throws artifact_invalid without echoing transcript text for malformed shape", async () => {
    const secret = "SENSITIVE_TRANSCRIPT_MARKER"
    readArtifactSpy.mockResolvedValueOnce(
      stubArtifactBytes({
        text: secret,
        segments: [{ start: "bad", end: 2, text: secret }],
        language: "en",
      }),
    )
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const error = await readTranscriptSourceArtifact("42").catch((e) => e)
      expect((error as Error).message).not.toContain(secret)
      expect((error as { code: string }).code).toBe("artifact_invalid")
    } finally {
      errorSpy.mockRestore()
    }
  })
})

function stubArtifactBytes(body: unknown): Uint8Array {
  const str = typeof body === "string" ? body : JSON.stringify(body)
  return new TextEncoder().encode(str)
}

// -----------------------------------------------------------------------------
// Classifier coverage. Tests use the spy pattern so each test injects an exact
// error shape, including typed AWS SDK v3 shapes that a regex-only classifier
// would miss.
// -----------------------------------------------------------------------------

type ClassifierCase = {
  readonly label: string
  readonly factory: () => unknown
  readonly expectedCode:
    | "artifact_missing"
    | "artifact_invalid"
    | "artifact_read_failed"
}

const CLASSIFIER_CASES: readonly ClassifierCase[] = [
  {
    label: "AWS SDK v3 typed GET miss (name: 'NoSuchKey')",
    factory: () =>
      Object.assign(new Error("The specified key does not exist."), {
        name: "NoSuchKey",
      }),
    expectedCode: "artifact_missing",
  },
  {
    label: "AWS SDK v3 typed GET miss with regex-incompatible message",
    factory: () =>
      Object.assign(new Error("Server returned HTTP 500"), {
        name: "NoSuchKey",
      }),
    expectedCode: "artifact_missing",
  },
  {
    label: "AWS SDK v3 typed HEAD miss (name: 'NotFound')",
    factory: () => Object.assign(new Error("Not Found"), { name: "NotFound" }),
    expectedCode: "artifact_missing",
  },
  {
    label: "AWS SDK v3 typed HEAD miss with regex-incompatible message",
    factory: () => Object.assign(new Error("HTTP 404"), { name: "NotFound" }),
    expectedCode: "artifact_missing",
  },
  {
    label: "Legacy AWS Code-shape (Code: 'NoSuchKey')",
    factory: () =>
      Object.assign(new Error("Some legacy SDK message"), {
        Code: "NoSuchKey",
      }),
    expectedCode: "artifact_missing",
  },
  {
    label: "Local fallback ENOENT",
    factory: () =>
      Object.assign(new Error("ENOENT: no such file or directory"), {
        code: "ENOENT",
      }),
    expectedCode: "artifact_missing",
  },
  {
    label: "Plain Error with 'does not exist'",
    factory: () => new Error("object 'foo' does not exist at key /bar"),
    expectedCode: "artifact_missing",
  },
  {
    label: "Unrelated transport error",
    factory: () => new Error("connection reset by peer"),
    expectedCode: "artifact_read_failed",
  },
  {
    label: "Unrelated error mentioning 'missing field'",
    factory: () => new Error("missing field 'foo' in api response"),
    expectedCode: "artifact_read_failed",
  },
  {
    label: "Plain Error with bare 'no such key'",
    factory: () => new Error("s3-compatible: no such key in bucket"),
    expectedCode: "artifact_read_failed",
  },
] as const

describe("isArtifactMissing classifier", () => {
  let readArtifactSpy: MockInstance<typeof s3.readManagerArtifact>

  beforeEach(() => {
    readArtifactSpy = vi.spyOn(s3, "readManagerArtifact")
  })

  afterEach(() => {
    readArtifactSpy.mockRestore()
  })

  for (const c of CLASSIFIER_CASES) {
    it(`classifies ${c.label} as ${c.expectedCode}`, async () => {
      readArtifactSpy.mockRejectedValueOnce(c.factory())
      const error = await readTranscriptSourceArtifact("1").catch((e) => e)
      expect(error).toBeInstanceOf(ManagerArtifactError)
      expect((error as ManagerArtifactError).code).toBe(c.expectedCode)
    })
  }
})
