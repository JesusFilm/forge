import { ModelProvider } from "./base.mjs"

export class OpenAIProvider extends ModelProvider {
  constructor() {
    super("openai")
  }

  async generate(input) {
    return {
      text: `OpenAI draft for objective=${input.objective}`,
      confidenceScore: 0.7,
    }
  }
}
