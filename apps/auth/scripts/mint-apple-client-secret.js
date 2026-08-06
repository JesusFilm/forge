#!/usr/bin/env node
/**
 * Mint an Apple "client secret" — an ES256 JWT signed with a Sign in with
 * Apple .p8 key. Apple verifies it against the public half of that key.
 *
 * Apple caps these at 6 months, so this is a RECURRING operator task, not a
 * one-off. The output goes in Doppler as APPLE_NATIVE_CLIENT_SECRET on
 * forge-auth; when it expires, native Apple sign-in stops working.
 *
 * Usage:
 *   pnpm --filter @forge/auth mint:apple-client-secret \
 *     <p8-path> <team-id> <key-id> <client-id>
 *
 * The client-id must be the SAME value presented to Apple's token endpoint:
 * for the native sheet that is the app bundle id (org.jesusfilm.forgewatch).
 * The .p8 is a credential — keep it out of the repo, and note that the JWT
 * on stdout is one too (diagnostics go to stderr so a pipe stays clean).
 */

const crypto = require("node:crypto")
const fs = require("node:fs")

const [, , p8Path, teamId, keyId, clientId] = process.argv

if (!p8Path || !teamId || !keyId || !clientId) {
  console.error(
    "usage: node mint-apple-client-secret.js <p8-path> <team-id> <key-id> <client-id>",
  )
  process.exit(1)
}

if (!fs.existsSync(p8Path)) {
  console.error(`error: no such file: ${p8Path}`)
  process.exit(1)
}

for (const [label, value] of [
  ["team-id", teamId],
  ["key-id", keyId],
]) {
  if (!/^[A-Z0-9]{10}$/.test(value)) {
    console.error(
      `error: ${label} should be 10 uppercase alphanumeric characters, got "${value}"`,
    )
    process.exit(1)
  }
}

const b64url = (input) => Buffer.from(input).toString("base64url")

const now = Math.floor(Date.now() / 1000)
// Apple's hard ceiling is 6 months (15777000s). Sit just under it.
const SIX_MONTHS = 15777000
const exp = now + SIX_MONTHS - 60

const header = { alg: "ES256", kid: keyId, typ: "JWT" }
const payload = {
  iss: teamId,
  iat: now,
  exp,
  aud: "https://appleid.apple.com",
  sub: clientId,
}

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(
  JSON.stringify(payload),
)}`

let privateKey
try {
  privateKey = crypto.createPrivateKey(fs.readFileSync(p8Path, "utf8"))
} catch (error) {
  console.error(
    `error: could not read the .p8 as a private key: ${error.message}`,
  )
  process.exit(1)
}

if (privateKey.asymmetricKeyType !== "ec") {
  console.error(
    `error: expected an EC key (got ${privateKey.asymmetricKeyType}) — is this an Apple .p8?`,
  )
  process.exit(1)
}

// JOSE requires the raw R||S signature, not the DER form Node defaults to.
const signature = crypto.sign("sha256", Buffer.from(signingInput), {
  key: privateKey,
  dsaEncoding: "ieee-p1363",
})

const jwt = `${signingInput}.${signature.toString("base64url")}`

console.error(`sub (client_id): ${clientId}`)
console.error(`expires:         ${new Date(exp * 1000).toISOString()}`)
console.error(`rotate before:   ${new Date(exp * 1000).toDateString()}`)
console.error("")
console.error("JWT follows on stdout:")
console.log(jwt)
