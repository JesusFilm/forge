import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import { MAX_DEVOTIONAL_TEXT_LENGTH } from "./types"
import { checkReflectionVoice } from "./reflection-voice-check"

/**
 * Reflection modernizer — a dedicated, tightly-bounded agent.
 *
 * The reflection content comes from public-domain preachers (Ryle, Matthew
 * Henry), written 150–300 years ago in archaic English. This step makes ONE
 * short excerpt readable for a modern short-video audience with a LIGHT TOUCH:
 * it updates archaic language and breaks up long sentences while preserving the
 * author's meaning, argument, imagery, and voice. It does NOT rewrite, add
 * ideas, or change theology — so the reflection stays the author's, not the
 * model's. Kept separate from selection so it can be tuned/swapped on its own,
 * and so it doubles as the future localization seam (adapt → translate).
 *
 * Because the source can be a whole long chapter (Matthew Henry), the step also
 * focuses on the passage's verses and trims to a spoken ~30–45s length. The
 * output is attributed "Adapted from <source>" (not a verbatim quote), and the
 * original text is preserved by the caller for provenance.
 */

export type ReflectionModernizerErrorCode =
  | "generation_failed"
  | "empty_output"
  | "banned_phrase_violation"

/**
 * Mechanical backstop for the recurring "Christ lives/living/exists for
 * you/us [in heaven]" violation (owner-reported, twice). SYSTEM_PROMPT bans
 * this in prose, but a prose ban is a request, not an invariant — this regex
 * catches it even when the model ignores or paraphrases around the
 * instruction (e.g. "he exists in heaven on your behalf" still matches).
 * Deliberately narrow (exact construction only) to avoid false-positiving on
 * unrelated uses of "for you"/"for us".
 */
const HEAVENLY_ROLE_VIOLATION =
  /\b(?:lives?|living|exists?)\s+(?:in\s+heaven\s+)?for\s+(?:you|us)\b/i

/** Returns the exact matched phrase, or null if the text is clean. */
export function findBannedHeavenlyRolePhrase(text: string): string | null {
  const m = text.match(HEAVENLY_ROLE_VIOLATION)
  return m ? m[0] : null
}

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

export function countSentences(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/(?<=[.!?…])\s+/).filter(Boolean).length : 0
}

/**
 * How far over the stated target the model is allowed to land before we make
 * it try again. A STATED word target is only a request — measured overshoot
 * across today's runs was +33% to +73% of whatever number was asked for, and
 * the ratio is too unstable to correct by just asking for a smaller number.
 * So the target stays honest and this is the enforced ceiling.
 */
const WORD_CAP_RATIO = 1.15

/**
 * Sentences are capped separately from words because they cost separately:
 * `splitReflection` gives every sentence its own card, its own narration file,
 * and a fixed ~0.8s tail. Sixteen short sentences carry ~13s of tail overhead
 * no matter how few words they contain. Derived from the word budget at a
 * deliberately generous ~14 words/sentence so this only bites on genuinely
 * choppy output.
 */
const WORDS_PER_SENTENCE_FLOOR = 14

export class ReflectionModernizerError extends Error {
  constructor(
    readonly code: ReflectionModernizerErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "ReflectionModernizerError"
  }
}

const ModernizedSchema = z
  .object({
    adapted: z.string().trim().min(1).max(MAX_DEVOTIONAL_TEXT_LENGTH),
  })
  .strict()

const MODERNIZED_JSON_SCHEMA = {
  name: "modernized_reflection",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adapted: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_TEXT_LENGTH,
      },
    },
    required: ["adapted"],
  },
}

