/**
 * Deterministic checks on the finished reflection's VOICE.
 *
 * Three owner rules kept coming back after being fixed in the prompt: no
 * commands, no altar call, and stay with the viewer rather than drifting to
 * third parties. Each was corrected in `reflection-modernizer.ts` and each
 * reappeared a run or two later in a new disguise — 'we must' became 'never
 * despise' became 'we should never despise'. A prompt is a probability, so a
 * rule enforced only there fails a few percent of the time forever, and the
 * failures land in a video nobody re-reads.
 *
 * These are cheap string checks, run before narration. They cannot judge
 * quality, and they are deliberately narrow: every pattern here matches a
 * phrasing that has ACTUALLY come out of the pipeline, not a hypothetical one.
 * False positives are worse than misses, because a gate people learn to
 * override is not a gate.
 */

export type VoiceFinding = {
  rule:
    | "command"
    | "appeal"
    | "third-party"
    | "self-echo"
    | "opens-on-recap"
    | "scripture-echo"
  /** The offending sentence, for the operator. */
  sentence: string
  why: string
}

/**
 * Sentence split that keeps abbreviations and quoted speech in one piece.
 *
 * `\p{Lu}` rather than `[A-Z]`: the ASCII class silently refused to split
 * Russian at all, since «В» is not in A-Z. The whole localized reflection
 * arrived here as ONE sentence, so every start-anchored rule had nothing to
 * anchor to and the check reported clean. Unchanged for English — A-Z is a
 * subset of `\p{Lu}`.
 */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[\p{Lu}“"'«])/u)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Collective commands. 'We must', 'we should', 'let us' — the author's own
 * register, and the form the modernizer strips least reliably because it reads
 * as gentle.
 */
const COLLECTIVE =
  /\b(?:we (?:must|should|ought to|need to)|let us|let's)\s+\w/i

/**
 * Bare imperatives, anchored to sentence start. Only verbs the pipeline has
 * actually emitted, because a general "starts with a verb" test flags ordinary
 * narration ("Look at Zacchaeus" is fine; it points at the screen).
 */
const IMPERATIVE_VERBS =
  "never|always|remember|consider|do not|don't|stop|start|turn|hold|give|ask yourself"
/**
 * A leading clause hides the imperative from a `^`-anchored test. The generated
 * conclusion "In every storm, remember that Jesus is with you" is a command
 * with four words in front of it, and it shipped because of the anchor.
 */
const BARE_IMPERATIVE = new RegExp(
  `^(?:[^,]{0,40},\\s*)?(?:${IMPERATIVE_VERBS})\\b`,
  "i",
)

/** The altar call wearing a conditional: "…if he will only come to Christ". */
const CONDITIONAL_APPEAL =
  /\bif\s+(?:\w+\s+){0,4}(?:will\s+)?(?:only|just|simply)\b/i

/**
 * Named invitations. These words also occur in plain narration — "Christ
 * called him to come down and receive him" is the story, not an altar call —
 * so a match only counts when the sentence is ADDRESSED to the listener, or to
 * a generic class the listener could belong to. Six generations in a row were
 * rejected on that narration sentence before this distinction existed, which
 * is exactly the failure mode this file's header warns about.
 */
const DIRECT_APPEAL =
  /\b(?:come to (?:him|jesus|christ)|open the door|receive him|only believe)\b/i
const ADDRESSES_LISTENER =
  /\b(?:you|your|yourself|any sinner|anyone|whoever|the vilest|sinners)\b/i

/**
 * Drift to a third party. Matches the shape the pipeline produces — a
 * hypothetical stranger whose spiritual prospects the viewer is asked to weigh.
 */
const THIRD_PARTY =
  /\b(?:someone|anyone|a person|a friend|people)\b[^.!?]*\b(?:who|that)\b[^.!?]*\b(?:begins?|starts?|listens?|seems?|feels?|may go|might go|needs? to hear)\b/i
const THIRD_PARTY_TAIL =
  /\bwho can tell how far\b|\bthey may (?:go|come) (?:further|to)\b/i
/**
 * ...unless the sentence lands back on the viewer. A hypothetical can be the
 * SUBJECT of an example while the claim is still addressed to the person
 * watching, and the rule was flagging one of those in the reflection the owner
 * actually kept: a wealthy man giving away riches, "and you know something has
 * changed". The drift this rule exists to catch never turns to the viewer —
 * that is what makes it drift.
 */
const SECOND_PERSON = /\b(?:you|your|yours|yourself)\b/i

/** Words, lowercased, punctuation stripped — for comparing phrasing not typography. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * The longest run of words the reflection repeats within itself.
 *
 * Ryle repeats the disciples' cry for emphasis on the page, where a reader's
 * eye can skim it. Spoken, over a clip in which the same line is audible, the
 * viewer hears it three times in ninety seconds.
 *
 * Measured as a repeated word run rather than a repeated QUOTE, which is both
 * sturdier (quote pairing is at the mercy of apostrophes) and broader — saying
 * the same line twice without quote marks is the same defect.
 */
function repeatedRun(text: string): string[] {
  const w = wordsOf(text)
  const at = new Map<string, number[]>()
  w.forEach((word, i) => {
    const hits = at.get(word)
    if (hits) hits.push(i)
    else at.set(word, [i])
  })
  let best: string[] = []
  for (let i = 0; i < w.length; i++) {
    for (const j of at.get(w[i]) ?? []) {
      if (j <= i) continue
      let n = 0
      while (j + n < w.length && w[i + n] === w[j + n]) n++
      if (n > best.length) best = w.slice(i, i + n)
    }
  }
  return best
}

/**
 * A repeated run this long is a line said twice, not a turn of phrase.
 *
 * Measured on the pipeline's own output, not chosen. The reflection the owner
 * kept repeats at most 3 words; the one she rejected repeats 9. The commentator
 * also builds deliberate parallels ("a priest came by and saw him… a Levite
 * came by and saw him"), which reach 5 words and are the argument rather than a
 * slip. Seven clears those and still catches a line said twice.
 */
const SELF_ECHO_WORDS = 7

/**
 * The same rule, counted in Russian words.
 *
 * NOT a translation of the number — a re-derivation, because Russian says the
 * same line in fewer words. The cry that runs five words in English ("we are
 * going to die") is two in Russian («мы погибаем»), so keeping 7 would let
 * through repeats far longer than the English threshold catches. Five is the
 * proportional equivalent and is UNCALIBRATED: unlike the English figure, no
 * Russian output was measured to place it. Re-derive it against real localized
 * text the first time any exists.
 */
const SELF_ECHO_WORDS_RU = 5

/**
 * Quoted spans of 12+ characters, lowercased.
 *
 * An apostrophe inside a word is the same character as a single quote mark, so
 * "we're" silently cut every span it appeared in and the pairing came out
 * scrambled. Mask those first: a quote character only delimits when it is not
 * sitting between two letters.
 */
function quotedSpans(text: string): string[] {
  // A sentinel that cannot occur in real copy. Private-use rather than a
  // control character: both are absent from prose, but a control character in
  // a regex is a lint error and harder to spot in a debugger besides.
  const APOSTROPHE_SENTINEL = "\uE000"
  const masked = text.replace(
    /(\p{L})['’](\p{L})/gu,
    `$1${APOSTROPHE_SENTINEL}$2`,
  )
  return [...masked.matchAll(/['‘’"“”]([^'‘’"“”]{12,})['‘’"“”]/g)].map((m) =>
    m[1].split(APOSTROPHE_SENTINEL).join("'").trim().toLowerCase(),
  )
}

/** The longest run of words two texts share. */
function longestSharedRun(a: string[], b: string[]): string[] {
  const index = new Map<string, number[]>()
  b.forEach((w, i) => {
    const at = index.get(w)
    if (at) at.push(i)
    else index.set(w, [i])
  })
  let best: string[] = []
  for (let i = 0; i < a.length; i++) {
    for (const j of index.get(a[i]) ?? []) {
      let n = 0
      while (i + n < a.length && j + n < b.length && a[i + n] === b[j + n]) n++
      if (n > best.length) best = a.slice(i, i + n)
    }
  }
  return best
}

/**
 * Shared-run thresholds, in words.
 *
 * PROSE is high because commentary legitimately reuses the passage's nouns.
 * QUOTE is low because both sides are already known to be DIALOGUE, which
 * removes almost all the noise: the verse card reads "Master, master, we are
 * dying" and a generated reflection said "Master, Master, we're going to die",
 * which shares only three words but is the same line to the ear — and the
 * film's own audio speaks it a third time.
 */
const ECHO_RUN_PROSE = 5
const ECHO_RUN_QUOTE = 3

/**
 * What the reflection takes from the verse on screen.
 *
 * Checked at two grains, dialogue first. A quoted line matched against the
 * verse's own quoted line needs only a short run to count, because both sides
 * are speech; loose prose needs a long one.
 */
function scriptureEcho(text: string, scripture: string): VoiceFinding | null {
  const verseQuotes = quotedSpans(scripture)
  for (const said of quotedSpans(text)) {
    for (const verse of verseQuotes) {
      const run = longestSharedRun(wordsOf(said), wordsOf(verse))
      if (run.length >= ECHO_RUN_QUOTE) {
        return {
          rule: "scripture-echo",
          sentence: said,
          why:
            `voices the line the verse card already shows (“${run.join(" ")}”), ` +
            `which the film's own audio speaks too. Comment on the scene, do not say it again`,
        }
      }
    }
  }
  const run = longestSharedRun(wordsOf(text), wordsOf(scripture))
  if (run.length >= ECHO_RUN_PROSE) {
    return {
      rule: "scripture-echo",
      sentence: run.join(" "),
      why:
        `repeats ${run.length} words straight from the verse on screen. ` +
        `Comment on the scene, do not retell it`,
    }
  }
  return null
}

/**
 * A general claim, as opposed to a report of what happened in the scene.
 *
 * Present tense is the tell. Commentary asserts something that is true now
 * ("grace does not wait to be asked"); recap reports something that happened
 * ("water was filling the boat"). The verb list is curated rather than a
 * general present-tense test, because a bare "-s" ending matches far too much.
 */
const PRESENT_CLAIM =
  /\b(?:is|isn't|are|aren't|am|do|does|don't|doesn't|makes?|means?|shows?|teaches?|tells?|remains?|stands?|has|have|will|can|cannot|can't|costs?|matters?|belongs?|needs?|becomes?|rests?|holds?|hates?|wants?|sees?|lives?|knows?)\b/i

/** Opening sentences allowed to pass before a claim must appear. */
const CLAIM_BY_SENTENCE = 2

/**
 * Sentences below which this is not a reflection and the opening rule does not
 * apply. A real one runs 15 to 22 sentences; a short string is a fragment, and
 * judging its "opening" produces noise.
 */
const MIN_REFLECTION_SENTENCES = 5

/** Past-tense narration: the scene being reported rather than commented on. */
const PAST_IRREGULAR =
  /\b(?:was|were|came|went|woke|awoke|cried|said|saw|took|gave|found|forgot|fell|ran|began|told|left|knew|made|brought|stood|sat|lay|rose|spoke|declared|murmured)\b/i
const PAST_ED = /\b\w{3,}ed\b/i
/** First or second person: the reflection talking WITH the viewer, not narrating. */
const ADDRESSES = /\b(?:we|us|our|you|your|yourself|ourselves|i|me|my)\b/i

/**
 * Does the reflection open by setting up a scene the viewer has just watched?
 *
 * This threshold is not a guess, and the obvious measure failed. "Share of
 * narration sentences" pointed the WRONG way: the reflection the owner kept is
 * about 60% narration and the one she rejected only 28%, because narration that
 * carries the argument is not recap — the commentator walks through the events
 * precisely because that is where his point lives. What separated them was
 * where the retelling SAT. The kept one opens on a claim in its first sentence;
 * the rejected one spends three sentences establishing a situation the viewer
 * has just watched before it says anything.
 *
 * So the rule is about the OPENING only, and narration after it is free.
 */
function opensOnRecap(all: string[]): VoiceFinding | null {
  if (all.length < MIN_REFLECTION_SENTENCES) return null
  const lead = all.slice(0, CLAIM_BY_SENTENCE)
  if (lead.some((s) => PRESENT_CLAIM.test(s))) return null
  // Absence of a claim is not enough on its own — the opening has to actually
  // be reporting the scene. Requiring both keeps the rule off openings that
  // simply use a verb form this file does not list.
  const narrates = (s: string) =>
    !ADDRESSES.test(s) && (PAST_IRREGULAR.test(s) || PAST_ED.test(s))
  if (!lead.some(narrates)) return null
  return {
    rule: "opens-on-recap",
    sentence: lead[0],
    why:
      `opens by setting up the scene instead of saying something about it, and ` +
      `the viewer has just watched that scene. Lead with the claim`,
  }
}

/**
 * The command and appeal rules, per sentence.
 *
 * Split out because they apply to the CONCLUSION too. The conclusion had no
 * checks at all until a generated one read "in every storm, remember that
 * Jesus is with you" — a bare imperative, in the last line the viewer hears,
 * shipped past a gate that by construction could not see it. The reflection is
 * the long part, so it got the attention; the conclusion is the part anyone
 * remembers.
 */
function checkCommandsAndAppeals(all: string[]): VoiceFinding[] {
  const found: VoiceFinding[] = []
  for (const s of all) {
    if (COLLECTIVE.test(s)) {
      found.push({
        rule: "command",
        sentence: s,
        why: "collective command ('we must', 'let us') — state the claim it rests on instead",
      })
      continue
    }
    if (BARE_IMPERATIVE.test(s)) {
      found.push({
        rule: "command",
        sentence: s,
        why: "bare imperative — a synthetic voice has no standing to give orders",
      })
      continue
    }
    if (
      CONDITIONAL_APPEAL.test(s) ||
      (DIRECT_APPEAL.test(s) && ADDRESSES_LISTENER.test(s))
    ) {
      found.push({
        rule: "appeal",
        sentence: s,
        why: "altar call — the audience already follows Jesus; keep the claim, drop the invitation",
      })
      continue
    }
    if (
      (THIRD_PARTY.test(s) || THIRD_PARTY_TAIL.test(s)) &&
      !SECOND_PERSON.test(s)
    ) {
      found.push({
        rule: "third-party",
        sentence: s,
        why: "about a hypothetical stranger — the reflection is about the viewer and Christ",
      })
    }
  }
  return found
}

/**
 * The same two command rules, in Russian.
 *
 * A localized devotional runs through this identical gate — `reviewDevotionalText`
 * is called whatever the language — but every pattern above is English, so on a
 * Russian reflection the check passed everything silently. A gate that cannot
 * see the text it guards is worse than no gate, because the log says it ran.
 *
 * CALIBRATION WARNING, and it matters here more than anywhere else in this
 * file: every English pattern above was written against a phrasing the pipeline
 * ACTUALLY produced. There is no cached Russian output to calibrate against, so
 * these are translations of the English rules rather than observations, which is
 * weaker evidence. They are therefore deliberately narrow — the collective forms
 * and a short list of imperatives that Russian devotional prose reaches for.
 * When real Russian output exists, calibrate against it the way section by
 * section was calibrated for English, and expect to both add and remove.
 *
 * `посмотри` is absent on purpose, mirroring the English rule that allows "Look
 * at Zacchaeus": pointing at what is on screen is not commanding the viewer.
 */
/**
 * NOTE ON BOUNDARIES: `\b` is defined over ASCII word characters, so it never
 * matches beside a Cyrillic letter — every pattern here silently failed until
 * the boundaries became explicit `(?<![\p{L}])` / `(?![\p{L}])` with the `u`
 * flag. Any future pattern in this block must do the same.
 */
const RU_COLLECTIVE =
  /(?<![\p{L}])(?:мы\s+(?:должны|обязаны)|нам\s+(?:нужно|надо|следует|стоит)|давай(?:те)?)(?![\p{L}])/iu
const RU_BARE_IMPERATIVE =
  /^(?:никогда|всегда|помни|запомни|подумай|доверься|доверяй|перестань|начни|держись|отдай|принеси|обрати|спроси\s+себя|не\s+(?:забывай|бойся|думай|позволяй))(?![\p{L}])/iu

function checkRussianCommands(all: string[]): VoiceFinding[] {
  const found: VoiceFinding[] = []
  for (const s of all) {
    if (RU_COLLECTIVE.test(s)) {
      found.push({
        rule: "command",
        sentence: s,
        why: "collective command («мы должны», «давайте») — state the claim it rests on instead",
      })
      continue
    }
    if (RU_BARE_IMPERATIVE.test(s)) {
      found.push({
        rule: "command",
        sentence: s,
        why: "bare imperative — a synthetic voice has no standing to give orders",
      })
    }
  }
  return found
}

export function checkReflectionVoice(
  text: string,
  opts: {
    scriptureText?: string
    conclusion?: string
    /** Defaults to English. A localized run MUST pass this or the check is a
     *  no-op on its own text. */
    lang?: "en" | "ru"
  } = {},
): VoiceFinding[] {
  const all = sentences(text)
  const ru = opts.lang === "ru"
  const commands = ru ? checkRussianCommands : checkCommandsAndAppeals
  const found = commands(all)
  if (opts.conclusion) {
    found.push(...commands(sentences(opts.conclusion)))
  }
  if (opts.scriptureText) {
    const echo = scriptureEcho(text, opts.scriptureText)
    if (echo) found.push(echo)
  }

  // The opening rule is English-only, and deliberately so rather than as a
  // gap. It turns on spotting a present-tense CLAIM, which Russian routinely
  // makes without a copula («Вера — не то же самое, что…»), so the same test
  // would misfire constantly. It also is not needed: a translation preserves
  // sentence order, so a localized reflection opens on whatever its English
  // original opened on, and that already passed this check.
  if (!ru) {
    const recap = opensOnRecap(all)
    if (recap) found.push(recap)
  }

  const twice = repeatedRun(text)
  if (twice.length >= (ru ? SELF_ECHO_WORDS_RU : SELF_ECHO_WORDS)) {
    found.push({
      rule: "self-echo",
      sentence: twice.join(" "),
      why: `says the same ${twice.length} words twice in one reflection`,
    })
  }

  // The LAST sentence is what the viewer carries away, so a drift there costs
  // more than the same sentence in the middle.
  const last = all[all.length - 1]
  if (last && THIRD_PARTY_TAIL.test(last) && !SECOND_PERSON.test(last)) {
    found.push({
      rule: "third-party",
      sentence: last,
      why: "the reflection ENDS on a stranger's prospects rather than on the viewer",
    })
  }
  return found
}
