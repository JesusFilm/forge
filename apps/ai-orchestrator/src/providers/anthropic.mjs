import { ModelProvider } from "./base.mjs";

export class AnthropicProvider extends ModelProvider {
  constructor() {
    super("anthropic");
  }

  async generate(input) {
    return {
      text: `Anthropic draft for objective=${input.objective}`,
      confidenceScore: 0.72
    };
  }
}
