import type { TranslationResult } from "@/services/translation"

export type VoiceoverInput = {
  language: string
  text: string
}

type BuildVoiceoverInputsArgs = {
  sourceLanguage: string
  sourceText: string
  translations: TranslationResult[]
}

export function buildVoiceoverInputs({
  sourceLanguage,
  sourceText,
  translations,
}: BuildVoiceoverInputsArgs): VoiceoverInput[] {
  const voiceoverInputs: VoiceoverInput[] = []
  const normalizedSourceText = sourceText.trim()

  if (normalizedSourceText) {
    voiceoverInputs.push({
      language: sourceLanguage,
      text: normalizedSourceText,
    })
  }

  for (const translation of translations) {
    const text = translation.text.trim()
    if (!text || translation.targetLanguage === sourceLanguage) {
      continue
    }

    voiceoverInputs.push({
      language: translation.targetLanguage,
      text,
    })
  }

  return voiceoverInputs
}
