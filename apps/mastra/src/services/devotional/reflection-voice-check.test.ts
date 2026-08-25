import { describe, expect, it } from "vitest"

import { checkReflectionVoice } from "./reflection-voice-check"

/**
 * Every REJECT case below is a sentence the pipeline actually produced while we
 * were tightening the modernizer prompt, in the order it produced them. Each
 * one appeared AFTER the previous phrasing had been fixed, which is why this
 * check exists in code rather than only in the prompt.
 */
describe("checkReflectionVoice", () => {
  const reasons = (t: string) => checkReflectionVoice(t).map((f) => f.rule)

  describe("commands, in each disguise it has worn", () => {
    it("catches the collective form", () => {
      expect(
        reasons("We must never call anything little that concerns the soul."),
      ).toEqual(["command"])
    })

    it("catches the softer collective the prompt fix produced next", () => {
      expect(reasons("We should never despise small beginnings.")).toEqual([
        "command",
      ])
    })

    it("catches the bare imperative left behind when 'we must' was stripped", () => {
      expect(reasons("Never despise the day of small things.")).toEqual([
        "command",
      ])
    })

    it("catches 'let us' and 'ask yourself'", () => {
      expect(reasons("Let us hold these doctrines firmly.")).toEqual([
        "command",
      ])
      expect(reasons("Ask yourself whether your life shows it.")).toEqual([
        "command",
      ])
    })
  })

  describe("appeals", () => {
    it("catches the invitation hidden in a conditional claim", () => {
      expect(
        reasons("Any sinner can be healed if he will only come to Christ."),
      ).toEqual(["appeal"])
    })

    it("catches the named invitation", () => {
      expect(reasons("He stands ready, if you will open the door.")).toEqual([
        "appeal",
      ])
    })

    it("does NOT flag the same words when they narrate the story", () => {
      // The live false positive: this rejected six generations in a row. It is
      // an account of what Christ did for Zacchaeus, addressed to nobody.
      expect(
        checkReflectionVoice(
          "He came to look, and Christ called him to come down and receive him.",
        ),
      ).toEqual([])
    })

    it("still flags an invitation aimed at a generic class the viewer could join", () => {
      expect(reasons("Any sinner may come to Christ and be received.")).toEqual(
        ["appeal"],
      )
    })
  })

  describe("third-party drift", () => {
    it("does NOT flag a hypothetical the sentence uses as an example for the viewer", () => {
      // From the reflection the owner kept. The hypothetical is the subject of
      // an illustration; the claim is aimed at the person watching.
      expect(
        checkReflectionVoice(
          "When a wealthy person begins to give away his riches and someone " +
            "who cheated others starts making restitution, you know something " +
            "has changed.",
        ),
      ).toEqual([])
    })

    it("catches the hypothetical stranger", () => {
      expect(
        reasons(
          "A person who begins to listen to the gospel is already closer than before.",
        ),
      ).toEqual(["third-party"])
    })

    it("flags an ending about a stranger twice — once as drift, once as the ending", () => {
      // Weighted deliberately: the last sentence is what the viewer leaves with.
      const findings = checkReflectionVoice("Who can tell how far they may go?")
      expect(findings.filter((f) => f.rule === "third-party").length).toBe(2)
    })
  })

  describe("what it must NOT flag", () => {
    it("passes the approved reflection voice", () => {
      // Opens on the claim, then narrates — the shape of the reflection the
      // owner kept. An opening that sets up the scene instead is a separate
      // rule below, and this fixture used to break it.
      const good =
        "There is in Christ an infinite readiness to receive sinners. Jesus came " +
        "to Zacchaeus without being asked. He stopped under that tree, looked up, " +
        "and invited himself to the tax collector's house. Zacchaeus had done " +
        "nothing to deserve it. Salvation is not earned by works. The day of small " +
        "things is not a small thing."
      expect(checkReflectionVoice(good)).toEqual([])
    })

    it("allows 'Look at Zacchaeus' — it points at the screen, it does not command the viewer", () => {
      expect(checkReflectionVoice("Look at Zacchaeus.")).toEqual([])
    })

    it("allows a description of what grace produces", () => {
      const good =
        "A heart that has really tasted the grace of Christ turns from the sins that " +
        "once held it. That change is visible, and it is the evidence."
      expect(checkReflectionVoice(good)).toEqual([])
    })

    it("allows the word 'only' when it is not an appeal", () => {
      expect(
        checkReflectionVoice("Curiosity, and only curiosity, moved him."),
      ).toEqual([])
    })
  })

  it("reports the offending sentence so an operator can act on it", () => {
    const [finding] = checkReflectionVoice(
      "Grace moved first. We should never despise small beginnings.",
    )
    expect(finding.sentence).toBe("We should never despise small beginnings.")
    expect(finding.why).toContain("collective command")
  })
})

