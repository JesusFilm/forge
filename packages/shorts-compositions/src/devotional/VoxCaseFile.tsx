import {
  at,
  Draw,
  GREEN,
  HAND,
  handEllipse,
  handLine,
  INK,
  Photo,
  prog,
  RED,
  SERIF,
  Written,
} from "./VoxBoard"
import type { TimedWord } from "./VoxLanguage"
import { SHORT_FONT_FAMILIES } from "../fonts"

/**
 * The history short as a charge sheet (owner, Paralytic 2026-10-20: "tell it
 * as the record of an accusation"). One form on aged paper over the dark,
 * grainy film; each field is filled in by hand as the voice reaches it, the
 * charge ringed in red, and the accused's photo pinned in last. A new method
 * for the insight rotation, after rough paper, clipping, board and notes over
 * film. Frame units 900 x 1600; the sheet keeps its text left of the phone's
 * right-hand rail (x <= 760) and ends above the captions (1130).
 */

export type CaseField = {
  label: string
  value: string
  /** The spoken word the value waits for ("blasphemy", "word#2"). */
  on: string | number
  color?: "ink" | "red"
  /** A red ring drawn round the value once it is written. */
  ring?: boolean
}

export type CaseFileSpec = {
  /** "CHARGE SHEET" / «ОБВИНЕНИЕ». */
  title: string
  /** A small line under the title ("Capernaum · Luke 5:21"). */
  caseLine?: string
  fields: CaseField[]
  accused?: {
    label: string
    /** The film still pinned in (staged beside the manifest). */
    photoFile: string
    on: string | number
    /** Handwritten beside the photo, with its own word. */
    note?: string
    noteOn?: string | number
    /** A green tick after the note ("they are right"). */
    tickOn?: string | number
  }
  /** The credit at the foot of the sheet. */
  source?: string
}

const SANS = `'${SHORT_FONT_FAMILIES.inter}', -apple-system, system-ui, sans-serif`
const PAPER = "#ece3cf"
const FADED = "#7a6a55"

const SHEET = { left: 110, top: 312, width: 680, height: 812 }
const PAD = 44
const ROW = 96
const FIELDS_TOP = 150

function paperIn(t: number): number {
  return prog(t, 0.25, 0.9)
}

export function VoxCaseFile({
  f,
  t,
  words,
  spec,
  outAt,
}: {
  f: (n: number) => number
  t: number
  words: ReadonlyArray<TimedWord>
  spec: CaseFileSpec
  /** The closing turn's arrival: the sheet steps back before it, so the
   *  turn is stamped over the film alone, never over the form. */
  outAt?: number
}) {
  const leave = outAt == null ? 0 : prog(t, outAt - 0.5, 0.7)
  const p = paperIn(t) * (1 - leave)
  const inner = SHEET.width - PAD * 2
  const accusedTop = FIELDS_TOP + spec.fields.length * ROW + 18
  return (
    <div
      style={{
        position: "absolute",
        left: f(SHEET.left),
        top: f(SHEET.top),
        width: f(SHEET.width),
        height: f(SHEET.height),
        opacity: p,
        transform: `translateY(${((1 - paperIn(t)) * f(40) - leave * f(30)).toFixed(2)}px) scale(${(1 - 0.04 * leave).toFixed(4)}) rotate(-1deg)`,
        background: `radial-gradient(120% 90% at 40% 30%, ${PAPER} 0%, #e2d6bb 70%, #d6c7a6 100%)`,
        boxShadow: `0 ${f(18)}px ${f(40)}px rgba(0,0,0,0.55)`,
      }}
    >
      {/* Title, case line and a double rule, set like an old court form. */}
      <div
        style={{
          position: "absolute",
          left: f(PAD),
          right: f(PAD),
          top: f(34),
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: SERIF,
            fontWeight: 700,
            fontSize: f(40),
            letterSpacing: f(7),
            textTransform: "uppercase",
            color: INK,
          }}
        >
          {spec.title}
        </div>
        {spec.caseLine ? (
          <div
            style={{
              marginTop: f(6),
              fontFamily: SANS,
              fontWeight: 500,
              fontSize: f(16),
              letterSpacing: f(3),
              textTransform: "uppercase",
              color: FADED,
            }}
          >
            {spec.caseLine}
          </div>
        ) : null}
        <div
          style={{
            marginTop: f(16),
            borderTop: `${f(2)}px solid ${INK}`,
            borderBottom: `${f(1)}px solid ${INK}`,
            height: f(5),
            opacity: 0.7,
          }}
        />
      </div>
      {spec.fields.map((field, i) => (
        <Field
          key={i}
          f={f}
          t={t}
          words={words}
          field={field}
          top={FIELDS_TOP + i * ROW}
          width={inner}
          seed={i + 1}
        />
      ))}
      {spec.accused ? (
        <Accused
          f={f}
          t={t}
          words={words}
          spec={spec.accused}
          top={accusedTop}
          width={inner}
        />
      ) : null}
      {spec.source ? (
        <div
          style={{
            position: "absolute",
            left: f(PAD),
            right: f(PAD),
            bottom: f(22),
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: f(19),
            color: FADED,
            textAlign: "center",
          }}
        >
          {spec.source}
        </div>
      ) : null}
    </div>
  )
}

