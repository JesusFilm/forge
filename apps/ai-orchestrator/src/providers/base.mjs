export class ModelProvider {
  constructor(name) {
    this.name = name
  }

  async generate(_input) {
    throw new Error("Not implemented.")
  }
}
