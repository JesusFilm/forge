import "server-only"
import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"

function getRequiredEnv(name: "NEXT_PUBLIC_GRAPHQL_URL" | "STRAPI_API_TOKEN") {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

const uri = getRequiredEnv("NEXT_PUBLIC_GRAPHQL_URL")
const headers: Record<string, string> = {
  Authorization: `Bearer ${getRequiredEnv("STRAPI_API_TOKEN")}`,
}
const client = new ApolloClient({
  link: new HttpLink({ uri, headers }),
  cache: new InMemoryCache(),
})

export default client
