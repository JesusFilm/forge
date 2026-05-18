// CLI argv-parsing + subcommand-output tests for partner-keys.
//
// The CLI dynamically imports the service module inside `main()`, so
// argv-parsing tests don't need to mock anything (the parser is a pure
// function exported separately from `main()`). Tests that exercise
// subcommand dispatch + the stderr token banner construct fakes for the
// service module and call the exported helpers directly.

import { describe, expect, it, vi } from "vitest"
import {
  CliConfigError,
  formatTokenBanner,
  parseArgvToConfig,
  parseEnvCsv,
  resolveOperatorId,
} from "./partner-keys"

describe("parseEnvCsv", () => {
  it("returns [] for undefined / empty", () => {
    expect(parseEnvCsv(undefined)).toEqual([])
    expect(parseEnvCsv("")).toEqual([])
  })

  it("splits + trims + dedupes", () => {
    expect(parseEnvCsv("a, b , a,  c")).toEqual(["a", "b", "c"])
  })

  it("drops empty entries", () => {
    expect(parseEnvCsv(",a,,,b,")).toEqual(["a", "b"])
  })
})

describe("parseArgvToConfig — unknown subcommand", () => {
  it("rejects when no subcommand is supplied", () => {
    expect(() => parseArgvToConfig([], {})).toThrowError(CliConfigError)
    expect(() => parseArgvToConfig([], {})).toThrowError(/subcommand required/)
  })

  it("rejects an unknown subcommand", () => {
    expect(() => parseArgvToConfig(["bogus"], {})).toThrowError(
      /unknown subcommand 'bogus'/,
    )
  })
})

describe("parseArgvToConfig — create", () => {
  it("requires --name", () => {
    expect(() =>
      parseArgvToConfig(["create", "--owner-email=p@x.io"], {}),
    ).toThrowError(/--name=<label> is required/)
  })

  it("requires --owner-email", () => {
    expect(() => parseArgvToConfig(["create", "--name=acme"], {})).toThrowError(
      /--owner-email=<email> is required/,
    )
  })

  it("parses the happy path", () => {
    const config = parseArgvToConfig(
      [
        "create",
        "--name=acme",
        "--owner-email=p@x.io",
        "--note=initial",
        "--operator-email=op@jfp.org",
      ],
      {},
    )
    expect(config).toEqual({
      subcommand: "create",
      name: "acme",
      ownerEmail: "p@x.io",
      note: "initial",
      operatorEmail: "op@jfp.org",
    })
  })

  it("defaults note + operatorEmail to null when omitted", () => {
    const config = parseArgvToConfig(
      ["create", "--name=acme", "--owner-email=p@x.io"],
      {},
    )
    if (config.subcommand !== "create") throw new Error("wrong subcommand")
    expect(config.note).toBeNull()
    expect(config.operatorEmail).toBeNull()
  })
})

describe("parseArgvToConfig — list", () => {
  it("defaults --include-revoked to false", () => {
    const config = parseArgvToConfig(["list"], {})
    expect(config).toEqual({
      subcommand: "list",
      includeRevoked: false,
    })
  })

  it("toggles --include-revoked when flag is present", () => {
    const config = parseArgvToConfig(["list", "--include-revoked"], {})
    if (config.subcommand !== "list") throw new Error("wrong subcommand")
    expect(config.includeRevoked).toBe(true)
  })
})

describe("parseArgvToConfig — revoke", () => {
  it("requires positional <keyId>", () => {
    expect(() => parseArgvToConfig(["revoke"], {})).toThrowError(
      /positional <keyId> is required/,
    )
  })

  it("parses keyId + operator-email", () => {
    const config = parseArgvToConfig(
      ["revoke", "ABC123abc456", "--operator-email=op@jfp.org"],
      {},
    )
    expect(config).toEqual({
      subcommand: "revoke",
      keyId: "ABC123abc456",
      operatorEmail: "op@jfp.org",
    })
  })
})

describe("parseArgvToConfig — rotate", () => {
  it("requires positional <keyId>", () => {
    expect(() => parseArgvToConfig(["rotate"], {})).toThrowError(
      /positional <keyId> is required/,
    )
  })

  it("parses keyId without operator-email", () => {
    const config = parseArgvToConfig(["rotate", "ABC123abc456"], {})
    expect(config).toEqual({
      subcommand: "rotate",
      keyId: "ABC123abc456",
      operatorEmail: null,
    })
  })
})