export const SYSTEM_PROMPT = [
  "You lightly MODERNIZE a passage from a classic, public-domain Christian",
  "writer (Ryle, Matthew Henry, Spurgeon) into a short spoken REFLECTION for a",
  "devotional video.",
  "YOUR JOB IS A LIGHT TOUCH: vocabulary and length modernization, NOT creative",
  "rewriting. Default to the author's own words, sentence order, and structure",
  "for every sentence you keep, and keep the author's voice. You may change a",
  "sentence ONLY to:",
  "  (a) replace ANYTHING that reads as archaic or formal written English —",
  "      not just individual dictionary words ('thee/thou' -> 'you', 'wroth'",
  "      -> 'angry') but archaic VERB FORMS and PHRASING nobody actually",
  "      speaks today: 'hungered' -> 'was hungry', 'sought rest' -> 'looked",
  "      for rest', 'shall not be destroyed' -> 'will not be destroyed',",
  "      'mighty to save' -> 'powerful enough to save'. Un-invert poetic word",
  "      order into normal spoken order ('greater is he who is for you' ->",
  "      'the one who is for you is greater'). Replace stiff formal openers",
  "      ('the truth now before us is...' -> 'here's the truth:', 'rest in",
  "      the thought that...' -> 'remember that...', 'there is One...' ->",
  "      'someone...' / 'he...'). Say every sentence exactly the way a person",
  "      would actually SAY it out loud today — not something that sounds",
  "      read off a page from 1850. This is still rule (a): you are changing",
  "      HOW it's said, never WHAT is said or in what order the points come.",
  "      THE TEST IS THE EAR, NOT THE DICTIONARY. Every word can be current",
  "      and the sentence still be 200 years old, because it is the IDIOM that",
  "      dates it. 'He lay down a Christian' uses six ordinary words to mean",
  "      'by that night he was a Christian', and a listener hearing it once,",
  "      from a synthetic voice, with no page to look back at, will spend the",
  "      next sentence working out what was said instead of listening to it.",
  "      Watch especially for: an intransitive verb plus a bare noun standing",
  "      in for 'as a' or 'having become' ('he lay down a Christian', 'he rose",
  "      a new man'); verbs whose everyday meaning has since shifted ('lay",
  "      down' now needs an object, 'suffer' no longer means 'allow'); and any",
  "      phrase that made you pause for even a moment while reading it.",
  "      If you paused, the listener stops. Rewrite it plainly.",
  "  (b) split a sentence that would be hard to follow spoken aloud (very long,",
  "      or several clauses stacked) at a natural clause boundary, or",
  "  (c) drop it entirely, per the SELECTION rules below.",
  "Do NOT rephrase a sentence to sound punchier, more contemporary-STYLE, or",
  "more quotable once (a) and (b) are applied — that is rewriting, not",
  "modernizing. Do NOT recompose the author's argument into your own words or",
  "your own sentence order, and do NOT add or cut an idea the author didn't",
  "put in that sentence. Test yourself: for every sentence you keep, you",
  "should be able to say 'this is the author's own point, in the same order,",
  "just said the way a person would actually say it out loud' — if the",
  "GRAMMAR or PHRASING still sounds like something written 150 years ago, you",
  "haven't finished modernizing it; if the CONTENT or ORDER changed, you've",
  "drifted into rewriting. Both are failures, in opposite directions.",
  "'Close to the original' is about CONTENT and ORDER, not the exact words or",
  "grammar: the excerpt is much longer than the target output, so most of it",
  "will be cut per SELECTION below (expected, necessary), and every sentence",
  "you keep should come out sounding like plain, natural, spoken-today",
  "English (required — see rule (a)). What must NOT happen is inventing a new",
  "idea, order, or argument for the sentences you DO keep.",
  "",
  "AUDIENCE: the viewer ALREADY follows Jesus (often a new believer) — someone",
  "already interested, watching a daily devotional. Speak to a fellow believer:",
  "encourage and deepen. Do NOT question whether THEY are, or can become, a true",
  "Christian, or whether they will 'reach heaven', and do NOT make an evangelistic",
  "appeal to convert. When the author asks whether the lost can be saved, frame it",
  "as hope about OTHERS or as 'we', never as doubt about the viewer's own standing.",
  "DROP THE AUTHOR'S APPEALS, KEEP THE AUTHOR'S CLAIMS. These writers were",
  "preaching, and they break off to coach believers on how to call seekers in",
  "('let us bid THEM come to Jesus Christ, just as they are'; 'he will come and",
  "dwell in their hearts if they will only receive him'; 'behold, I stand at the",
  "door and knock'). That material is OUT OF SCOPE for this devotional. Leave it",
  "out entirely. Not aimed at the viewer, not aimed at others, not softened into",
  "'we can tell anyone' — those are the same appeal wearing three hats, and the",
  "third is the easiest to miss.",
  "",
  "The test is grammatical, not theological. A sentence that STATES something",
  "about God is the substance you are here to carry over: 'there is in him an",
  "infinite readiness to receive sinners', 'grace moved first, before Zacchaeus",
  "had done anything to deserve it'. A sentence that ISSUES AN INVITATION, or",
  "tells anyone to issue one, is the appeal: 'come to him just as you are',",
  "'only believe', 'don't wait until you feel worthy', 'open the door and he",
  "will come in'. Keep every claim. Drop every invitation. The doctrine survives",
  "untouched; only the altar call goes.",
  "",
  "This matters beyond audience fit. 'Come just as you are' carries a reputation",
  "for preaching grace while stepping around sin, so it undercuts the very point",
  "the author is making. Losing it costs the reflection nothing.",
  "",
  "AND WATCH FOR THE APPEAL HIDING INSIDE A CLAIM. A sentence can parse as a",
  "statement about God and still do the work of an altar call, when a trailing",
  "condition sets out the terms: anything of the shape 'X is available IF he",
  "will only / just / simply DO-SOMETHING'. The main clause is the claim; the",
  "condition is the appeal. Keep the first, delete the second — 'there are no",
  "incurable cases under the gospel' is the whole point, and it stands on its",
  "own. This is the single most persistent leak in this prompt, because the",
  "sentence reads as doctrine right up until you look at what it asks of the",
  "listener. If a sentence names a condition the listener must meet, cut the",
  "condition, whatever the sentence sounds like.",
  "",
  "THE FIRST SENTENCE ASSERTS SOMETHING, IT DOES NOT SET A SCENE.",
  "- A mechanical check reads your opening before anything else runs, and it",
  "  rejects the reflection unless one of the first two sentences states",
  "  something that is TRUE NOW — about God, about grace, about what people",
  "  are like. Present tense. The viewer has just watched the scene and does",
  "  not need it established.",
  "- After the opening, narration that CARRIES a point is not recap; the",
  "  author's best passages walk through the events precisely because that is",
  "  where the point lives. But narration is never the POINT, and this bullet",
  "  used to say the rule was 'only about where you start' — which read as",
  "  permission to retell the whole scene from sentence three onward, and that",
  "  is exactly what got two reflections rejected by the owner. So: if half or",
  "  more of your sentences do nothing but report what happened, the reflection",
  "  is worthless here, because the viewer has just watched it happen.",
  "- What to reach for instead is the author's REASONING about the events: the",
  "  motives he imputes to the people in the scene, the excuses he puts in",
  "  their mouths, the distinction he draws that the scene alone would not",
  "  give you, the objection he stops to answer. That material is why we adapt",
  "  a commentator at all rather than describing the video. Touch a scene",
  "  detail in order to say something about it, never to establish it.",
  "",
  "THE LAST PARAGRAPH LEAVES THE VIEWER WITH HOPE.",
  "- Whatever the author was arguing, the closing paragraph is what the viewer",
  "  carries into their day, and it has to lift. End on something they can",
  "  hold on to. What that is belongs to the passage, not to a formula — it",
  "  may be what God is like, what he has promised, what grace makes possible,",
  "  what stays true when a person fails, or simply what the scene shows to be",
  "  so. Do not end on the viewer's own failure, and do not end on a warning.",
  "- Do NOT rank believers. The author sometimes writes about the highest or",
  "  best sort of Christian; a viewer hears that as a league table of faith",
  "  they are not in. Describe what the faith itself SEES or DOES, or what is",
  "  true for anyone who trusts him, rather than sorting people by it.",
  "",
  "SAY EACH LINE ONCE.",
  "- The author writes for a reader whose eye can skim, so he sometimes",
  "  repeats a line for emphasis. Spoken aloud over the film, a repeat is",
  "  heard as a mistake, and a line the scene itself speaks is heard twice",
  "  already. A check rejects any run of seven or more words that appears",
  "  twice in your reflection.",
  "",
  "SELECTION — which of the author's own sentences to keep:",
  "- The source excerpt MAY BE A WHOLE CHAPTER covering several different",
  "  scenes. Use ONLY the author's commentary on the specific passage named",
  "  below (the 'Passage to focus on'). IGNORE every other scene, story, or",
  "  verse in the excerpt — even if another part seems more quotable. If the",
  "  excerpt discusses the focus passage only briefly, reflect on THAT; never",
  "  drift to a different passage in the chapter.",
  "- The viewer has JUST WATCHED this Bible scene on video, so drop sentences",
  "  that re-narrate the plot from scratch (no scene-setting, no 'as we",
  "  saw...' recaps) or quote dialogue from the scene. Keep sentences that give",
  "  the author's INSIGHT, MEANING, or APPLICATION — what this reveals about",
  "  God and what it means for the viewer's life today. Begin from one of",
  "  those, never from the story.",
  "  EXCEPTION: if the author builds a point on ONE specific action or detail",
  "  (e.g. Zacchaeus climbing the sycamore tree, the boy's five loaves), keep",
  "  that reference — the insight does not stand without it. The line is recap",
  "  vs. reference: don't re-tell the scene, but don't strip out the one",
  "  concrete thing the author's argument is anchored to either.",
  "- Do NOT add ideas, arguments, or images the author did not write. Do NOT",
  "  change, soften, or embellish the theology.",
  "- THE EXCERPT IS ALREADY NARROWED. What you are given has been trimmed to",
  "  the one or two points that matter for the verse on screen; you do not",
  "  need to choose what to cover, and you must not reach beyond it. Cover",
  "  what's in front of you, all of it, and nothing else.",
  "- TAKE THE CLAIM, NOT THE WHOLE ELABORATION. Each point states a core",
  "  claim and then supports it at length — several illustrations for one",
  "  idea, two or three Scripture quotations, the same thought restated for",
  "  emphasis, an extended metaphor. Keep the CLAIM and the ONE concrete",
  "  anchor the author leans on hardest; drop the surplus decoration. From a",
  "  point that says 'no one is too bad to be saved' and then offers a camel",
  "  through a needle's eye, an Isaiah quotation, AND a hospital metaphor,",
  "  keep the claim plus at most one of those three. This is where your",
  "  length budget comes from — cutting a point's ornament, never cutting a",
  "  point's substance.",
  "- BUT DO NOT GO THIN OR GENERIC. The target is a full, specific reflection",
  "  of roughly the length below, not a summary. A sentence that could sit in",
  "  any devotional about any passage ('God loves you and wants the best for",
  "  you') is a failure even though it is short. Every sentence should be",
  "  traceable to something the author actually argued about THIS passage.",
  "  Compress the ornament; keep the specificity.",
  "- ONLY WHAT'S IN FRONT OF YOU. Every concrete detail you name must appear",
  "  in the excerpt you were actually given. Do NOT reach for a detail you",
  "  know from elsewhere in this author's fuller commentary, or from the",
  "  Bible story generally, even if it is true and even if it would round the",
  "  thought out. If the excerpt you're adapting never mentions the tree, you",
  "  may not mention the tree.",
  "- KEEP THE AUTHOR'S QUALIFIERS. Conditionals and limiting words carry the",
  "  theology: 'nothing to DESERVE it' is not 'did nothing'; 'if they will",
  "  only come to Him' is not an unconditional promise. Never drop a",
  "  qualifier and leave the claim sounding absolute — that quietly turns a",
  "  precise statement into a false one.",
  "- ONE BRIDGE SENTENCE (only when you are given a FIRST HALF above). Open",
  "  with a single short sentence that makes your point FOLLOW FROM that half,",
  "  then move on. Without it the two halves read as competing claims rather",
  "  than one argument — grace on one side, works on the other — which is a",
  "  real failure a reviewer caught: 'the viewer is left with competing",
  "  messages rather than one grounded insight.'",
  "  The author almost always supplies this link himself; USE HIS, don't",
  "  invent one. Ryle bridges free pardon to changed living with 'Freely",
  "  pardoned, and raised from death to life, Zacchaeus felt he could not",
  "  begin too soon to show whose he was.' That single sentence turns the",
  "  second half into the FRUIT of the first rather than its price. Keep the",
  "  causal direction: grace came first and produced the response; the",
  "  response never earns the grace. One sentence only — a paragraph of",
  "  recap wastes the budget and bores the viewer.",
  "- NO MORALISM. When the author grounds a command in what God has already",
  "  done ('freely pardoned, and raised from death to life, he could not",
  "  begin too soon to show whose he was'), keep the grounding, not just the",
  "  command. A reflection that ends on 'do this to prove you are a believer'",
  "  with the grace stripped out has changed the author's point into",
  "  something he did not say.",
  "- DESCRIBE, DON'T COMMAND. This is read aloud by a SYNTHETIC VOICE, not by",
  "  a pastor the viewer knows and trusts. A congregation accepts 'renounce",
  "  your sins' from someone whose life and reputation they know; the same",
  "  words from an anonymous machine voice land as scolding or presumptuous,",
  "  and the viewer stops listening. So convert the author's imperatives into",
  "  DESCRIPTION of what grace actually produces, which says the same thing",
  "  without hectoring:",
  "    NOT 'Renounce the sins that have held you back. Follow the graces",
  "        you've neglected. Live so everyone knows you belong to Him.'",
  "    BUT 'A heart that has tasted his grace turns from the sins that once",
  "        held it, and reaches for what it used to neglect. That change is",
  "        visible, and it is the evidence.'",
  "  Never stack imperatives — two in a row is already too many, and a",
  "  reflection must never END on a run of commands. Prefer the indicative",
  "  ('this is what he does', 'this is what a changed heart looks like').",
  "  NO SENTENCE MAY BE A COMMAND, IN ANY FORM. There are three disguises and",
  "  all three are the same thing: the bare imperative ('never despise the day",
  "  of small things'), the collective ('we must never despise…', 'let us',",
  "  'we ought to'), and the second person ('you must'). Dropping 'we must'",
  "  from the front of a sentence does not fix it — it leaves the bare",
  "  imperative, which is the strongest form of all.",
  "  THE TEST: could this sentence be obeyed or disobeyed? Then it is an",
  "  order, whatever its grammar looks like, and it has to be rewritten.",
  "  The rewrite is mechanical — state the claim the order rests on:",
  "    order    → 'never despise the day of small things'",
  "    rewrite  → 'the day of small things is not a small thing'",
  "    order    → 'let us hold these doctrines firmly'",
  "    rewrite  → 'these doctrines are worth holding firmly'",
  "  Emit ONLY the rewrite lines. The order lines appear here so you can",
  "  recognise the shape; every one of them is wrong to put in a reflection.",
  "  A gentle invitation is fine; a list of demands is not.",
  "- THE REFLECTION IS ABOUT THE VIEWER AND ABOUT CHRIST. These authors were",
  "  addressing a congregation with work to do, so a point often ends by",
  "  turning outward: how to regard a careless neighbour, how to judge",
  "  someone else's first stirrings of interest, what to say to them. That",
  "  tail is the author briefing his church on ministry, not the substance of",
  "  the point, and carrying it over quietly changes the subject from the",
  "  viewer's own walk to other people's souls.",
  "  Keep the observation when it is a CLAIM about how God works ('the Spirit",
  "  is often beginning a work that will stand forever when an onlooker sees",
  "  nothing remarkable' — true, and it lands on the viewer's own small",
  "  beginnings too). Drop the instruction about how to treat the third party",
  "  ('do not look coldly on him', 'better to hear the gospel out of",
  "  curiosity than not at all', 'who can tell, he may go further'). Never",
  "  END on the third party: the last thing the viewer hears should concern",
  "  them and Christ, not a hypothetical stranger's prospects.",
  "- KEEP THE DETAIL THE LESSON RESTS ON, especially WHO SOMEONE WAS. These",
  "  authors build a point on a person's standing, and the point collapses",
  "  without it. Henry's lesson about Zacchaeus is not that a short man",
  "  climbed a tree — it is that the CHIEF OF THE PUBLICANS, a rich and",
  "  conspicuous man, 'forgot his gravity' and 'ran before, like a boy'. Drop",
  "  the office and you keep the picture while losing what it cost him, which",
  "  is the whole lesson. Before you cut any identifying detail (someone's",
  "  rank, wealth, reputation, age, illness), check whether the author's",
  "  conclusion still follows without it. If it does not, the detail is not",
  "  colour, it is the argument, and it stays.",
  "- KEEP THE ORDER OF EVENTS THE AUTHOR GIVES. Do not invert who acted",
  "  first. If the person sought Christ and Christ then answered beyond what",
  "  was sought, do not rewrite it as Christ calling and the person merely",
  "  responding — that erases the human effort the author's whole point may",
  "  rest on, and it is a factual error about the story besides.",
  "- GROUND concrete details the author refers to: keep the specific noun (e.g.",
  "  'the twelve baskets left over', not a vague 'the leftovers'). Only",
  "  details the author actually mentions.",
  "- Cut a sentence if keeping it would restate a point your selection already",
  "  makes elsewhere (e.g. never end up with 'when he feeds you, he fills you'",
  "  twice over) — every kept sentence must add something new, and none may",
  "  pre-echo the closing takeaway. This applies to your OPENING as much as",
  "  your ending: check that your first two sentences are not one thought said",
  "  twice in different words ('Jesus came to seek and save the lost.' / 'No",
  "  one is too far gone for his grace.' is ONE thought — merge it into one",
  "  sentence). Redundancy here is easy to miss because the wording differs",
  "  completely; test the MEANING, not the words.",
  "",
  "Christ's heavenly role: the exact words 'lives/living for you' or",
  "'lives/living for us' (Christ existing/living 'for' the believer in heaven)",
  "must NEVER appear in your output, EVEN IF the source author uses that exact",
  "phrase. This is a hard word-choice ban, not a 'mention it once elsewhere'",
  "rule — one correct use earlier in the text does NOT license a bare",
  "occurrence later; check EVERY sentence, not just the first. Every time the",
  "idea comes up, use INTERCESSION or MEDIATION wording instead: 'he",
  "intercedes for you', 'your Mediator at God's right hand', 'your High",
  "Priest who pleads your case' — the way Hebrews 7:25 means it. 'Living for",
  "you' alone reads as Christ's purpose being to serve the viewer, which is",
  "backwards and NOT what the author is saying, no matter how it's framed",
  "elsewhere in the same piece. Rephrasing this idea to avoid the literal words",
  "while keeping the same backwards meaning (e.g. 'he exists for you') is",
  "still a violation.",
  "",
  "GUARDRAILS (override the source when it conflicts — drop the offending part,",
  "never reproduce it):",
  "- NO denominational or confessional polemic. Never criticize Catholics, other",
  "  churches, traditions, or 'ritualism'. Keep to the universal gospel that unites",
  "  everyone who follows Jesus.",
  "- NO predestination or election — do NOT teach or imply that God pre-chose only",
  "  some people to be saved, or speak of 'the elect' as a closed group. If the",
  "  author argues this, OMIT that thread entirely and present the gospel as an",
  "  open invitation to EVERYONE who comes to Christ.",
  "",
  "Write 2 to 3 short paragraphs, speaking straight to the viewer ('you'),",
  "landing close to the target length below. That length is a FLOOR as much as",
  "a ceiling: coming in well under it means you summarized instead of adapting,",
  "which reads as generic. Aim to fill it with the author's own substance.",
  "",
  "CALIBRATION — this is an approved reflection at the right length and depth",
  "(two of Ryle's points on Zacchaeus, about 190 words). Match this scale and",
  "specificity. Do not copy its wording or subject; it is here to show you how",
  "much text the target actually is, because word counts are easy to overshoot:",
  '  "Jesus came to seek and save the lost, and no one is too far gone for his',
  "  grace. Look at Zacchaeus, a wealthy tax-collector, a man you'd think had",
  "  everything to lose by following Jesus. Yet he became a disciple. This shows",
  "  us that all things are possible with God. The door of hope is wide open. We",
  "  should never hesitate to tell even the worst sinner, 'There is hope. Repent",
  "  and believe, and your sins will be forgiven.' There are no incurable cases",
  "  under the Gospel. Any sinner can be healed if they will only come to Christ.",
  "  But here's what matters: when Zacchaeus was truly converted, it showed. He",
  "  didn't just say he believed; he gave half his possessions to the poor and",
  "  promised to repay anyone he'd cheated four times over. That's real",
  "  conversion. A faith that doesn't change your heart and life isn't saving",
  "  faith at all. Grace that has really been tasted shows up somewhere, in what",
  "  a person does with money, with grudges, with the people they used to walk",
  '  past."',
  "Notice how that ending lands: it states what grace does, and lets the viewer",
  "do their own arithmetic. It does not close with 'so ask yourself', and it",
  "does not put their standing with God in question. End your reflections the",
  "same way — on a statement, never on a command or an audit.",
  "THE EXAMPLES ABOVE ARE SHAPES, NOT SENTENCES TO REUSE. Every line here was",
  "written for a different devotional than yours. Copying one across — 'but",
  "here's what matters', 'grace that has really been tasted shows up somewhere",
  "in what a person does with money, with grudges' — makes your reflection say",
  "what THIS author said about THAT passage, and a viewer watching two",
  "devotionals in a week hears the same sentence twice and stops believing",
  "either. Take the move; write your own words for the excerpt in front of you.",
  "PUNCTUATION: do NOT use em dashes or en dashes (the '—' or '–' characters)",
  "anywhere. They read as AI writing. Use a period, comma, or colon, or restructure.",
  "Return JSON only: an object with an 'adapted' string.",
].join("\n")

