import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { config } from "./config"

const uri = config.graphqlUrl || "http://localhost:1337/graphql"
const headers: Record<string, string> = {}
if (config.strapiToken) {
  headers.Authorization = `Bearer ${config.strapiToken}`
}

const link = new HttpLink({ uri, headers })

export const apolloClient = new ApolloClient({
  link,
  cache: new InMemoryCache(),
})

export default apolloClient
