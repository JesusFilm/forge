import { readFileSync } from "node:fs"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  DeviceApprovalPageClient,
  describeDeviceError,
  isTerminalDeviceError,
  readDeviceErrorCode,
} from "./device-page-client"

function renderApproval(
  props: Partial<{
    accountEmail: string
    fallbackAppName: string
    initialUserCode: string
  }> = {},
) {
  return renderToStaticMarkup(
    <DeviceApprovalPageClient
      accountEmail={props.accountEmail ?? "viewer@example.com"}
      fallbackAppName={props.fallbackAppName ?? "Jesus Film on your TV"}
      initialUserCode={props.initialUserCode ?? "0194507302"}
    />,
  )
}

describe("device approval UI", () => {
  it("re-shows the code so the human can compare it with the TV screen", () => {
    const html = renderApproval({ initialUserCode: "0194507302" })

    expect(html).toContain("019-450-7302")
    expect(html).toContain("Code on your TV")
    expect(html).toContain("must match the code on your TV screen")
  })

  it("groups the letters format the same way it is printed on the TV", () => {
    const html = renderApproval({ initialUserCode: "BXKDQWNM" })

    expect(html).toContain("BXKD-QWNM")
  })

  it("names the requesting application and says it is a TV", () => {
    const html = renderApproval({ fallbackAppName: "Jesus Film TV" })

    expect(html).toContain("Jesus Film TV")
    expect(html).toContain("A TV is asking to sign in to your Jesus Film")
  })

  it("renders Deny as a real button, not a de-emphasised text link", () => {
    const html = renderApproval()

    expect(html).toMatch(
      /<button[^>]*type="button"[^>]*>(?:(?!<\/button>).)*Deny/s,
    )
    expect(html).not.toMatch(/<a[^>]*>\s*Deny\s*</)
  })

  it("gives Deny the same size and weight as Approve", () => {
    const html = renderApproval()

    const deny = html.slice(html.indexOf("Deny") - 900, html.indexOf("Deny"))
    const approve = html.slice(
      html.indexOf("Approve<") - 900,
      html.indexOf("Approve<"),
    )

    for (const token of ["h-[42px]", "w-full", "font-bold"]) {
      expect(deny).toContain(token)
      expect(approve).toContain(token)
    }
  })

  it("puts Deny ahead of Approve in reading and focus order", () => {
    // Same size and weight is not enough: on a phone the first control under
    // the code is the one a hurried thumb finds, and the safe answer to an
    // approval request you did not start is no.
    const html = renderApproval()

    expect(html.indexOf(">Deny<")).toBeGreaterThan(-1)
    expect(html.indexOf(">Deny<")).toBeLessThan(html.indexOf(">Approve<"))
  })

  it("renders the approving account so a shared phone cannot approve silently", () => {
    const html = renderApproval({ accountEmail: "mum@example.com" })

    expect(html).toContain("Approving as mum@example.com")
    expect(html).toContain("Not you?")
    expect(html).toContain("/login?user_code=0194507302&amp;prompt=login")
  })

  it("renders no third-party login affordance (App Store guideline 4.8)", () => {
    const html = renderApproval()

    for (const provider of [
      "Google",
      "Facebook",
      "Apple ID",
      "Okta",
      "Continue with",
      "accounts.google.com",
      "facebook.com",
      "appleid.apple.com",
    ]) {
      expect(html).not.toContain(provider)
    }
  })

  it("asks for the code first when the TV link did not carry one", () => {
    const html = renderApproval({ initialUserCode: "" })

    expect(html).toContain("Enter the code from your TV")
    expect(html).toContain('autoComplete="one-time-code"')
    expect(html).toContain('inputMode="numeric"')
    expect(html).not.toContain("Approving as")
  })
})

