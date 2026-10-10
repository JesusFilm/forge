import { createHash, randomBytes } from "node:crypto"

export type OAuthState = {
  state: string
  codeVerifier: string
  codeChallenge: string
}

export function createOAuthState(): OAuthState {
  const codeVerifier = base64Url(randomBytes(32))

  return {
    state: base64Url(randomBytes(24)),
    codeVerifier,
    codeChallenge: base64Url(
      createHash("sha256").update(codeVerifier).digest(),
    ),
  }
}

export function base64Url(input: Buffer) {
  return input.toString("base64url")
}
