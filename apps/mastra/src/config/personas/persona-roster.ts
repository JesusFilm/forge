import type { Persona } from "../../services/persona/persona.schemas"

/**
 * Starter audience roster — PLACEHOLDER.
 *
 * These are provisional personas so engineering can prove persona-tailored
 * generation. The real roster is a ministry decision (origin requirements R10);
 * swap this content once the audiences are confirmed. Bump the version when the
 * roster changes so downstream provenance can notice.
 */
export const PERSONA_ROSTER_VERSION = "persona-roster/v1-placeholder"

export const PERSONA_ROSTER: readonly Persona[] = [
  {
    id: "seeker-skeptic",
    name: "Seeker / skeptic",
    blurb: "Curious but unconvinced — wants honest answers, not a sales pitch.",
    tone: "Plainspoken, unhurried, non-defensive. Respect doubt; never browbeat.",
    needs: [
      "Honest engagement with hard questions",
      "Reasoning and evidence, not assertion",
      "Room to decide without pressure",
    ],
    scripturePosture:
      "Use Scripture sparingly and in context; explain it rather than assuming an authority the reader hasn't granted.",
    emotionalGoal: "Feel respected and intrigued enough to keep exploring.",
    faithStage: "Outside or on the edge of faith; investigating.",
    culturalContext:
      "May be wary of religious institutions; values intellectual honesty.",
  },
  {
    id: "grieving",
    name: "Grieving",
    blurb: "Carrying loss — needs comfort and presence before anything else.",
    tone: "Gentle, warm, slow. No clichés, no fixing, no rushing to resolution.",
    needs: [
      "To feel accompanied, not corrected",
      "Comfort grounded in hope",
      "Permission to grieve",
    ],
    scripturePosture:
      "Lean on comfort passages (the Psalms, the resurrection hope) offered tenderly — never as an argument.",
    emotionalGoal: "Feel comforted, less alone, and quietly hopeful.",
    faithStage:
      "Anywhere — grief crosses belief; meet the person, not a label.",
    culturalContext:
      "Raw and tender; avoid triumphalism or anything that minimises pain.",
  },
  {
    id: "new-believer",
    name: "New believer",
    blurb: "Recently started following Jesus — eager, with a lot still new.",
    tone: "Encouraging, clear, welcoming. Assume little prior knowledge.",
    needs: [
      "Simple, concrete next steps",
      "Reassurance they belong",
      "Plain explanation of unfamiliar terms",
    ],
    scripturePosture:
      "Introduce Scripture warmly with brief context; favour foundational, hope-filled passages.",
    emotionalGoal: "Feel welcomed, grounded, and eager to grow.",
    faithStage: "New to faith; building foundations.",
    culturalContext:
      "May feel unsure they fit; avoid insider jargon and assumed background.",
  },
  {
    id: "family",
    name: "Family with children",
    blurb:
      "Parents exploring faith with kids — wants warmth the whole family can share.",
    tone: "Warm, accessible, hopeful. Suitable to read or watch together.",
    needs: [
      "Content the family can engage together",
      "Simple, vivid storytelling",
      "A clear, gentle takeaway",
    ],
    scripturePosture:
      "Tell the story plainly; surface Scripture as narrative children and parents can follow together.",
    emotionalGoal:
      "Feel this is for them as a family — approachable and hopeful.",
    faithStage: "Mixed; often parents seeking on behalf of the household.",
    culturalContext:
      "Time-poor; values content that is wholesome and easy to share with kids.",
  },
  {
    id: "seasoned-believer",
    name: "Seasoned believer",
    blurb:
      "Long-time follower — wants depth and a fresh way to share the story.",
    tone: "Thoughtful, substantive, unsentimental. Trust the reader's maturity.",
    needs: [
      "Depth beyond the basics",
      "A fresh angle on a familiar story",
      "Something worth passing on",
    ],
    scripturePosture:
      "Engage Scripture richly and accurately; draw connections a mature reader will appreciate.",
    emotionalGoal: "Feel deepened and equipped to share with others.",
    faithStage: "Established; growing and discipling others.",
    culturalContext: "Discerning; allergic to thin or sentimental content.",
  },
]