describe("repetition the viewer hears", () => {
  it("flags the same quoted line spoken twice in one reflection", () => {
    const found = checkReflectionVoice(
      "Faith is fragile. They cried, 'Master, Master, we're going to die!' " +
        "Even Peter and John cried, 'Master, Master, we're going to die!'",
    )
    expect(found.map((f) => f.rule)).toContain("self-echo")
  })

  it("flags a quote of the verse even when the wording is not identical", () => {
    // "we're going to die" against the card's "we are dying": three shared
    // words, the same line to the ear, and the clip speaks it a third time.
    const found = checkReflectionVoice(
      "Fear is not unbelief. They woke him and cried out, 'Master, Master, " +
        "we're going to die!' and forgot who was in the boat with them.",
      {
        scriptureText:
          "They came to him, and awoke him, saying, “Master, master, we are " +
          "dying!” He awoke, and rebuked the wind, and it was calm.",
      },
    )
    expect(found.map((f) => f.rule)).toContain("scripture-echo")
  })

  it("leaves a reflection alone when it only reuses the passage's nouns", () => {
    const found = checkReflectionVoice(
      "Fear is not the same thing as unbelief. The storm on the lake proved " +
        "that a disciple can be badly frightened and still belong to Christ.",
      {
        scriptureText:
          "They came to him, and awoke him, saying, “Master, master, we are " +
          "dying!” He awoke, and rebuked the wind, and it was calm.",
      },
    )
    expect(found).toEqual([])
  })
})

describe("what the reflection opens with", () => {
  it("flags an opening that sets up a scene the viewer just watched", () => {
    const found = checkReflectionVoice(
      "The disciples were in the boat with Jesus when a violent storm came " +
        "down on the lake. Water was filling the boat, and they were in real " +
        "danger. They panicked. They woke him. Fear is not the same thing as " +
        "unbelief. A frightened disciple still belongs to Christ.",
    )
    expect(found.map((f) => f.rule)).toContain("opens-on-recap")
  })

  it("accepts an opening claim, and narration after it", () => {
    // The shape of the reflection the owner kept: a claim first, then the
    // retelling that carries it.
    const found = checkReflectionVoice(
      "Grace does not wait to be asked. Jesus stopped under that tree and " +
        "looked up. He invited himself to the tax collector's house. He sent " +
        "his renewing grace into that heart the same day. Zacchaeus had done " +
        "nothing to earn any of it.",
    )
    expect(found).toEqual([])
  })

  it("allows the claim to arrive in the second sentence", () => {
    const found = checkReflectionVoice(
      "Jericho was a rich town. Wealth is no protection against emptiness.",
    )
    expect(found).toEqual([])
  })
})

describe("the conclusion", () => {
  it("is checked for commands, not only the reflection", () => {
    const found = checkReflectionVoice("Faith is fragile and still real.", {
      conclusion: "In every storm, remember that Jesus is with you.",
    })
    expect(found.map((f) => f.rule)).toContain("command")
  })

  it("passes a conclusion that states rather than instructs", () => {
    const found = checkReflectionVoice("Faith is fragile and still real.", {
      conclusion:
        "The one who slept through the storm is the one who stops it.",
    })
    expect(found).toEqual([])
  })
})

describe("the same rules in Russian", () => {
  // A localized devotional runs through this identical gate, and before the
  // Russian patterns existed every English pattern simply failed to match — the
  // check reported clean on text it could not read.
  it("catches the collective command", () => {
    const found = checkReflectionVoice(
      "Вера бывает хрупкой. Мы должны помнить о его заботе.",
      { lang: "ru" },
    )
    expect(found.map((f) => f.rule)).toContain("command")
  })

  it("catches a bare imperative", () => {
    const found = checkReflectionVoice(
      "Вера бывает хрупкой. Помни, что он рядом в самый тёмный час.",
      { lang: "ru" },
    )
    expect(found.map((f) => f.rule)).toContain("command")
  })

  it("checks the Russian conclusion too", () => {
    const found = checkReflectionVoice(
      "Вера бывает хрупкой и всё же настоящей.",
      {
        lang: "ru",
        conclusion: "Не забывай, что Иисус в твоей лодке.",
      },
    )
    expect(found.map((f) => f.rule)).toContain("command")
  })

  it("leaves a Russian statement alone", () => {
    const found = checkReflectionVoice(
      "Страх не то же самое, что неверие. Испуганный ученик всё равно " +
        "принадлежит Христу. Он рядом в самый тёмный час.",
      { lang: "ru" },
    )
    expect(found).toEqual([])
  })

  it("catches a line said twice, at the Russian word count", () => {
    // Five repeated words, which is the Russian threshold. The English
    // threshold of seven would miss this: Russian says the same line in fewer
    // words, so the number had to be re-derived rather than translated.
    const found = checkReflectionVoice(
      "Вера бывает хрупкой. Они кричали: «Учитель, Учитель, мы сейчас " +
        "погибнем!» И Пётр кричал: «Учитель, Учитель, мы сейчас погибнем!»",
      { lang: "ru" },
    )
    expect(found.map((f) => f.rule)).toContain("self-echo")
  })

  it("leaves a short repeated phrase alone", () => {
    // Three words. Russian prose repeats short phrases the way English does,
    // and flagging those is how a gate earns its overrides.
    const found = checkReflectionVoice(
      "Страх не то же самое, что неверие. Они кричали: «мы погибаем». " +
        "И Пётр кричал: «мы погибаем».",
      { lang: "ru" },
    )
    expect(found).toEqual([])
  })
})