export type ModernizeReflectionOptions = {
  /** Source excerpt (may be a whole chapter; focus on the passage). */
  sourceText: string
  /** Human/osis reference to focus on, e.g. "Luke 8:22-25". */
  focusReference: string
  /** Attribution name, e.g. "Matthew Henry, Commentary on the Whole Bible". */
  sourceName: string
  /** The specific verse shown on-screen, e.g. "Luke 19:10" — narrower than
   *  focusReference (the whole passage). Used to pick which of the author's
   *  connected points become the main throughline (see FOCUS + REPRESENT). */
  scriptureReference?: string
  /** The quoted verse's own text, for the same reason. */
  scriptureText?: string
  /** Target spoken length in words (~60–75s ≈ 170; 2–3 short paragraphs). */
  approxWords?: number
  /** TWO-ACT LAYOUT: the half of the reflection that will play BEFORE this
   *  one. Given only for the second half, so it can open by connecting back
   *  instead of starting a fresh, unrelated argument. */
  precedingHalf?: string
  /** Hard word ceiling; a breach triggers one targeted shortening retry.
   *  Defaults to 15% over `approxWords`. */
  maxWords?: number
  /** Hard sentence ceiling — each sentence becomes its own card with a fixed
   *  tail, so sentence count drives video length independently of words. */
  maxSentences?: number
  llm: DevotionalLlm
  /** Surfaces the voice-repair attempts, which are otherwise invisible: the
   *  operator sees only the final text and cannot tell it took three calls. */
  log?: (msg: string) => void
  /** The clip's own transcript for its curated window (see
   *  `fetchClipTranscript` in subtitle-align.ts). When present, tells the
   *  model exactly which lines/beats the clip already delivered — instead of
   *  the SYSTEM_PROMPT's blanket "the viewer has JUST WATCHED this scene"
   *  assumption, which is accurate for some chapters and not others (a
   *  hand-curated window can skip parts of the passage the film shows). The
   *  static instruction's other guidance (present tense, insight-not-plot)
   *  still applies either way, so this is additive, not a replacement. */
  clipTranscript?: string
}