/** One line of the form: the printed label, a dotted rule, and the value
 *  written over the rule when its word is said. */
function Field({
  f,
  t,
  words,
  field,
  top,
  width,
  seed,
}: {
  f: (n: number) => number
  t: number
  words: ReadonlyArray<TimedWord>
  field: CaseField
  top: number
  width: number
  seed: number
}) {
  const start = at(words, field.on, Infinity)
  const color = field.color === "red" ? RED : INK
  const size = 50
  // Caveat runs about 0.42 em a letter: the ring is sized to the word.
  const textW = Math.min(width, field.value.length * size * 0.42)
  const ringP = prog(t, start + Math.max(0.3, field.value.length / 22), 0.7)
  return (
    <div
      style={{
        position: "absolute",
        left: f(PAD),
        top: f(top),
        width: f(width),
        height: f(ROW),
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: f(15),
          letterSpacing: f(3),
          textTransform: "uppercase",
          color: FADED,
        }}
      >
        {field.label}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: f(84),
          borderTop: `${f(2)}px dotted rgba(29,23,18,0.35)`,
        }}
      />
      <div style={{ position: "absolute", left: f(8), top: f(18) }}>
        <Written
          t={t}
          start={start}
          text={field.value}
          style={{
            fontFamily: HAND,
            fontWeight: 700,
            fontSize: f(size),
            lineHeight: 1.1,
            color,
          }}
        />
      </div>
      {field.ring ? (
        <svg
          width={f(width)}
          height={f(ROW + 20)}
          viewBox={`0 0 ${width} ${ROW + 20}`}
          style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
        >
          <Draw
            d={handEllipse(8 + textW / 2, 52, textW / 2 + 26, 36, seed)}
            p={ringP}
            color={RED}
            width={4.5}
          />
        </svg>
      ) : null}
    </div>
  )
}

/** The accused: an empty pinned frame until the photo drops in, then the
 *  handwritten note and a green tick beside it. */
function Accused({
  f,
  t,
  words,
  spec,
  top,
  width,
}: {
  f: (n: number) => number
  t: number
  words: ReadonlyArray<TimedWord>
  spec: NonNullable<CaseFileSpec["accused"]>
  top: number
  width: number
}) {
  const shown = at(words, spec.on, Infinity)
  const drop = prog(t, shown, 0.55)
  const noteAt = at(words, spec.noteOn, shown + 0.6)
  const tickAt = at(words, spec.tickOn, Infinity)
  const photoW = 200
  return (
    <div
      style={{
        position: "absolute",
        left: f(PAD),
        top: f(top),
        width: f(width),
        height: f(250),
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: f(15),
          letterSpacing: f(3),
          textTransform: "uppercase",
          color: FADED,
        }}
      >
        {spec.label}
      </div>
      {/* The empty frame waiting for the photo. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: f(30),
          width: f(photoW + 28),
          height: f(photoW * 0.75 + 28),
          border: `${f(2)}px dashed rgba(29,23,18,0.35)`,
          opacity: 1 - drop,
        }}
      />
      {drop > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: f(30),
            opacity: drop,
            transform: `scale(${(1.12 - 0.12 * drop).toFixed(4)}) rotate(${(-4 + 2 * drop).toFixed(2)}deg)`,
            transformOrigin: "30% 20%",
          }}
        >
          <Photo
            f={f}
            file={spec.photoFile}
            width={photoW}
            ratio={0.75}
            focusX={58}
          />
        </div>
      ) : null}
      {spec.note ? (
        <div
          style={{
            position: "absolute",
            left: f(photoW + 56),
            top: f(54),
            width: f(width - photoW - 56),
          }}
        >
          <Written
            t={t}
            start={noteAt}
            text={spec.note}
            style={{
              fontFamily: HAND,
              fontWeight: 700,
              fontSize: f(40),
              lineHeight: 1.05,
              color: RED,
              whiteSpace: "pre-line",
            }}
          />
        </div>
      ) : null}
      {Number.isFinite(tickAt) ? (
        <svg
          width={f(width)}
          height={f(250)}
          viewBox={`0 0 ${width} 250`}
          style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
        >
          <Draw
            d={`${handLine(photoW + 60, 200, photoW + 82, 222, 0.05)} ${handLine(photoW + 82, 222, photoW + 124, 168, 0.04).replace("M", "L")}`}
            p={prog(t, tickAt, 0.45)}
            color={GREEN}
            width={6}
          />
        </svg>
      ) : null}
    </div>
  )
}
