// Translation service — translates transcripts to target languages via OpenRouter.

import { getOpenrouter, DEFAULT_MODEL } from "@/services/openrouter"
import { writeArtifact } from "@/services/storage"

export type TranslationResult = {
  sourceLanguage: string
  targetLanguage: string
  text: string
}

export async function translate(
  assetId: string,
  sourceText: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<TranslationResult> {
  const response = await getOpenrouter().chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      {
        role: "system",
        content: `You are a professional translator. Translate the following text from ${sourceLanguage} to ${targetLanguage}. Return only the translated text, no explanations.`,
      },
      { role: "user", content: sourceText },
    ],
  })

  const translatedText = response.choices[0]?.message?.content ?? ""

  const result: TranslationResult = {
    sourceLanguage,
    targetLanguage,
    text: translatedText,
  }

  await writeArtifact({
    assetId,
    artifactType: `translation-${targetLanguage}`,
    ext: "json",
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  })

  return result
}
