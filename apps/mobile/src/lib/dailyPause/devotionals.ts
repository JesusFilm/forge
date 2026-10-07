// The two devotionals of the Daily Bible Pause (R39, R40). The screen text
// copies each video's own words, so the screen and the video never disagree.
// The part ranges come from U3's timeline, the cut points of the encoded video.
import { Asset } from "expo-asset"
import { useEffect, useState } from "react"

import { withTimeout } from "../withTimeout"
import timeline from "./devotionalTimeline.json"

export type DevotionalId = "pharisee" | "lamp"

/** The three video parts, in the order they play. */
export type DevotionalPart = "film" | "teaching" | "prayer"

export type PartRange = { startSec: number; endSec: number }

export type Devotional = {
  id: DevotionalId
  /** A short name, for the shared file name. */
  name: string
  passage: string
  /** The Opening's question. */
  question: string
  /** The verse that the teaching part ends on. */
  verse: string
  verseLabel: string
  prayerPrompt: string
  attribution: string
  parts: Readonly<Record<DevotionalPart, PartRange>>
  /** The Metro asset module of the bundled video. */
  video: number
}

/* eslint-disable @typescript-eslint/no-require-imports */
const PHARISEE_VIDEO: number = require("../../../assets/devotionals/pharisee.mp4")
const LAMP_VIDEO: number = require("../../../assets/devotionals/lamp.mp4")
/* eslint-enable @typescript-eslint/no-require-imports */

export const DEVOTIONALS: Readonly<Record<DevotionalId, Devotional>> = {
  pharisee: {
    id: "pharisee",
    name: "Pharisee",
    passage: "Luke 18:9-14",
    question: "How are we commanded to pray?",
    verse:
      "I tell you, this man, rather than the Pharisee, went home justified. For everyone who exalts himself will be humbled, but the one who humbles himself will be exalted.",
    verseLabel: "LUKE 18:14 · BSB",
    prayerPrompt:
      "Bring your honest need to God right now and ask him for mercy.",
    attribution: "Adapted from a trusted classic · J.C.\u00a0Ryle, 1858",
    parts: timeline.pharisee.parts,
    video: PHARISEE_VIDEO,
  },
  lamp: {
    id: "lamp",
    name: "Lamp",
    passage: "Luke 8:16-18",
    question:
      "Where is one place this week you can let someone see what Christ has done in you?",
    verse:
      "No one, when he has lit a lamp, covers it with a container, or puts it under a bed; but puts it on a stand, that those who enter in may see the light.",
    verseLabel: "LUKE 8:16",
    prayerPrompt:
      "Ask God to show you one person who needs to see the light he's given you.",
    attribution: "Adapted from a trusted classic · J.C.\u00a0Ryle",
    parts: timeline.lamp.parts,
    video: LAMP_VIDEO,
  },
}

export type DevotionalVideoState =
  | { status: "loading" }
  | { status: "ready"; uri: string }
  | { status: "error" }

type Resolved = Exclude<DevotionalVideoState, { status: "loading" }>

const LOADING: DevotionalVideoState = { status: "loading" }

/** A file that has not resolved by now reads as an error, so the part can
 *  offer Try again instead of a black screen. */
export const DEVOTIONAL_VIDEO_DEADLINE_MS = 8_000

/** Never rejects. */
async function resolveVideo(devotional: Devotional): Promise<Resolved> {
  try {
    const { localUri } = await withTimeout(
      Asset.fromModule(devotional.video).downloadAsync(),
      DEVOTIONAL_VIDEO_DEADLINE_MS,
    )
    return localUri ? { status: "ready", uri: localUri } : { status: "error" }
  } catch {
    return { status: "error" }
  }
}

/** The local file of a devotional's video. The player freezes its first
 *  source, so a caller mounts the player only when this reads `ready`. A new
 *  `attempt` loads the file again, for a Try again after an error. */
export function useDevotionalVideo(
  devotional: Devotional,
  attempt = 0,
): DevotionalVideoState {
  const [resolved, setResolved] = useState<{
    key: string
    state: Resolved
  } | null>(null)
  const key = `${devotional.id}:${attempt}`

  useEffect(() => {
    let current = true
    void resolveVideo(devotional).then((state) => {
      if (current) setResolved({ key, state })
    })
    return () => {
      current = false
    }
  }, [devotional, key])

  // A state for another devotional or attempt is stale: the new one loads.
  return resolved?.key === key ? resolved.state : LOADING
}