export type ModernizedReflection = {
  adapted: string
  /** "Adapted from <source>" — NOT a verbatim quote (light modernization applied). */
  attribution: string
  focusReference: string
}

async function requestAdaptation(
  llm: DevotionalLlm,
  user: string,
): Promise<string> {
  let result: z.infer<typeof ModernizedSchema>
  try {
    result = await llm.complete({
      system: SYSTEM_PROMPT,
      user,
      jsonSchema: MODERNIZED_JSON_SCHEMA,
      schema: ModernizedSchema,
      temperature: 0.3,
      maxTokens: 1200,
    })
  } catch (error) {
    if (error instanceof DevotionalLlmError) {
      throw new ReflectionModernizerError(
        "generation_failed",
        `reflection modernization failed: ${error.code}`,
        error,
      )
    }
    throw error
  }
  return result.adapted.trim()
}

/**
 * Bounded voice-rule repair.
 *
 * The standing voice rules are all stated in the system prompt above, and each
 * of them has been ignored at some point anyway — a prompt is a probability.
 * `reflection-voice-check` measures them instead, and this feeds what it
 * measured back, which is the same shape as the length and banned-phrase
 * retries above and the only thing in this file that has ever moved a rule the
 * prose could not.
 *
 * TWO attempts, not one: the rules are independent, so a rewrite that fixes the
 * opening can introduce a repeat. If it still fails after that, the text is
 * returned as-is and the quality gate reports it to a human — a crash here
 * would lose the run's other work and tell the operator less.
 */
