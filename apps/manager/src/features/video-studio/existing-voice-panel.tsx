"use client"
import { useState } from "react"
import { z } from "zod"
import { studioAssetVersionSchema } from "@forge/studio-contracts/assets"
class ExistingVoiceError extends Error {}
export default function ExistingVoicePanel({
  language,
  onImported,
}: {
  language: string
  onImported: (voice: z.infer<typeof studioAssetVersionSchema>) => void
}) {
  const [query, setQuery] = useState("")
  const [languageCode, setLanguageCode] = useState(
    language === "english"
      ? "en"
      : /^[a-z]{2,3}$/.test(language)
        ? language
        : "",
  )
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState("")
  async function request(body: unknown) {
    const response = await fetch("/api/shorts/voices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    const value = await response.json()
    if (!response.ok)
      throw new ExistingVoiceError(value.error ?? "Voice lookup failed")
    return value.result
  }
  async function action(task: () => Promise<void>) {
    setBusy(true)
    setError("")
    try {
      await task()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voice lookup failed")
    } finally {
      setBusy(false)
    }
  }
  return (
    <fieldset disabled={busy}>
      <legend>Use an existing ElevenLabs voice</legend>
      <p>
        Import a voice already available to your ElevenLabs account. Speech is
        generated after script review.
      </p>
      <label>
        Voice name
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={200}
        />
      </label>
      <label>
        Speech language code
        <input
          value={languageCode}
          onChange={(e) => setLanguageCode(e.target.value)}
          placeholder="en"
        />
      </label>
      <button
        onClick={() =>
          void action(async () => {
            setVoices(
              z
                .array(z.object({ id: z.string(), name: z.string() }))
                .parse(await request({ kind: "search", query })),
            )
            setSearched(true)
          })
        }
      >
        Find ElevenLabs voices
      </button>
      {error && <p role="alert">{error}</p>}
      {searched && !voices.length && <p>No voices found. Try another name.</p>}
      {voices.map((voice) => (
        <button
          key={voice.id}
          disabled={!/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(languageCode)}
          onClick={() =>
            void action(async () => {
              const imported = studioAssetVersionSchema.parse(
                await request({
                  kind: "import",
                  input: { voiceId: voice.id, language, languageCode },
                }),
              )
              onImported(imported)
            })
          }
        >
          Import {voice.name}
        </button>
      ))}
    </fieldset>
  )
}
