import { _resetStorageForTests, getStorage } from "../safeStorage"
import {
  USER_CODE_FORMAT_STORAGE_KEY,
  loadUserCodeFormat,
  nextUserCodeFormat,
  parseUserCodeFormat,
  saveUserCodeFormat,
} from "./userCodeFormatPreference"

beforeAll(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {})
})

beforeEach(() => {
  _resetStorageForTests()
})

describe("parseUserCodeFormat", () => {
  it("accepts both known formats", () => {
    expect(parseUserCodeFormat("letters")).toBe("letters")
    expect(parseUserCodeFormat("numbers")).toBe("numbers")
  })

  it("falls back to the default for anything else", () => {
    expect(parseUserCodeFormat(null)).toBe("letters")
    expect(parseUserCodeFormat("")).toBe("letters")
    expect(parseUserCodeFormat("emoji")).toBe("letters")
  })
})

describe("nextUserCodeFormat", () => {
  it("flips between the two and round-trips", () => {
    expect(nextUserCodeFormat("letters")).toBe("numbers")
    expect(nextUserCodeFormat("numbers")).toBe("letters")
    expect(nextUserCodeFormat(nextUserCodeFormat("letters"))).toBe("letters")
  })
})

describe("storage round-trip", () => {
  it("defaults before anything is stored", async () => {
    expect(await loadUserCodeFormat()).toBe("letters")
  })

  it("persists and reloads the choice", async () => {
    await saveUserCodeFormat("numbers")
    expect(await loadUserCodeFormat()).toBe("numbers")
    expect(await getStorage().getItem(USER_CODE_FORMAT_STORAGE_KEY)).toBe(
      "numbers",
    )
  })

  it("recovers from a corrupted stored value", async () => {
    await getStorage().setItem(USER_CODE_FORMAT_STORAGE_KEY, "nonsense")
    expect(await loadUserCodeFormat()).toBe("letters")
  })
})