const VOICE_REPAIR_ATTEMPTS = 2

async function repairVoice(
  adapted: string,
  user: string,
  llm: ModernizeReflectionOptions["llm"],
  log?: (msg: string) => void,
): Promise<string> {
  let current = adapted
  for (let attempt = 1; attempt <= VOICE_REPAIR_ATTEMPTS; attempt++) {
    const found = checkReflectionVoice(current)
    if (found.length === 0) return current
    log?.(
      `   ↻ voice repair ${attempt}/${VOICE_REPAIR_ATTEMPTS}: ` +
        found.map((f) => f.rule).join(", "),
    )
    const retryUser = [
      user,
      "",
      "Your previous attempt broke rules that are checked mechanically:",
      ...found.map((f) => `- ${f.why}\n  In: “${f.sentence}”`),
      "",
      "Rewrite the ENTIRE reflection so none of those hold. Keep every point",
      "the author makes and keep the concrete details his argument rests on —",
      "a compliant but emptier reflection is a worse answer.",
    ].join("\n")
    const fixed = await requestAdaptation(llm, retryUser)
    // Only take the rewrite if it is actually cleaner. A retry that trades one
    // broken rule for two is worse than what we already had.
    if (!fixed) break
    if (checkReflectionVoice(fixed).length >= found.length) break
    current = fixed
  }
  return current
}

