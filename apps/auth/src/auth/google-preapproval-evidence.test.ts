import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { afterEach, expect, it, vi } from "vitest"
import { googlePreapprovalSignIn } from "./google-preapproval-evidence"

afterEach(() => vi.unstubAllGlobals())

it("retains only authoritative Google addresses after verifying signed identity tokens", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256")
  const key = {
    ...(await exportJWK(publicKey)),
    kid: "google-test",
    alg: "RS256",
  }
  vi.stubGlobal("fetch", async () => Response.json({ keys: [key] }))
  const signIn = googlePreapprovalSignIn("client-id")
  const token = async (
    claims: Record<string, unknown>,
    audience = "client-id",
  ) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: key.kid })
      .setSubject("google-sub")
      .setIssuer("https://accounts.google.com")
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey)
  for (const [claims, expected] of [
    [
      { email: "Exact.Name+tag@gmail.com", email_verified: true },
      "exact.name+tag@gmail.com",
    ],
    [
      {
        email: "person@workspace.test",
        email_verified: true,
        hd: "workspace.test",
      },
      "person@workspace.test",
    ],
    [{ email: "person@external.test", email_verified: true }, undefined],
    [
      {
        email: "person@workspace.test",
        email_verified: false,
        hd: "workspace.test",
      },
      undefined,
    ],
  ] as const) {
    const info = await signIn.getUserInfo({ idToken: await token(claims) })
    expect(info).not.toBeNull()
    const context = {}
    signIn.capture(
      {
        method: "oauth",
        oauth: { providerId: "google", profile: { ...info!.data } },
      },
      context,
    )
    expect(signIn.evidence(context)?.googleEmail).toBe(expected)
  }
  expect(
    await signIn.getUserInfo({
      idToken: await token({ email: "person@gmail.com" }, "other-client"),
    }),
  ).toBeNull()
  expect(await signIn.getUserInfo({ idToken: "forged" })).toBeNull()
  expect(signIn.evidence({})).toBeUndefined()
})

it("rejects invalid issuer, expiration, signature and missing expiry", async () => {
  const trusted = await generateKeyPair("RS256")
  const attacker = await generateKeyPair("RS256")
  vi.stubGlobal("fetch", async () =>
    Response.json({
      keys: [
        { ...(await exportJWK(trusted.publicKey)), kid: "key", alg: "RS256" },
      ],
    }),
  )
  const signIn = googlePreapprovalSignIn("client-id")
  for (const scenario of ["issuer", "expired", "signature", "no-expiry"]) {
    let token = new SignJWT({ email: "person@gmail.com", email_verified: true })
      .setProtectedHeader({ alg: "RS256", kid: "key" })
      .setSubject("subject")
      .setAudience("client-id")
      .setIssuer(
        scenario === "issuer"
          ? "https://attacker.test"
          : "https://accounts.google.com",
      )
      .setIssuedAt()
    if (scenario !== "no-expiry")
      token = token.setExpirationTime(scenario === "expired" ? "-1h" : "1h")
    expect(
      await signIn.getUserInfo({
        idToken: await token.sign(
          scenario === "signature" ? attacker.privateKey : trusted.privateKey,
        ),
      }),
    ).toBeNull()
  }
})
