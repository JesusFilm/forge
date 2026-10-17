/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// The pure parts of the local modes. Web's own checks are stubs here, one rule
// each; localModes.test.js runs the real ones through web's real script.
const http = require("http")
const local = require("../lib/localTranslation")

const ENGLISH = {
  "Common.back": "Go back",
  "Common.play": "Play {title}",
  "Common.count": "{count, plural, one {# video} other {# videos}}",
}
const CONTEXTS = {
  "Common.back": { surface: "Shared controls.", role: "button label" },
  "Common.play": { surface: "Shared controls.", role: "button label" },
  "Common.count": { surface: "Shared controls.", role: "count" },
}
const SYSTEM = "You are a translator."

const GOOD = {
  "Common.back": "Volver",
  "Common.play": "Reproducir {title}",
  "Common.count": "{count, plural, one {# vídeo} other {# vídeos}}",
}

// Each stub flags one marker, so a test can prove that one branch alone fails.
const web = {
  messageContractError: (key, source, value) =>
    value.includes("CONTRACT") ? `Contract: ${key}` : null,
  isSourceEquivalent: (source, value) => source === value,
  explicitScriptContractError: (locale, translations) => {
    const [[key, value]] = Object.entries(translations)
    return value.includes("SCRIPT") ? `Script: ${locale}: ${key}` : null
  },
}

const EXPORTED = { english: ENGLISH, contexts: CONTEXTS, system: SYSTEM }

function check(
  answer,
  { english = ENGLISH, contexts = CONTEXTS, system = SYSTEM, exported } = {},
) {
  return local.checkAnswer({
    locale: "es",
    request: {
      system,
      prompt: { messagesToTranslate: english, messageContexts: contexts },
    },
    exported: exported ?? EXPORTED,
    answer,
    web,
  })
}

const STALE = "the export did not record this key with its current English"

describe("checkAnswer", () => {
  it("returns every translation when no check fails", () => {
    expect(check(GOOD)).toEqual({
      translations: Object.entries(GOOD).map(([key, value]) => ({
        key,
        value,
      })),
      problems: [],
    })
  })

  it.each([
    [
      "web's contract check",
      { "Common.back": "CONTRACT" },
      "Contract: Common.back",
    ],
    [
      "the plural and select check",
      { "Common.count": "{count} vídeos" },
      "Plural or select mismatch: Common.count",
    ],
    [
      "the ICU syntax check",
      { "Common.count": "{count, plural, one {# vídeo} other {# vídeos}" },
      "ICU syntax error: Common.count",
    ],
    [
      "the copy check",
      { "Common.back": "Go back" },
      "Common.back: the translation equals the English",
    ],
    [
      "web's script check",
      { "Common.back": "SCRIPT" },
      "Script: es: Common.back",
    ],
    [
      "a missing answer",
      { "Common.back": undefined },
      "Common.back: the answer file has no translation",
    ],
  ])("fails a locale on %s alone, and sends nothing", (_, over, problem) => {
    const result = check({ ...GOOD, ...over })
    expect(result.translations).toEqual([])
    expect(result.problems).toEqual([expect.stringContaining(problem)])
  })

  it("names every problem, not only the first", () => {
    const result = check({
      "Common.back": "Go back",
      "Common.play": "CONTRACT",
    })
    expect(result.problems).toEqual([
      "Common.back: the translation equals the English",
      "Contract: Common.play",
      "Common.count: the answer file has no translation",
    ])
  })

  it.each([
    ["its English", { english: { ...ENGLISH, "Common.back": "Back" } }],
    [
      "its context",
      {
        contexts: {
          ...CONTEXTS,
          "Common.back": { surface: "Shared controls.", role: "link" },
        },
      },
    ],
  ])(
    "fails a key whose %s changed after the export, even with a good answer",
    (_, over) => {
      const result = check(GOOD, over)
      expect(result.translations).toEqual([])
      expect(result.problems).toEqual([
        expect.stringMatching(new RegExp(`^Common\\.back: ${STALE}`)),
      ])
    },
  )

  it("fails every key when the system prompt changed after the export", () => {
    const result = check(GOOD, { system: "You are a careful translator." })
    expect(result.problems).toHaveLength(3)
    expect(result.problems.every((p) => p.includes(STALE))).toBe(true)
  })

  it("fails a key that the export did not record", () => {
    const result = check(GOOD, {
      exported: {
        ...EXPORTED,
        english: { "Common.play": ENGLISH["Common.play"] },
      },
    })
    expect(result.problems).toEqual([
      expect.stringMatching(/^Common\.back: /),
      expect.stringMatching(/^Common\.count: /),
    ])
  })

  it("answers only the keys that web's script asks for", () => {
    const result = check(
      { ...GOOD, "Common.extra": "Extra" },
      {
        english: { "Common.back": "Go back" },
        contexts: { "Common.back": CONTEXTS["Common.back"] },
      },
    )
    expect(result.translations).toEqual([
      { key: "Common.back", value: "Volver" },
    ])
  })
})

