import { ApolloClient } from "@apollo/client"

export class RemovedCmsClientError extends Error {
  constructor() {
    super("The Strapi GraphQL client has been removed. Use Admin GraphQL.")
    this.name = "RemovedCmsClientError"
  }
}

export default function getClient(): ApolloClient {
  throw new RemovedCmsClientError()
}
