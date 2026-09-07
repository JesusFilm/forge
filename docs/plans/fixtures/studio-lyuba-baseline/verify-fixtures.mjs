// Run with tsx; executes only pure recovered functions, never provider/render entrypoints.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"
const root = process.argv[2]
const service = path.join(root, "apps/mastra/src/services/devotional")
const load = (name) => import(pathToFileURL(path.join(service, name + ".ts")))
const { buildNarrationSegments } = await load("devotional-audio")
const { splitReflection } = await load("reflection-split")
const { EN_LOCALE } = await load("devotional-locale")
const { textFingerprint } = await load("devotional-text-approval")
const { fetchEditedWindow, mapCuesToEditedTimeline, findActBreak } =
  await load("subtitle-align")
const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url)))
const saved = read("saved-scripts.json")
const expected = read("acceptance.json")
const hash = (segments) =>
  createHash("sha256")
    .update(JSON.stringify(segments.map(({ id, text }) => ({ id, text }))))
    .digest("hex")
for (const fixture of expected.cases) {
  test(`saved ${fixture.id}: sentence cards, speech, settle-line invalidation`, () => {
    const source = saved.find((s) => s.id === fixture.id)
    assert.equal(source.sha256, fixture.sourceSha256)
    assert.deepEqual(
      splitReflection(source.script.reflection.text),
      fixture.reflectionCards,
    )
    const speech = buildNarrationSegments(
      source.script,
      EN_LOCALE,
      fixture.options,
    )
    assert.deepEqual(speech, fixture.spoken)
    assert.equal(hash(speech), fixture.spokenSha256)
    const changed = buildNarrationSegments(source.script, EN_LOCALE, {
      ...fixture.options,
      settleLine: fixture.changedSettleLine,
    })
    assert.equal(hash(changed), fixture.changedSpokenSha256)
    assert.notEqual(hash(changed), hash(speech))
    assert.notEqual(
      textFingerprint(changed.map((s) => s.text)),
      textFingerprint(speech.map((s) => s.text)),
    )
  })
}
test("closing quote ends a card, keeping the next sentence separate", () => {
  assert.deepEqual(
    splitReflection("He asked, 'Where is your faith?' That's the question."),
    ["He asked, 'Where is your faith?'", "That's the question."],
  )
})
test("recovered subtitle refusal keeps cues and pulls start back (synthetic historical example)", async () => {
  const srt =
    "1\n00:00:37,900 --> 00:00:42,400\nIn Jericho there was a tax collector.\n\n2\n00:01:00,600 --> 00:01:02,600\nZacchaeus, hurry and come down.\n"
  const result = await fetchEditedWindow("fixture", 39, 30, {
    fetchFn: async () => ({ ok: true, text: async () => srt }),
  })
  assert.equal(result.snapped, false)
  assert.equal(result.startSec, 37.9)
  assert.equal(result.lengthSec, 30)
  assert.equal(result.cues.length, 2)
  assert.equal(
    await fetchEditedWindow("fixture", 39, 30, {
      fetchFn: async () => ({ ok: false }),
    }),
    null,
  )
})
test("subtitle cuts preserve source mapping and act boundaries never overlap", () => {
  const result = mapCuesToEditedTimeline(
    [
      { start: 10, end: 14, text: "First." },
      { start: 40, end: 44, text: "Second." },
    ],
    [
      { startSec: 10, lengthSec: 6 },
      { startSec: 38, lengthSec: 8 },
    ],
    1,
  )
  assert.deepEqual(
    result.map((c) => [c.startSec, c.endSec]),
    [
      [0, 4],
      [8, 12],
    ],
  )
  const split = findActBreak(
    [
      { start: 40, end: 50, text: "First." },
      { start: 54, end: 60, text: "Second." },
    ],
    39,
    40,
    4,
    3,
  )
  assert.ok(split.act1EndSec <= split.act2StartSec)
})

test("recovered background arithmetic: shared offsets and episode-only restart (not React/render proof)", async () => {
  const { runInNewContext } = await import("node:vm")
  const fixture = read("background.json")
  const composition = readFileSync(
    path.join(
      root,
      "packages/shorts-compositions/src/devotional/DevotionalVideo.tsx",
    ),
    "utf8",
  )
  const start = composition.indexOf(
    "  const bgRate = props.bgPlaybackRate ?? 1",
  )
  const end = composition.indexOf("\n  return (", start)
  assert.ok(start >= 0 && end > start, "recovered arithmetic seam must exist")
  for (const scenario of fixture.cases) {
    const result = runInNewContext(
      composition.slice(start, end) + "\nJSON.stringify(bgStartFrames)",
      {
        props: {
          ...scenario,
          cards: fixture.cardKinds.map((kind) => ({ kind })),
        },
        frames: fixture.durationInFrames.map((durationInFrames) => ({
          durationInFrames,
        })),
      },
    )
    assert.deepEqual(JSON.parse(result), scenario.expectedSourceStartFrames)
  }
  const renderer = readFileSync(
    path.join(service, "devotional-render.ts"),
    "utf8",
  )
  const restartStart = renderer.indexOf("  const hasReflection =")
  const restartEnd = renderer.indexOf("  const bgSegments =", restartStart)
  assert.ok(restartStart >= 0 && restartEnd > restartStart)
  for (const episode of [false, true]) {
    const result = runInNewContext(
      renderer.slice(restartStart, restartEnd) + "\nbgRestartAtSec",
      {
        options: { episode },
        manifest: { cards: fixture.restart.cards },
        INTRO_HOLD_SEC: fixture.restart.introHoldSec,
        CARD_TAIL_SEC: fixture.restart.cardTailSec,
      },
    )
    assert.equal(
      result,
      episode
        ? fixture.restart.episodeRestartAtSec
        : fixture.restart.fullDevotionalRestartAtSec,
    )
  }
})