export async function modernizeReflection(
  options: ModernizeReflectionOptions,
): Promise<ModernizedReflection> {
  const approxWords = options.approxWords ?? 170
  // NOTE: point SELECTION happens upstream now (reflection-point-picker.ts) —
  // this function receives only the already-chosen points. Leaving selection
  // to the writer did not hold: with the full four-point Zacchaeus excerpt and
  // an explicit "choose exactly two" instruction, it still spread across three
  // and ran well over the word target.
  const sourceBlock = ["Source text:", options.sourceText].join("\n")

  const user = [
    `Passage to focus on: ${options.focusReference}`,
    `Author/source: ${options.sourceName}`,
    ...(options.scriptureReference && options.scriptureText
      ? [
          `Quoted verse shown on screen (${options.scriptureReference}): ${options.scriptureText}`,
        ]
      : []),
    ...(options.precedingHalf
      ? [
          "",
          "THIS IS THE SECOND HALF of the reflection. The viewer has already",
          "heard the half below, then watched the next part of the scene. Open",
          "by CONNECTING to it (see the ONE BRIDGE SENTENCE rule), then develop",
          "your own point. Do not restate it and do not contradict it.",
          `FIRST HALF ALREADY HEARD:\n${options.precedingHalf}`,
        ]
      : []),
    ...(options.clipTranscript
      ? [
          "",
          "What the clip's own audio says, word for word:",
          `"${options.clipTranscript}"`,
          "Do not repeat these lines or this sequence of events in your",
          "reflection — say something ABOUT them instead. This is the exact",
          "clip the viewer just watched, not an assumption about it.",
        ]
      : []),
    `Target length: about ${approxWords} words across 2–3 short paragraphs (a ~60–75 second spoken reflection).`,
    "",
    sourceBlock,
  ].join("\n")

  let adapted = await requestAdaptation(options.llm, user)
  if (!adapted) {
    throw new ReflectionModernizerError(
      "empty_output",
      "modernizer returned empty text",
    )
  }

  // Mechanical length enforcement. A stated target is a request the model
  // routinely ignores (+33% to +73% measured), so cap it and, on a breach,
  // retry ONCE quoting the real counts back. The retry must name WHAT to cut
  // — supporting illustration, not a main point — or the model trims the
  // argument instead of the ornament.
  const maxWords = options.maxWords ?? Math.round(approxWords * WORD_CAP_RATIO)
  const maxSentences =
    options.maxSentences ?? Math.ceil(maxWords / WORDS_PER_SENTENCE_FLOOR)
  const words = countWords(adapted)
  const sentences = countSentences(adapted)
  if (words > maxWords || sentences > maxSentences) {
    const overWords = words - maxWords
    const retryUser = [
      user,
      "",
      `Your previous attempt was ${words} words in ${sentences} sentences.`,
      `The hard limits are ${maxWords} words and ${maxSentences} sentences.`,
      overWords > 0
        ? `Cut at least ${overWords} words.`
        : "Use fewer, fuller sentences.",
      "Cut SUPPORTING ILLUSTRATION, not substance: drop an extra metaphor, an",
      "extra Scripture quotation, or a restatement of a point you already",
      "made. Keep every main point the author makes, keep the concrete",
      "details his argument rests on, and keep the specificity — a shorter",
      "but vaguer reflection is a worse answer than a long one. Combine",
      "choppy short sentences rather than deleting content.",
      "Return the full rewritten reflection.",
    ].join("\n")
    const shorter = await requestAdaptation(options.llm, retryUser)
    // Only accept the retry if it actually helped — a retry that came back
    // LONGER (or empty) is worse than what we already had.
    if (shorter && countWords(shorter) < words) adapted = shorter
  }

  // Mechanical backstop: the prose ban on "lives/living/exists for you/us"
  // has failed to hold twice already. One retry, quoting the violation back
  // and asking for a targeted rewrite, before giving up entirely.
  const violation = findBannedHeavenlyRolePhrase(adapted)
  if (violation) {
    const retryUser = [
      user,
      "",
      `Your previous attempt contained a banned construction: "${violation}".`,
      "Rewrite the ENTIRE reflection avoiding that construction completely —",
      "use intercession/mediation wording instead ('he intercedes for you',",
      "'your Mediator at God's right hand', 'your High Priest who pleads your",
      "case'). Return the full corrected reflection, not just the fixed",
      "sentence.",
    ].join("\n")
    adapted = await requestAdaptation(options.llm, retryUser)
    if (!adapted) {
      throw new ReflectionModernizerError(
        "empty_output",
        "modernizer returned empty text on retry",
      )
    }
    const stillViolating = findBannedHeavenlyRolePhrase(adapted)
    if (stillViolating) {
      throw new ReflectionModernizerError(
        "banned_phrase_violation",
        `modernizer repeated the banned construction after a retry: "${stillViolating}"`,
      )
    }
  }

  adapted = await repairVoice(adapted, user, options.llm, options.log)

  return {
    adapted,
    // "a trusted classic" signals a historic, credible source even to viewers
    // who don't recognize the author's name (owner note). Use just the AUTHOR
    // (the part before the first comma of the citation, e.g. "Matthew Henry"
    // from "Matthew Henry, Commentary on the Whole Bible") so it stays short.
    // Generalizes across the commentators (Henry/Ryle) and Spurgeon.
    attribution: `Adapted from a trusted classic · ${options.sourceName.split(",")[0].trim()}`,
    focusReference: options.focusReference,
  }
}

export const _internal = { JSON_SCHEMA: MODERNIZED_JSON_SCHEMA }
