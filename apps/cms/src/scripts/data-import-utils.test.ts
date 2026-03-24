import { describe, expect, it } from "vitest"

import {
  formatBytes,
  parseConnectionString,
  shouldKeepLine,
} from "./data-import-utils"

describe("parseConnectionString", () => {
  it("parses a full connection string", () => {
    const result = parseConnectionString(
      "postgres://admin:s3cret@db.railway.app:5432/strapi_prod?sslmode=require",
    )
    expect(result).toEqual({
      host: "db.railway.app",
      port: "5432",
      user: "admin",
      database: "strapi_prod",
      password: "s3cret",
      sslmode: "require",
    })
  })

  it("defaults port to 5432 when omitted", () => {
    const result = parseConnectionString("postgres://user:pass@host/mydb")
    expect(result.port).toBe("5432")
  })

  it("defaults sslmode to prefer when omitted", () => {
    const result = parseConnectionString("postgres://user:pass@host:5432/mydb")
    expect(result.sslmode).toBe("prefer")
  })

  it("handles URL-encoded password characters", () => {
    const result = parseConnectionString(
      "postgres://user:p%40ss%23word@host:5432/db",
    )
    expect(result.password).toBe("p@ss#word")
  })

  it("decodes URL-encoded username", () => {
    const result = parseConnectionString(
      "postgres://user%40org:pass@host:5432/db",
    )
    expect(result.user).toBe("user@org")
  })

  it("handles empty password", () => {
    const result = parseConnectionString("postgres://user:@host:5432/db")
    expect(result.password).toBe("")
  })
})

describe("shouldKeepLine", () => {
  describe("keeps normal SQL", () => {
    it("keeps INSERT statements", () => {
      expect(
        shouldKeepLine("INSERT INTO videos (id, title) VALUES (1, 'test');"),
      ).toBe(true)
    })

    it("keeps CREATE TABLE statements", () => {
      expect(
        shouldKeepLine("CREATE TABLE videos (id serial PRIMARY KEY);"),
      ).toBe(true)
    })

    it("keeps SELECT statements", () => {
      expect(shouldKeepLine("SELECT 1;")).toBe(true)
    })

    it("keeps SET statements", () => {
      expect(shouldKeepLine("SET search_path = public;")).toBe(true)
    })

    it("keeps empty lines", () => {
      expect(shouldKeepLine("")).toBe(true)
    })

    it("keeps SQL comments", () => {
      expect(shouldKeepLine("-- This is a comment")).toBe(true)
    })

    it("keeps ALTER TABLE statements", () => {
      expect(shouldKeepLine("ALTER TABLE videos ADD COLUMN slug text;")).toBe(
        true,
      )
    })
  })

  describe("strips CREATE PUBLICATION", () => {
    it("strips basic CREATE PUBLICATION", () => {
      expect(shouldKeepLine("CREATE PUBLICATION my_pub FOR ALL TABLES;")).toBe(
        false,
      )
    })

    it("strips with leading whitespace", () => {
      expect(
        shouldKeepLine("  CREATE PUBLICATION my_pub FOR TABLE videos;"),
      ).toBe(false)
    })

    it("strips case-insensitively", () => {
      expect(shouldKeepLine("create publication my_pub FOR ALL TABLES;")).toBe(
        false,
      )
    })
  })

  describe("strips ALTER PUBLICATION", () => {
    it("strips ALTER PUBLICATION", () => {
      expect(shouldKeepLine("ALTER PUBLICATION my_pub ADD TABLE videos;")).toBe(
        false,
      )
    })

    it("strips case-insensitively", () => {
      expect(shouldKeepLine("alter publication my_pub SET TABLE videos;")).toBe(
        false,
      )
    })
  })

  describe("strips psql meta-commands", () => {
    it("strips \\connect", () => {
      expect(shouldKeepLine("\\connect mydb")).toBe(false)
    })

    it("strips \\set", () => {
      expect(shouldKeepLine("\\set ON_ERROR_STOP on")).toBe(false)
    })

    it("strips \\encoding", () => {
      expect(shouldKeepLine("\\encoding UTF8")).toBe(false)
    })
  })

  describe("keeps allowed meta-commands", () => {
    it("keeps \\. (COPY terminator)", () => {
      expect(shouldKeepLine("\\.")).toBe(true)
    })

    it("keeps \\copy", () => {
      expect(shouldKeepLine("\\copy videos FROM stdin;")).toBe(true)
    })

    it("keeps \\COPY (case-insensitive)", () => {
      expect(shouldKeepLine("\\COPY videos FROM stdin;")).toBe(true)
    })
  })
})

describe("formatBytes", () => {
  it("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B")
  })

  it("formats bytes", () => {
    expect(formatBytes(500)).toBe("500 B")
  })

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB")
  })

  it("formats megabytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB")
  })

  it("formats gigabytes", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB")
  })

  it("formats fractional values", () => {
    expect(formatBytes(1536)).toBe("1.5 KB")
  })

  it("formats large values with decimals", () => {
    const size = 52.7 * 1024 * 1024
    expect(formatBytes(size)).toBe("52.7 MB")
  })
})
