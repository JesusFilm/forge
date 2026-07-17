import type { Persona } from "./persona.schemas"

/**
 * Render a persona into an explicit audience instruction the existing draft
 * pipeline already honours: the plan/draft prompts say "honour the target
 * audience the editor named or implied." We thread the persona by composing it
 * into the editor `prompt` the multi-step workflow already takes — so the
 * existing no-persona draft path stays untouched.
 */
export function renderPersonaPromptBlock(persona: Persona): string {
  return [
    `TARGET AUDIENCE — write this experience specifically for: ${persona.name}.`,
    `Who they are: ${persona.blurb} (${persona.faithStage})`,
    `Voice & tone: ${persona.tone}`,
    `What they most need from this page:`,
    ...persona.needs.map((need) => `  - ${need}`),
    `How to use Scripture for them: ${persona.scripturePosture}`,
    `Emotional goal: ${persona.emotionalGoal}`,
    `Cultural context to honour: ${persona.culturalContext}`,
    `Shape the framing, tone, Scripture choices, and the questions you answer for THIS audience — while keeping the underlying facts the same as you would for any audience.`,
  ].join("\n")
}

/**
 * Compose the topic + persona into the single editor `prompt` the multi-step
 * draft workflow consumes. Persona steering goes first so it frames the topic.
 */
export function buildPersonaTopicPrompt(
  topic: string,
  persona: Persona,
): string {
  return `${renderPersonaPromptBlock(persona)}\n\nTOPIC: ${topic.trim()}`
}