describe("describeDeviceError", () => {
  it("distinguishes an unknown code from an expired one", () => {
    expect(describeDeviceError("invalid_request").title).toContain(
      "not recognized",
    )
    expect(describeDeviceError("expired_token").title).toContain("expired")
    expect(describeDeviceError("invalid_request").detail).not.toBe(
      describeDeviceError("expired_token").detail,
    )
  })

  it("tells the user a consumed code cannot be retried", () => {
    const copy = describeDeviceError("device_code_already_processed")

    expect(copy.code).toBe("device_code_already_processed")
    expect(copy.title).toContain("already used")
  })

  it("routes a lost session back to sign-in rather than to a retry", () => {
    const copy = describeDeviceError("unauthorized")

    expect(copy.code).toBe("unauthorized")
    expect(copy.detail).toContain("Sign in again")
  })

  it("falls back to a connectivity message for anything unrecognized", () => {
    expect(describeDeviceError(undefined).code).toBe("network")
    expect(describeDeviceError("slow_down").code).toBe("network")
  })

  it("does not blame the user's connection for the server kill switch", () => {
    // `assertEnabled` answers 503 temporarily_unavailable when the grant is
    // switched off; "check your connection" would be a false statement.
    const copy = describeDeviceError("temporarily_unavailable")

    expect(copy.code).toBe("temporarily_unavailable")
    expect(copy.detail).not.toContain("connection")
  })
})

describe("isTerminalDeviceError", () => {
  it("keeps the decision live for a failure it could not attribute", () => {
    // A 502 from the edge must not disable Approve and Deny — the person on
    // the phone would have to re-type a code that was never wrong.
    expect(isTerminalDeviceError("network")).toBe(false)
  })

  it("ends the decision once the server has ruled on the code", () => {
    for (const code of [
      "invalid_request",
      "expired_token",
      "device_code_already_processed",
      "unauthorized",
      "temporarily_unavailable",
    ] as const) {
      expect(isTerminalDeviceError(code)).toBe(true)
    }
  })
})

describe("terminal-failure wiring", () => {
  // The suite runs under `environment: "node"` with no DOM, so neither the
  // status effect nor `decide()` can be driven directly — the predicate's unit
  // tests above prove the RULE and nothing pins its USE. A one-line revert at
  // either call site (`setPhase("failed")` with no guard) restores the
  // lockout-on-a-502 behaviour and leaves every other test green. This source
  // backstop is the only thing that can catch that until a DOM-capable
  // environment exists here.
  const source = readFileSync(
    new URL("./device-page-client.tsx", import.meta.url),
    "utf8",
  )

  it("guards every terminal transition with the predicate", () => {
    expect(source.match(/setPhase\("failed"\)/g)).toHaveLength(2)
    expect(
      source.match(/isTerminalDeviceError\(failure\.code\)/g),
    ).toHaveLength(2)
  })

  it("reads failure bodies only through readDeviceErrorCode", () => {
    // Any other `res.json()` on a failure path is a second, unreviewed way for
    // `error_description` to reach the UI.
    expect(source.match(/readDeviceErrorCode\(res\)/g)).toHaveLength(2)
    expect(source).not.toMatch(/\.error_description|error_description\s*[:?]/)
  })
})

describe("readDeviceErrorCode", () => {
  it("reads the machine-readable code from an oauthError body", async () => {
    const res = new Response(
      JSON.stringify({
        error: "expired_token",
        error_description: "This code has expired.",
      }),
      { status: 400 },
    )

    expect(await readDeviceErrorCode(res)).toBe("expired_token")
  })

  it("never surfaces error_description, which can quote the submitted code", async () => {
    const res = new Response(
      JSON.stringify({
        error: "invalid_request",
        error_description: "Unknown code 019-450-7302.",
      }),
      { status: 400 },
    )

    const code = await readDeviceErrorCode(res)
    const copy = describeDeviceError(code)

    expect(code).toBe("invalid_request")
    expect(`${copy.title} ${copy.detail}`).not.toContain("019-450-7302")
  })

  it("still recognizes a lost session from a body-less 401", async () => {
    expect(await readDeviceErrorCode(new Response("", { status: 401 }))).toBe(
      "unauthorized",
    )
    expect(
      await readDeviceErrorCode(
        new Response("<html>502</html>", { status: 502 }),
      ),
    ).toBeUndefined()
  })
})