describe("exportFailureReason", () => {
  const base = {
    locale: "es",
    writeErrors: {},
    serverErrors: [],
    failures: new Map([["es", "Translation key mismatch; missing=A.b"]]),
    errorLines: [],
  }

  it("names a request file the server could not write before web's expected failure", () => {
    expect(
      local.exportFailureReason({
        ...base,
        writeErrors: { es: "EACCES: permission denied" },
        serverErrors: ["The user prompt has no targetLocale"],
      }),
    ).toBe("EACCES: permission denied")
  })

  it("names a request the server could not read before web's expected failure", () => {
    expect(
      local.exportFailureReason({
        ...base,
        serverErrors: ["The user prompt has no targetLocale"],
      }),
    ).toBe("The user prompt has no targetLocale")
  })

  it("names web's own output when the server saw nothing, and web's failure last", () => {
    expect(
      local.exportFailureReason({ ...base, errorLines: ["Missing catalog"] }),
    ).toBe("Missing catalog")
    expect(local.exportFailureReason(base)).toBe(
      "Translation key mismatch; missing=A.b",
    )
    expect(local.exportFailureReason({ ...base, failures: new Map() })).toBe(
      "web's script sent no request",
    )
  })
})

describe("parseChatRequest", () => {
  const body = (user) =>
    JSON.stringify({
      messages: [
        { role: "system", content: "rules" },
        { role: "user", content: user },
      ],
    })
  const prompt = { targetLocale: "es", messagesToTranslate: { "A.b": "B" } }

  it("reads the locale and the prompt, and drops web's retry note", () => {
    const user = `${JSON.stringify(prompt)}\n\nThe previous response failed validation: x.`
    expect(local.parseChatRequest(body(user))).toEqual({
      locale: "es",
      system: "rules",
      prompt,
    })
  })

  it("refuses a body that is not a translation request", () => {
    expect(() => local.parseChatRequest(body("{}"))).toThrow(
      "no targetLocale and messagesToTranslate",
    )
    expect(() => local.parseChatRequest("{}")).toThrow(
      "no system and user message",
    )
  })
})

describe("answerFile and requestFile", () => {
  it("refuse a tag that could leave the work folder", () => {
    expect(() => local.answerFile("/work", "../es")).toThrow(
      "Not a catalog tag",
    )
    expect(local.requestFile("/work", "zh-Hans")).toBe(
      "/work/zh-Hans.request.json",
    )
  })
})

const TOKEN = "run-token"

function post(url, payload, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      `${url}/chat/completions`,
      { method: "POST", headers },
      (response) => {
        let text = ""
        response.on("data", (chunk) => (text += chunk))
        response.on("end", () =>
          resolve({ status: response.statusCode, body: JSON.parse(text) }),
        )
      },
    )
    request.on("error", reject)
    request.end(payload)
  })
}

function chatBody(locale) {
  return JSON.stringify({
    messages: [
      { role: "system", content: "rules" },
      {
        role: "user",
        content: JSON.stringify({
          targetLocale: locale,
          messagesToTranslate: { "A.b": "B" },
        }),
      },
    ],
  })
}

async function withServer(run) {
  const errors = []
  const asked = []
  const server = await local.startChatServer({
    token: TOKEN,
    answer: ({ locale }) => {
      asked.push(locale)
      if (locale === "fr") throw new Error("no answer for fr")
      return [{ key: "A.b", value: "Bé" }]
    },
    onError: (error) => errors.push(error.message),
  })
  expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/)
  try {
    await run(server.url, { errors, asked })
  } finally {
    await server.close()
  }
}

describe("startChatServer", () => {
  const authorized = { authorization: `Bearer ${TOKEN}` }
  const content = (response) =>
    JSON.parse(response.body.choices[0].message.content)

  it("answers web's request in the chat completion shape, and reports a throw", async () => {
    await withServer(async (url, { errors }) => {
      expect(content(await post(url, chatBody("es"), authorized))).toEqual({
        translations: [{ key: "A.b", value: "Bé" }],
      })
      expect(content(await post(url, chatBody("fr"), authorized))).toEqual({
        translations: [],
      })
      expect(errors).toEqual(["no answer for fr"])
    })
  })

  it.each([
    ["no token", {}],
    ["another key", { authorization: "Bearer a-real-key" }],
    ["a browser Origin", { ...authorized, origin: "https://example.com" }],
  ])(
    "refuses a request with %s, and never calls the answer",
    async (_, headers) => {
      await withServer(async (url, { errors, asked }) => {
        const response = await post(url, chatBody("es"), headers)
        expect(response.status).toBe(401)
        expect(asked).toEqual([])
        expect(errors).toEqual([expect.stringContaining("run's token")])
      })
    },
  )
})
