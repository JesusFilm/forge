// The device runtime has no WebCrypto, so the helper falls back to expo-crypto.
// This mock stands in for the native module; each test decides what it does.
jest.mock("expo-crypto", () => ({
  getRandomValues: jest.fn(),
}))

import * as ExpoCrypto from "expo-crypto"

import {
  hasSecureRandom,
  randomClaimNonce,
  randomEventId,
  secureRandomToken,
  toBase64Url,
} from "../random"
import { VIEWER_TOKEN_PATTERN } from "../viewerIdentity"

const expoGetRandomValues = ExpoCrypto.getRandomValues as jest.Mock

/** Run `fn` with the runtime's own WebCrypto hidden, as on Hermes. */
function withoutRuntimeCrypto<T>(fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")
  Object.defineProperty(globalThis, "crypto", {
    value: undefined,
    configurable: true,
    writable: true,
  })
  try {
    return fn()
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor)
  }
}

beforeEach(() => {
  expoGetRandomValues.mockReset()
})

describe("toBase64Url", () => {
  it("encodes known vectors without padding", () => {
    expect(toBase64Url(new Uint8Array([]))).toBe("")
    expect(toBase64Url(new Uint8Array([0, 0, 0]))).toBe("AAAA")
    expect(toBase64Url(new Uint8Array([255]))).toBe("_w")
    expect(toBase64Url(new Uint8Array([255, 255]))).toBe("__8")
    expect(toBase64Url(new Uint8Array([251, 255, 191]))).toBe("-_-_")
  })

  it("turns 32 bytes into the 43-character token shape Admin mints", () => {
    const token = toBase64Url(new Uint8Array(32).fill(7))
    expect(token).toHaveLength(43)
    expect(VIEWER_TOKEN_PATTERN.test(token)).toBe(true)
  })
})

describe("secureRandomToken", () => {
  it("returns a 43-character base64url token from the runtime's WebCrypto", () => {
    expect(hasSecureRandom()).toBe(true)
    const token = secureRandomToken()
    expect(token).not.toBeNull()
    expect(VIEWER_TOKEN_PATTERN.test(token!)).toBe(true)
    expect(secureRandomToken()).not.toBe(token)
    expect(expoGetRandomValues).not.toHaveBeenCalled()
  })

  it("falls back to expo-crypto when the runtime has no WebCrypto (the device)", () => {
    let seed = 1
    expoGetRandomValues.mockImplementation((bytes: Uint8Array) => {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = (seed += 37) & 255
    })
    withoutRuntimeCrypto(() => {
      expect(hasSecureRandom()).toBe(true)
      const token = secureRandomToken()
      expect(token).not.toBeNull()
      expect(VIEWER_TOKEN_PATTERN.test(token!)).toBe(true)
      expect(secureRandomToken()).not.toBe(token)
    })
    expect(expoGetRandomValues).toHaveBeenCalledTimes(2)
  })

  it("treats a native source that leaves the buffer untouched as absent", () => {
    expoGetRandomValues.mockImplementation(() => null)
    withoutRuntimeCrypto(() => {
      expect(secureRandomToken()).toBeNull()
    })
    expect(expoGetRandomValues).toHaveBeenCalledTimes(1)
  })

  it("returns null when the source throws instead of a weaker token", () => {
    const spy = jest
      .spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementation(() => {
        throw new Error("no entropy")
      })
    try {
      expect(secureRandomToken()).toBeNull()
    } finally {
      spy.mockRestore()
    }
    expoGetRandomValues.mockImplementation(() => {
      throw new Error("native module missing")
    })
    withoutRuntimeCrypto(() => {
      expect(secureRandomToken()).toBeNull()
    })
  })
})

describe("randomClaimNonce", () => {
  it("is at least 16 characters and unique per call", () => {
    const a = randomClaimNonce()
    const b = randomClaimNonce()
    expect(a.length).toBeGreaterThanOrEqual(16)
    expect(a.length).toBeLessThanOrEqual(191)
    expect(a).not.toBe(b)
  })

  it("still mints a usable nonce when the cryptographic source is gone", () => {
    const spy = jest
      .spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementation(() => {
        throw new Error("no entropy")
      })
    try {
      const nonce = randomClaimNonce()
      expect(nonce.length).toBeGreaterThanOrEqual(16)
      expect(/^[A-Za-z0-9]+$/.test(nonce)).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})

describe("randomEventId", () => {
  it("prefixes the kind and stays within Admin's 191-character bound", () => {
    const id = randomEventId("playback_progress", "item-1")
    expect(id.startsWith("playback_progress:")).toBe(true)
    expect(id.endsWith(":item-1")).toBe(true)
    expect(id.length).toBeLessThanOrEqual(191)
    expect(randomEventId("render", "x".repeat(400)).length).toBe(191)
  })
})