describe("parseArgvToConfig — import-from-env", () => {
  it("rejects when SEARCH_API_KEYS is unset", () => {
    expect(() =>
      parseArgvToConfig(
        ["import-from-env", "--name=legacy", "--owner-email=p@x.io"],
        {},
      ),
    ).toThrowError(/SEARCH_API_KEYS env var is unset or empty/)
  })

  it("rejects when SEARCH_API_KEYS is empty", () => {
    expect(() =>
      parseArgvToConfig(
        ["import-from-env", "--name=legacy", "--owner-email=p@x.io"],
        { SEARCH_API_KEYS: "" },
      ),
    ).toThrowError(/SEARCH_API_KEYS env var is unset or empty/)
  })

  it("rejects when SEARCH_API_KEYS contains only whitespace + commas", () => {
    expect(() =>
      parseArgvToConfig(
        ["import-from-env", "--name=legacy", "--owner-email=p@x.io"],
        { SEARCH_API_KEYS: "  ,  ,  " },
      ),
    ).toThrowError(/SEARCH_API_KEYS env var is unset or empty/)
  })

  it("requires --name", () => {
    expect(() =>
      parseArgvToConfig(["import-from-env", "--owner-email=p@x.io"], {
        SEARCH_API_KEYS: "a,b",
      }),
    ).toThrowError(/--name=<label> is required/)
  })

  it("requires --owner-email", () => {
    expect(() =>
      parseArgvToConfig(["import-from-env", "--name=legacy"], {
        SEARCH_API_KEYS: "a,b",
      }),
    ).toThrowError(/--owner-email=<email> is required/)
  })

  it("splits CSV, dedupes whitespace, and projects tokens in order", () => {
    const config = parseArgvToConfig(
      [
        "import-from-env",
        "--name=legacy",
        "--owner-email=p@x.io",
        "--note=migration batch",
      ],
      { SEARCH_API_KEYS: "tok-a, tok-b , tok-a,  tok-c" },
    )
    if (config.subcommand !== "import-from-env")
      throw new Error("wrong subcommand")
    expect(config.tokens).toEqual(["tok-a", "tok-b", "tok-c"])
    expect(config.name).toBe("legacy")
    expect(config.ownerEmail).toBe("p@x.io")
    expect(config.note).toBe("migration batch")
  })
})

describe("formatTokenBanner", () => {
  it("contains exactly one Token: line with the plaintext", () => {
    const banner = formatTokenBanner(
      "jfp_search_ABC123abc456_aaaabbbbccccddddeeeeffffgggghhhhiiiijjjjkkk",
    )
    const tokenLines = banner
      .split("\n")
      .filter((l) => l.trim().startsWith("Token:"))
    expect(tokenLines).toHaveLength(1)
    expect(tokenLines[0]).toContain(
      "jfp_search_ABC123abc456_aaaabbbbccccddddeeeeffffgggghhhhiiiijjjjkkk",
    )
  })

  it("includes the save-this banner copy", () => {
    const banner = formatTokenBanner("jfp_search_xxx_yyy")
    expect(banner).toContain("SAVE THIS NOW")
    expect(banner).toContain("WILL NOT BE RETRIEVABLE LATER")
  })
})

describe("resolveOperatorId", () => {
  it("returns null when email is null", async () => {
    const findUnique = vi.fn()
    const id = await resolveOperatorId(null, { user: { findUnique } })
    expect(id).toBeNull()
    expect(findUnique).not.toHaveBeenCalled()
  })

  it("returns the User.id when email is found", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "user-abc" })
    const id = await resolveOperatorId("op@jfp.org", {
      user: { findUnique },
    })
    expect(id).toBe("user-abc")
    expect(findUnique).toHaveBeenCalledWith({
      where: { email: "op@jfp.org" },
      select: { id: true },
    })
  })

  it("warns and returns null when email is not found", async () => {
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true)
    const findUnique = vi.fn().mockResolvedValue(null)
    const id = await resolveOperatorId("ghost@jfp.org", {
      user: { findUnique },
    })
    expect(id).toBeNull()
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("ghost@jfp.org"),
    )
    writeSpy.mockRestore()
  })
})
