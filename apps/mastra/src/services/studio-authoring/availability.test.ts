import { expect, it } from "vitest"
import { studioRuntimeAvailable } from "./availability"
it("keeps native instruction reads available with hosted execution disabled", () => {
  const config = { enabled: false, publicKeys: "{}" }
  expect(
    studioRuntimeAvailable(
      { action: "instructions", command: { action: "inspect" } },
      config,
    ),
  ).toBe(true)
  expect(
    studioRuntimeAvailable(
      { action: "instructions", command: { action: "inspect" } },
      { enabled: true },
    ),
  ).toBe(false)
  expect(
    studioRuntimeAvailable(
      {
        action: "instructions",
        command: {
          action: "activate",
          versionId: "v1",
          expectedActiveVersionId: "v0",
        },
      },
      config,
    ),
  ).toBe(false)
  expect(studioRuntimeAvailable({}, config)).toBe(false)
})

it("keeps valid hosted tests and mutations gated on both enablement and admission configuration", () => {
  const test = {
    action: "test",
    language: "en",
    selection: { mode: "active" },
    message: "test",
  }
  const configured = {
    enabled: true,
    publicKeys: "{}",
    admissionSecret: "test-secret",
  }
  expect(studioRuntimeAvailable(test, configured)).toBe(true)
  expect(studioRuntimeAvailable(test, { ...configured, enabled: false })).toBe(
    false,
  )
  expect(
    studioRuntimeAvailable(test, { ...configured, admissionSecret: undefined }),
  ).toBe(false)
  const activation = {
    action: "instructions",
    command: {
      action: "activate",
      versionId: "v1",
      expectedActiveVersionId: "v0",
    },
  }
  expect(studioRuntimeAvailable(activation, configured)).toBe(true)
  expect(
    studioRuntimeAvailable(activation, { ...configured, enabled: false }),
  ).toBe(false)
})
