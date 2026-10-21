import test from "node:test"
import assert from "node:assert/strict"
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify,
} from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  AUDIENCE,
  issueLink,
  privateWrite,
  publicIdentity,
  updateTvEnvironment,
} from "./simulator-token.mjs"

test("issuer produces the exact independently verifiable Ed25519 contract", () => {
  const { privateKey } = generateKeyPairSync("ed25519")
  const id = "329de212-a8c3-4bba-87ef-839acebd5694"
  const link = issueLink(privateKey, { now: 100000, ttl: 3600, id })
  const url = new URL(link.url)
  assert.equal(url.origin, AUDIENCE)
  assert.equal(url.pathname, "/tv/simulator")
  assert.equal(url.search, "")
  const [header, payload, signature] = url.hash.slice(7).split(".")
  const pub = createPublicKey(privateKey)
  assert.equal(
    link.kid,
    createHash("sha256")
      .update(pub.export({ type: "spki", format: "der" }))
      .digest("hex")
      .slice(0, 16),
  )
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), {
    alg: "EdDSA",
    typ: "JWT",
    kid: link.kid,
  })
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url")), {
    iss: "forge-tv-simulator",
    aud: AUDIENCE,
    scope: "tv-feedback:simulator",
    iat: 100000,
    exp: 103600,
    jti: id,
  })
  assert.equal(
    verify(
      null,
      Buffer.from(`${header}.${payload}`),
      pub,
      Buffer.from(signature, "base64url"),
    ),
    true,
  )
  assert.equal(
    verify(
      null,
      Buffer.from(`${header}.${payload}x`),
      pub,
      Buffer.from(signature, "base64url"),
    ),
    false,
  )
})
test("rejects wrong key type and unsafe token lifetime", () => {
  const { privateKey } = generateKeyPairSync("ed25519")
  for (const ttl of [0, 59, 7201, Infinity, NaN, 60.5])
    assert.throws(() => issueLink(privateKey, { ttl }))
  assert.throws(() =>
    publicIdentity(
      generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey,
    ),
  )
})
test("updates only the two TV simulator settings and removes duplicate definitions", () => {
  const original =
    "# developer config\nEXPO_PUBLIC_GRAPHQL_URL=http://local/graphql\nPRIVATE_UNRELATED=preserve\nEXPO_PUBLIC_TV_FEEDBACK_URL=old\nexport EXPO_PUBLIC_TV_FEEDBACK_URL=duplicate\nEXPO_PUBLIC_TV_FEEDBACK_SIMULATOR_ENABLED=false\n"
  const updated = updateTvEnvironment(
    original,
    "https://example.invalid/tv/simulator#token=fixture",
  )
  assert.match(updated, /PRIVATE_UNRELATED=preserve/)
  assert.match(updated, /EXPO_PUBLIC_GRAPHQL_URL=http:\/\/local\/graphql/)
  assert.equal(updated.match(/EXPO_PUBLIC_TV_FEEDBACK_URL=/g).length, 1)
  assert.match(updated, /EXPO_PUBLIC_TV_FEEDBACK_SIMULATOR_ENABLED=true/)
})
test("private output is mode 0600 and does not follow symlinks", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tv-issuer-test-"))
  try {
    const file = path.join(directory, "link.txt"),
      alias = path.join(directory, "alias.txt")
    fs.writeFileSync(file, "old", { mode: 0o644 })
    privateWrite(file, "fixture")
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    fs.symlinkSync(file, alias)
    assert.throws(() => privateWrite(alias, "changed"))
    assert.equal(fs.readFileSync(file, "utf8"), "fixture")
  } finally {
    fs.rmSync(directory, { recursive: true })
  }
})
