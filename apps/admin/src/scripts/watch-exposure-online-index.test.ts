import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  assertActionState,
  assertOperatorDatabaseUrl,
  parseExposureIndexArgs,
  writeAttemptReceipt,
} from "./watch-exposure-online-index"

const wide = {
  name: "watch_surface_exposure_window_item_idx",
  keys: [
    "window_id",
    "surface",
    "block",
    "presentation",
    "placement",
    "position",
    "item_path",
    "kind",
  ],
  valid: true,
  ready: true,
  live: true,
  unique: false,
  primary: false,
  exclusion: false,
  keyCount: 8,
  attributeCount: 8,
  method: "btree",
  predicate: null,
  expressions: null,
  constraintName: null,
  bytes: "100",
  definition:
    'CREATE INDEX watch_surface_exposure_window_item_idx ON public.watch_surface_exposure USING btree (window_id, surface, block, presentation, placement, "position", item_path, kind)',
}
const narrow = {
  ...wide,
  name: "watch_surface_exposure_window_item_narrow_idx",
  keys: wide.keys.slice(0, 6),
  keyCount: 6,
  attributeCount: 6,
  definition:
    'CREATE INDEX watch_surface_exposure_window_item_narrow_idx ON public.watch_surface_exposure USING btree (window_id, surface, block, presentation, placement, "position")',
}
const state = {
  targetHash: "a".repeat(64),
  schema: "public",
  tableExists: true,
  candidateNameOccupied: false,
  indexes: [wide],
  activeBuilds: 0,
  lockWaiters: 0,
  oldTransactions: 0,
  tableBytes: "1000",
  totalBytes: "2000",
  walLsn: "1/1",
}

describe("Watch exposure online index operator guards", () => {
  it("persists a private one-shot receipt before any DDL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "exposure-receipt-"))
    const path = join(directory, "attempt.json")
    await writeAttemptReceipt(path, { action: "create-narrow" })
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      action: "create-narrow",
    })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    await expect(
      writeAttemptReceipt(path, { action: "drop-wide" }),
    ).rejects.toThrow()
  })

  it("is dry-run by default and needs all four exact admission values to execute", () => {
    expect(parseExposureIndexArgs(["create-narrow"]).execute).toBe(false)
    expect(parseExposureIndexArgs(["inspect"]).execute).toBe(false)
    expect(() => parseExposureIndexArgs(["inspect", "--execute"])).toThrow()
    expect(() => parseExposureIndexArgs(["drop-wide", "--execute"])).toThrow()
    expect(
      parseExposureIndexArgs([
        "create-narrow",
        "--execute",
        `--target=${"a".repeat(64)}`,
        `--source=${"b".repeat(64)}`,
        `--revision=${"c".repeat(40)}`,
        "--receipt=/tmp/one-shot.json",
      ]).execute,
    ).toBe(true)
    for (const args of [
      ["create-narrow", "--execute", "--target=bad"],
      ["drop-wide", "--execute=true"],
      ["drop-wide", "--receipt=relative.json"],
      ["create-narrow", "--execute", "--execute"],
    ])
      expect(() => parseExposureIndexArgs(args)).toThrow()
  })

  it("rejects connection-string host overrides and fragments", () => {
    expect(() =>
      assertOperatorDatabaseUrl(
        "postgresql://forge:secret@127.0.0.1:32790/owned",
      ),
    ).not.toThrow()
    for (const suffix of [
      "?host=elsewhere",
      "?HOST=elsewhere",
      "?hostaddr=1.2.3.4",
      "?port=5432",
      "?dbname=other",
      "#fragment",
    ])
      expect(() =>
        assertOperatorDatabaseUrl(
          `postgresql://forge:secret@127.0.0.1:32790/owned${suffix}`,
        ),
      ).toThrow()
  })

  it("requires exact old and candidate catalog shapes", () => {
    expect(() => assertActionState("create-narrow", state)).not.toThrow()
    expect(() =>
      assertActionState("drop-wide", { ...state, indexes: [wide, narrow] }),
    ).not.toThrow()
    for (const malformed of [
      { ...wide, valid: false },
      { ...wide, ready: false },
      { ...wide, constraintName: "some_constraint" },
      { ...wide, keys: [...wide.keys].reverse() },
      { ...wide, predicate: "kind = 'served'" },
      { ...wide, unique: true },
      { ...wide, definition: wide.definition + " DESC" },
    ])
      expect(() =>
        assertActionState("create-narrow", { ...state, indexes: [malformed] }),
      ).toThrow()
    expect(() =>
      assertActionState("create-narrow", {
        ...state,
        indexes: [wide, { ...narrow, valid: false }],
      }),
    ).toThrow(/already exists/)
    expect(() =>
      assertActionState("create-narrow", {
        ...state,
        candidateNameOccupied: true,
      }),
    ).toThrow(/already exists/)
    expect(() =>
      assertActionState("drop-wide", { ...state, indexes: [wide] }),
    ).toThrow()
    expect(() =>
      assertActionState("drop-wide", {
        ...state,
        indexes: [wide, { ...narrow, valid: false }],
      }),
    ).toThrow()
  })

  it("blocks mutation on live conflicts but keeps inspect diagnostic", () => {
    for (const delta of [
      { activeBuilds: 1 },
      { lockWaiters: 1 },
      { oldTransactions: 1 },
      { schema: "other" },
      { tableExists: false },
    ]) {
      expect(() =>
        assertActionState("create-narrow", { ...state, ...delta }),
      ).toThrow()
      expect(() =>
        assertActionState("inspect", { ...state, ...delta }),
      ).not.toThrow()
    }
  })
})
