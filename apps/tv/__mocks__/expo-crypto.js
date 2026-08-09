// Manual mock for the native module. Jest auto-applies __mocks__ entries for
// node_modules packages, so no test needs to call jest.mock() for this.
//
// It is backed by Node's real crypto rather than a fixed string on purpose:
// callers use these for PKCE verifiers and viewer ids, and a constant would
// make collision/uniqueness assertions pass vacuously.
const nodeCrypto = require("node:crypto")

exports.randomUUID = () => nodeCrypto.randomUUID()

exports.getRandomBytes = (byteCount) =>
  new Uint8Array(nodeCrypto.randomBytes(byteCount))

exports.getRandomBytesAsync = async (byteCount) =>
  new Uint8Array(nodeCrypto.randomBytes(byteCount))

exports.CryptoDigestAlgorithm = { SHA256: "SHA-256" }
exports.CryptoEncoding = { BASE64: "base64", HEX: "hex" }

exports.digestStringAsync = async (algorithm, data, options) => {
  const nodeAlgo = String(algorithm).toLowerCase().replace("-", "")
  const hash = nodeCrypto.createHash(nodeAlgo).update(data, "utf8")
  return options?.encoding === "base64"
    ? hash.digest("base64")
    : hash.digest("hex")
}
