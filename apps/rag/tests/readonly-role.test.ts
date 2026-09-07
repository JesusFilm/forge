import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { describe, expect, it } from "vitest"

import {
  assertReadonlyPrivileges,
  databaseUrlForRole,
  privilegeSummarySql,
  requireGeneratedPassword,
  requireRoleName,
} from "../scripts/lib/readonly-role.js"

const password = "a".repeat(64)
const execFileAsync = promisify(execFile)

describe("read-only role inputs", () => {
  it("accepts bounded role names and generated passwords", () => {
    expect(requireRoleName(undefined)).toBe("forge_rag_evaluator")
    expect(requireRoleName("rag_dashboard_reader")).toBe("rag_dashboard_reader")
    expect(requireGeneratedPassword(password)).toBe(password)
  })

  it.each(["postgres", "Uppercase", "role-name", "forge_rag_readonly"])(
    "rejects unsafe or reserved role %s",
    (role) => expect(() => requireRoleName(role)).toThrow(/refused/),
  )

  it.each(["short", "z".repeat(64), "A".repeat(64)])(
    "rejects a password outside the generated format",
    (value) => expect(() => requireGeneratedPassword(value)).toThrow(/refused/),
  )

  it("builds a reader URL without changing the target", () => {
    const result = new URL(
      databaseUrlForRole(
        "postgresql://owner:owner-secret@localhost:5435/forge_rag?schema=public",
        "forge_rag_evaluator",
        password,
      ),
    )
    expect(result.username).toBe("forge_rag_evaluator")
    expect(result.password).toBe(password)
    expect(result.hostname).toBe("localhost")
    expect(result.pathname).toBe("/forge_rag")
    expect(result.searchParams.get("schema")).toBe("public")
  })

  it("redacts connection and password values when provisioning fails", async () => {
    const connectionSecret = "connection-secret"
    try {
      await execFileAsync(
        "pnpm",
        ["exec", "tsx", "scripts/provision-readonly.ts", "--local"],
        {
          cwd: new URL("..", import.meta.url),
          env: {
            DATABASE_URL: `postgresql://owner:${connectionSecret}@127.0.0.1:1/rag`,
            JFRAG_READONLY_PASSWORD: password,
            PATH: process.env.PATH,
          },
        },
      )
      throw new Error("expected provisioning to fail")
    } catch (error) {
      const result = error as { stdout?: string; stderr?: string }
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
      expect(output).toContain("details redacted")
      expect(output).not.toContain(connectionSecret)
      expect(output).not.toContain(password)
    }
  })
})

describe("read-only privilege contract", () => {
  it("checks role attributes, ownership, grants, and memberships", () => {
    const sql = privilegeSummarySql("forge_rag_evaluator")
    expect(sql).toContain("rolbypassrls")
    expect(sql).toContain("has_database_privilege")
    expect(sql).toContain("has_schema_privilege")
    expect(sql).toContain("has_table_privilege")
    expect(sql).toContain("has_sequence_privilege")
    expect(sql).toContain("prosecdef")
    expect(sql).toContain("pg_has_role")
  })

  it("accepts only the zero-write, forced-read-only result", () => {
    const valid = {
      transaction_read_only: true,
      elevated_role_attributes: false,
      database_create: false,
      database_temporary: false,
      writable_schemas: 0n,
      owned_schemas: 0n,
      writable_relations: 0n,
      owned_relations: 0n,
      writable_sequences: 0n,
      executable_security_definer_functions: 0n,
      unexpected_memberships: 0n,
    }
    expect(() => assertReadonlyPrivileges(valid)).not.toThrow()
    expect(() =>
      assertReadonlyPrivileges({ ...valid, writable_relations: 1n }),
    ).toThrow(/writable_relations/)
  })
})
